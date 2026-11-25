#!/usr/bin/env python3
"""tsuzuri の記録フォルダを読み、閲覧アプリを 127.0.0.1 で配るサーバー。

使い方: python3 app/server.py [<文書の名前>.tsuzuri] [--port 8770] [--image-root <dir>]（記録を省くと、ライブラリから始まる）

記録の読み方はスキルのスクリプト（skills/tsuzuri/scripts/tsuzuri.py）の関数をそのまま使い、
読み方を2つに持たない。アプリが書くのは comments/ だけ（ADR-0001 の「書き手を分ける」）。
"""

import argparse
import base64
import binascii
import contextlib
import hashlib
import io
import json
import mimetypes
import os
import re
import shutil
import stat
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
import sys
import threading
import time
import unicodedata
import urllib.parse
import zipfile

HERE = Path(__file__).resolve().parent
# 一部の最小構成環境では .woff2 が application/octet-stream になり nosniff で弾かれるため、明示登録する
mimetypes.add_type("font/woff2", ".woff2")
sys.path.insert(0, str(HERE.parent / "skills" / "tsuzuri" / "scripts"))
import tsuzuri as T  # noqa: E402  スキルのスクリプトを読み方の正本として使う

WEB = HERE / "web"
# 配る静的ファイルの保存先。ここ以外は配らない（パスの外へ出る指定を止めるため）
STATIC_ROOTS = {"/web/": WEB, "/icons/": HERE / "icons", "/brand/": HERE.parent / "assets" / "brand" / "logo"}
# 書込の宛先に使える働きの項目。画面の「違う」から来る名前だけを受け付ける
TARGETS = {"役割", "接続", "重要度", "工夫", "対応要件"}
# 1件の書込の上限。画面では上限を見せない（textarea.md）が、壊れた送信で巨大なファイルを作らないための守り
MAX_TEXT = 20000
# 画面から受け取る .tsz の上限（圧縮した大きさ）。記録は文字ばかりで、数百の文でも数百KBに収まる。
# 送信は base64 の JSON のため、受け取る長さはこの約4/3倍になる
MAX_TSZ = 30 * 1024 * 1024
# 書込のファイル名を決めて書くまでを1つずつにする（同じ番号を2つの要求が取らないため）
WRITE_LOCK = threading.Lock()
# 記録の切り替えと書込先の確認を同じ境界で守るため。
RECORD_LOCK = threading.Lock()


def _capture(function, *args):
    """print で結果を出すスクリプトの関数を呼び、戻り値と出力の行を返す。"""
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        result = function(*args)
    return result, [line for line in buffer.getvalue().splitlines() if line.strip()]


def _sentence_record(root, sid):
    """文またはブロックの全部の版を、メモ・働き・ずれと一緒に古い順で返す。"""
    versions = []
    for path in T._versions(root, sid):
        sentence = T._read_json(path)
        memo_path = path.with_name(f"{path.stem}-memo.json")
        memo = T._read_json(memo_path) if memo_path.is_file() else None
        versions.append({
            "ver": sentence["ver"], "title": sentence.get("title"), "text": sentence["text"], "tags": sentence["tags"],
            "requirements": sentence.get("requirements"), "deviation": sentence.get("deviation"),
            # 設計書より前の記録の文は design・para を持たない（ADR-0003「前の記録はそのまま読む」）
            "design": sentence.get("design"), "para": sentence.get("para"),
            "source": sentence.get("source"), "memo": memo["text"] if memo else None,
            # inferred は人の文の執筆意図を AI が推測したもの（ADR-0002）。画面はこれを書き手の意図と分けて見せる
            "memo_by": memo.get("by") if memo else None,
            "written_at": sentence.get("written_at"),
            **({"block": sentence.get("block")} if sid.startswith("b") else {"in": sentence.get("in"), "cont": bool(sentence.get("cont"))}),
        })
    return versions


def load_document(root):
    """画面が一度に読む文書の全部（文と版・レビュー・書込・要件の版・検査の問題）を返す。

    壊れた記録では tsuzuri.py と同じ ValueError を出す。検査の問題（check の出力）は
    読めた範囲を返したうえで problems に並べ、画面の件数に出す。
    """
    order = T._order(root)
    starts = T._paragraph_starts(root, order)
    sentences = []
    for sid in order["order"]:
        versions = _sentence_record(root, sid)
        is_block = sid.startswith("b")
        sentences.append({"sid": sid, "versions": versions,
                          "kind": "block" if is_block else "sentence",
                          **({"block": versions[-1]["block"]} if is_block else {}),
                          "paragraph_start": starts[sid]})
    retired_sentences = []
    for entry in order["retired"]:
        versions = _sentence_record(root, entry["sid"])
        is_block = entry["sid"].startswith("b")   # retire は表・見出しなどのブロックも外す
        retired_sentences.append({"sid": entry["sid"], "kind": "block" if is_block else "sentence",
                                  **({"block": versions[-1]["block"]} if is_block else {}),
                                  "versions": versions, "paragraph_start": False})
    reviews = [{"id": path.stem, **T._read_json(path)}
               for path in T._numbered(root / "reviews", "rv", 4, ".json")]
    comments = list(T._comments(root, order))
    requirements = [path.stem for path in T._numbered(root / "requirements", "r", 3, ".md")]
    designs = [path.stem for path in T._designs(root)]
    status, problems = _capture(T._check, root)
    return {
        "document": order["document"], "record": str(root),
        "retired": order["retired"], "retired_sentences": retired_sentences,
        "sentences": sentences, "reviews": reviews,
        "comments": comments, "requirements": requirements, "designs": designs,
        "meta": T._meta(root),
        "problems": problems if status else [],
    }


def _request_of(root):
    """最新の要件定義書の「1. 依頼」の本文。ライブラリで、何の文章かを1行で見せ、検索にも使う。"""
    paths = T._numbered(root / "requirements", "r", 3, ".md")
    if not paths:
        return ""
    lines, inside = [], False
    for line in paths[-1].read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            if inside:
                break
            inside = line[3:].lstrip().startswith("1.")
            continue
        if inside and line.strip():
            lines.append(line.strip())
    return " ".join(lines)


def record_summary(path):
    """ライブラリの1行分（題・場所・依頼・最後に書いた時刻・文の数・未解決のコメントの数）と、検索に使う本文。

    一覧には動かしたり消したりした記録も残っているため、読めないものは exists を false にして返し、画面で外せるようにする。
    本文は最新の文をつないだもの。一覧は数十件の想定のため、まとめて返して画面の側で絞る。
    """
    root = Path(path)
    # 文書の名前は draft.md のように重なりやすいため、置いてあるフォルダの名前を前に付けて見分ける
    document = root.name[:-len(".tsuzuri")] if root.name.endswith(".tsuzuri") else root.name
    summary = {"path": str(root), "name": f"{root.parent.name}/{document}"}
    try:
        order = T._order(root)
        meta = T._meta(root) or ""
        title = next((line.split(":", 1)[1].strip().strip("'\"") for line in meta.splitlines() if line.startswith("title:")), "")
        # 書くたびに増えるファイルの保存先の更新時刻を見る（全ファイルを開くと記録が大きいとき一覧が遅くなる）
        stamps = [p.stat().st_mtime for p in (root / "order.json", root / "sentences", root / "blocks", root / "comments",
                                             root / "requirements", root / "design") if p.exists()]
        stamps += [p.stat().st_mtime for p in (root / "sentences").iterdir() if p.is_dir()] if (root / "sentences").is_dir() else []
        text = " ".join(T._latest(root, sid)["text"] for sid in order["order"])
        return {**summary, "exists": True, "title": title, "request": _request_of(root), "text": text, "updated": max(stamps),
                "sentences": sum(1 for sid in order["order"] if sid.startswith("s")),
                "open": sum(1 for c in T._comments(root, order) if c.get("status") == "open")}
    except (ValueError, OSError, KeyError, TypeError, IndexError):
        return {**summary, "exists": False}


def record_stamp(root):
    """各フォルダの名前と更新時刻から、時計が戻っても変化を識別できる値を返す。

    保存は一時ファイルからの置き換えのため、ファイルを開かず保存先の更新時刻で変更を拾える。
    """
    stamps = [(".", root.stat().st_mtime_ns)]
    for folder, subfolders, _files in os.walk(root):
        subfolders.sort()
        stamps += [(str((Path(folder) / name).relative_to(root)), (Path(folder) / name).stat().st_mtime_ns)
                   for name in subfolders]
    return hashlib.sha256(json.dumps(stamps).encode()).hexdigest()


def open_record(path):
    """画面で選んだかパスを入れた記録を確認し、一覧に足して開く記録フォルダを返す。

    人は記録フォルダより文書のパスを覚えているため、文書（draft.md）のパスを入れても隣の draft.md.tsuzuri を開く。
    """
    if not isinstance(path, str) or not path.strip():
        raise ValueError("文章のパスを指定してください")
    root = Path(path.strip()).expanduser().resolve()
    if not root.name.endswith(".tsuzuri") and Path(str(root) + ".tsuzuri").is_dir():
        root = Path(str(root) + ".tsuzuri")
    # 記録フォルダ以外を読ませない（画面から任意のフォルダを開いて中を返させないため）
    if not root.name.endswith(".tsuzuri") or not root.is_dir():
        raise ValueError(f"tsuzuri で執筆した文章が見つかりません: {root}")
    T._order(root)
    T.register_record(root)
    return root


def add_comment(root, body):
    """書込を1件、comments/c0001.json の形で新しいファイルに足し、書いた中身を返す。

    body は文へなら {sid, ver, text, to}（to は働きの項目名か null）、要件定義書・設計書へなら {doc, ver, item, text}（ADR-0005）。
    宛先が無い・中身が空・長すぎる・宛先が項目名でないときは ValueError。
    """
    if body.get("doc") is not None:
        T._doc_comment_target(root, body["doc"], body.get("ver"), body.get("item"))
        target = {"doc": body["doc"], "ver": body["ver"], "item": body["item"]}
    else:
        sid = T._sid(body.get("sid"))
        ver = T._ver(body.get("ver"))
        if not T._sentence_path(root, sid, ver).is_file():
            raise ValueError(f"コメントを付ける文のバージョンがありません: {sid} {ver}")
        target = {"sid": sid, "ver": ver}
    text = body.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("コメントの内容が空です")
    if len(text) > MAX_TEXT:
        raise ValueError("コメントが長すぎます")
    to = body.get("to") if "sid" in target else None   # 文機能の項目は文にだけある
    if to is not None and to not in TARGETS:
        raise ValueError(f"宛先は文機能の項目名にしてください: {to}")
    with WRITE_LOCK:
        # コメントの無い記録を git で配ると comments/ ごと無くなる（空のフォルダは追跡されない）ため、最初の1件で作る
        (root / "comments").mkdir(exist_ok=True)
        cid = T._next_name(root / "comments", "c", 4, ".json")
        comment = {"id": cid, **target, "to": to, "text": text,
                   "status": "open", "created_at": time.time_ns(),
                   "posted_latest": (T._doc_versions(root, target["doc"]) if "doc" in target
                                     else T._versions(root, target["sid"]))[-1].stem}
        T._write_json(root / "comments" / f"{cid}.json", comment)
    return comment


def set_status(root, cid, status):
    """書込の状態（open・resolved）を書き換えて返す。

    書込はアプリだけが書くため、同じファイルを書き直してよい（ADR-0001）。
    書込の ID か状態が不正なとき、ファイルが無いときは ValueError か OSError。
    """
    T._identifier(cid, "c", 4)
    if status not in ("open", "resolved"):
        raise ValueError(f"状態は open か resolved です: {status}")
    path = root / "comments" / f"{cid}.json"
    with WRITE_LOCK:
        comment = T._read_json(path)
        comment["status"] = status
        comment["resolved_at"] = time.time_ns() if status == "resolved" else None
        if status == "open":
            # 新しいバージョンで自動に解決したコメントを開き直したとき、今の最新を覚える。
            # これより新しいバージョンが書かれるまでは開いたままにする（T._comments の対応済みの判定）
            versions = T._doc_versions(root, comment["doc"]) if "doc" in comment else T._versions(root, comment["sid"])
            comment["reopened_at_ver"] = versions[-1].stem if versions else None
            # 開き直した時刻。このあとで文を外したら、外したことで対応したとみなす（T._comments）
            comment["reopened_at"] = time.time_ns()
        T._write_json(path, comment)
    return comment


def delete_comment(root, cid):
    """書込を1件、ファイルごと消して、消した中身を返す（打ち間違いを消せるようにするため）。

    書込はアプリだけが書くため、消してよい（ADR-0001）。次の番号は一番大きい番号の次のため、間の番号を消しても重ならない。
    書込の ID が不正なとき、ファイルが無いときは ValueError か OSError。
    """
    T._identifier(cid, "c", 4)
    path = root / "comments" / f"{cid}.json"
    with WRITE_LOCK:
        comment = T._read_json(path)
        path.unlink()
    return comment


class Handler(BaseHTTPRequestHandler):
    """画面のファイルと、文書を読む・書込を足す・状態を変える・消す API を返す。"""

    # いま開いている記録。記録を渡さずに起動したときは None で、画面はライブラリから始まる
    root: Path | None = None
    # --image-root で明示した画像の許可範囲。None なら git のルートか文書のフォルダから決める（_image_boundary）
    image_root: Path | None = None

    def log_message(self, format, *args):  # 要求ごとの記録は出さない（端末を静かに保つ）
        pass

    def _send(self, status, body, content_type="application/json; charset=utf-8", csp=None):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        # 他サイトの <img> や <script> から /api/image などを読み込ませない。応答の成否の差で画像の存在を探られるのを防ぐ
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        # 画面は自分の出どころの資源だけを読む（数式フォントも同梱の 'self' から読む）。本文書体だけ Google Fonts から読む
        self.send_header("Content-Security-Policy", csp or "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'")
        self.end_headers()
        self.wfile.write(data)

    def _file(self, target):
        kind = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if kind.startswith("text/") or kind in ("application/javascript", "image/svg+xml"):
            kind += "; charset=utf-8"
        self._send(200, target.read_bytes(), kind)

    def _local_host(self):
        """ローカル配信先の Host だけを許可し、拒否時は応答する。"""
        hosts = self.headers.get_all("Host", [])
        if len(hosts) != 1 or not re.fullmatch(r"(?:127\.0\.0\.1|localhost|\[::1\])(?::[0-9]{1,5})?", hosts[0]):
            self._send(403, {"error": "この端末からだけ開けます"})
            return False
        return True

    def do_GET(self):
        """ローカルの要求へ画面と、要求開始時に開いていた文章を返す。"""
        if not self._local_host():
            return
        root = self.root
        path = self.path.split("?", 1)[0]
        if path in ("/", "/index.html"):
            return self._file(WEB / "index.html")
        if path == "/tokens.css":
            return self._file(HERE / "tokens.css")
        # アプリとして入れるための manifest と service worker。worker は置いた場所より上を受け持てないため、根から配る
        if path == "/manifest.webmanifest":
            return self._send(200, (WEB / "manifest.webmanifest").read_bytes(), "application/manifest+json; charset=utf-8")
        if path == "/sw.js":
            return self._file(WEB / "sw.js")
        if path == "/api/records":
            try:
                rows = [record_summary(p) for p in T.read_registry()]
            except (ValueError, OSError) as error:
                return self._send(500, {"error": f"ライブラリを読み込めませんでした: {error}"})
            # 最近書いた記録を上に。読めない記録は下にまとめる
            rows.sort(key=lambda r: (r["exists"], r.get("updated", 0)), reverse=True)
            return self._send(200, {"current": str(root) if root else None, "records": rows})
        # テンプレートと校正辞書は利用者ごとに育つ設定で、どの記録にも属さないため、記録を開く前から見せる。
        # アプリは見せるだけで、書き換えは AI か利用者がファイルで行う（アプリが書く先はコメントだけのまま）
        if path == "/api/templates":
            try:
                bundled, user = T.template_dirs()
                paths = T.template_paths()
            except (ValueError, OSError) as error:
                return self._send(500, {"error": f"テンプレートを読み込めませんでした: {error}"})
            rows = []
            for name, file in paths.items():
                row = {"name": name, "path": str(file), "source": "標準" if file.parent == bundled else "自分",
                       "replaces": file.parent != bundled and (bundled / file.name).is_file()}
                # 1つのファイルが読めなくても、ほかのテンプレートは見せる（読めないものは理由を添えて一覧に残す）
                try:
                    text = T.read_template(file)
                    row.update(scene=T.template_scene(text), text=text)
                except (ValueError, OSError) as error:
                    row.update(scene="", text="", error=str(error))
                rows.append(row)
            return self._send(200, {"templates": rows, "user_dir": str(user)})
        if path == "/api/app":
            return self._send(200, {"version": app_version()})
        if path == "/api/prompts":
            try:
                return self._send(200, {"prompts": prompt_rows()})
            except (ValueError, OSError) as error:
                return self._send(500, {"error": f"プロンプトを読み込めませんでした: {error}"})
        if path == "/api/dictionary":
            try:
                rows = T.dictionary_rows()
            except (ValueError, OSError, RecursionError) as error:
                return self._send(500, {"error": f"校正辞書を読み込めませんでした: {error}"})
            return self._send(200, {"rows": rows, "user_path": str(T.user_dictionary_path())})
        if path.startswith("/api/") and root is None:
            return self._send(409, {"error": "文章が開かれていません", "no_record": True})
        if path == "/api/stamp":
            try:
                return self._send(200, {"path": str(root), "stamp": record_stamp(root)})
            except OSError as error:
                return self._send(500, {"error": str(error)})
        if path == "/api/doc":
            try:
                # 読んでいる間の書き換えも次の問い合わせで拾えるよう、変更の識別値は読む前に取る。
                stamp = record_stamp(root)
                return self._send(200, {**load_document(root), "stamp": stamp})
            except (ValueError, OSError, KeyError) as error:
                return self._send(500, {"error": str(error)})
        if path == "/api/image":
            src = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("src", [""])[0]
            try:
                data, kind = document_image(root, src, self.image_root)
            except (ValueError, OSError) as error:
                return self._send(404, {"error": str(error)})
            return self._send(200, data, kind, csp=IMAGE_CSP)
        if path == "/api/markdown":
            # 本文コピー用。export と同じ記事の Markdown（markdown）に加え、付帯情報を除いた本文だけ（body）も返し、text.md は書き換えない
            # body を別に持つのは、画面が「本文だけコピー」で付帯情報（先頭の YAML など）を正規表現で剥がさずに済むようにするため
            # 方言（T.FLAVORS）は ?flavor= で受け取る。書き出す媒体ごとに記法が変わる
            flavor = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query, keep_blank_values=True).get("flavor", ["gfm"])[0]
            if flavor not in T.FLAVORS:
                # 方言の一覧は T.FLAVORS が正本のため、文言も一覧から組み、媒体を足してもここを直さずに済ませる
                return self._send(400, {"error": f"記法は {'・'.join(T.FLAVORS)} から選択してください"})
            try:
                order = T._order(root)
                return self._send(200, {"markdown": T._article(root, order, flavor), "body": T._article(root, order, flavor, include_meta=False)})
            except (ValueError, OSError, KeyError) as error:
                return self._send(500, {"error": str(error)})
        # 要件定義書は r001、設計書は d001 の形だけを通し、パスの外へ出させない
        for prefix, letter, folder in (("/api/req/", "r", "requirements"), ("/api/design/", "d", "design")):
            if path.startswith(prefix):
                try:
                    version = T._identifier(path[len(prefix):], letter, 3)
                    return self._send(200, {"id": version, "text": (root / folder / f"{version}.md").read_text(encoding="utf-8")})
                except (ValueError, OSError) as error:
                    return self._send(404, {"error": str(error)})
        for prefix, base in STATIC_ROOTS.items():
            if path.startswith(prefix):
                target = (base / path[len(prefix):]).resolve()
                if base.resolve() in target.parents and target.is_file():
                    return self._file(target)
        self._send(404, {"error": "見つかりません"})

    def do_POST(self):
        """送信元・長さ・表示中の文章を確認し、コメントまたはライブラリを更新する。"""
        if not self._local_host():
            return
        # 手元の外の Web ページから書き込ませない。同じ出どころからの JSON の送信だけを受け付ける
        # （JSON の送信は、外のページからだと事前の問い合わせが要り、ここで止まる）
        origin = self.headers.get("Origin")
        host = self.headers.get("Host", "")
        if origin != f"http://{host}" or not self.headers.get("Content-Type", "").startswith("application/json"):
            return self._send(403, {"error": "この画面からの送信だけを受け付けます"})
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) != 1 or not re.fullmatch(r"[0-9]+", lengths[0]) or self.headers.get("Transfer-Encoding"):
            return self._send(400, {"error": "送信の長さが不正です"})
        try:
            length = int(lengths[0])
        except ValueError:
            return self._send(400, {"error": "送信の長さが不正です"})
        limit = MAX_TSZ * 4 // 3 + 4096 if self.path.split("?", 1)[0] == "/api/records/unpack" else MAX_TEXT * 4 + 1024
        if length > limit:
            return self._send(413, {"error": "送信が大きすぎます"})
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise ValueError("JSON オブジェクトを送信してください")
            with RECORD_LOCK:
                path = self.path.split("?", 1)[0]
                if path == "/api/records/open":
                    # 開く記録はサーバーに1つ。別のタブで同じサーバーを見ていると、そちらも次に読んだときに切り替わる
                    type(self).root = open_record(body.get("path"))
                    return self._send(200, record_summary(self.root))
                if path == "/api/records/unpack":
                    type(self).root = unpack_received(body.get("name"), body.get("data"))
                    return self._send(200, record_summary(self.root))
                if path == "/api/records/forget":
                    T.forget_record(body.get("path", ""))
                    return self._send(200, {"ok": True})
                root = self.root
                if root is None:
                    return self._send(409, {"error": "文章が開かれていません", "no_record": True})
                if body.get("record") != str(root):
                    return self._send(409, {"error": "別の文章が開かれています。画面を再読み込みしてください"})
                if path == "/api/comments":
                    return self._send(200, add_comment(root, body))
                parts = path.strip("/").split("/")
                if len(parts) == 4 and parts[:2] == ["api", "comments"] and parts[3] == "status":
                    return self._send(200, set_status(root, parts[2], body.get("status")))
                # 消すのも同じ出どころの確認を通したいため、DELETE でなく POST で受ける
                if len(parts) == 4 and parts[:2] == ["api", "comments"] and parts[3] == "delete":
                    return self._send(200, delete_comment(root, parts[2]))
                return self._send(404, {"error": "見つかりません"})
        except (ValueError, OSError, KeyError, TypeError) as error:
            return self._send(400, {"error": str(error)})


# 文章の画像のブロックが指す画像。本文の Markdown や HTML が文書のフォルダからの相対パスで指す画像を、閲覧アプリでも描くために返す。
# 返すのは、許可範囲（_image_boundary）より下の画像の拡張子のファイルだけ。文書のフォルダには README のように
# リポジトリ全体が入るため、範囲を画像に絞り、隠しファイルとリンクをたどる道は拒む
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
               ".webp": "image/webp", ".svg": "image/svg+xml", ".avif": "image/avif"}
MAX_IMAGE = 20 * 1024 * 1024
# 画像を直接開かれても SVG の中のスクリプトや外部の読み込みが動かないよう、画像だけの応答は何も許さない
IMAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox"


# Windows で特別な意味を持つ名前（装置名と、末尾の点や空白が消える名前）。開くと装置を待ったり別のファイルを指したりする
_WINDOWS_SPECIAL = re.compile(r"^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(?:\..*)?$|[. ]$", re.I)
# 画像を同時に読む数の上限。画像の多い文章を開いても、サーバーが一度に大きなファイルを読み込み続けないようにする
_IMAGE_READS = threading.BoundedSemaphore(4)
# 制御文字と書式文字（双方向制御・ゼロ幅など）は、見た目と実体のずれを作るため断る。
# ただし結合絵文字の ZWJ と異体字セレクタは、正当なファイル名に入るため通す
_ALLOWED_FORMAT_CHARS = {"\u200d", "\ufe0e", "\ufe0f"}


def _home():
    """利用者のホーム（解決済み）。決められない環境では None。"""
    try:
        return Path.home().resolve()
    except (RuntimeError, OSError):
        return None


def _config_dirs(home):
    """利用者の設定の保存先（解決済み）。XDG_CONFIG_HOME と $HOME/.config の両方を返す。"""
    found = []
    for candidate in (os.environ.get("XDG_CONFIG_HOME"), home / ".config" if home else None):
        if not candidate:
            continue
        try:
            found.append(Path(candidate).expanduser().resolve())
        except (RuntimeError, OSError):
            continue
    return found


def _too_broad(directory):
    """画像の許可範囲にするには広すぎる場所か。

    根・ホーム・ホームの祖先（/home など）・設定の保存先・マウントポイントを断る。
    ~/.config 自体が git 管理されている環境で、サンプルの記録（~/.config/tsuzuri/samples）から
    設定全体が画像の許可範囲になるのを防ぐため。マウントポイントは別のボリュームの根を丸ごと開く入口になる。
    """
    if directory == Path(directory.anchor):
        return True
    home = _home()
    if home is not None and (directory == home or directory in home.parents):
        return True
    if directory in _config_dirs(home):
        return True
    return os.path.ismount(str(directory))


def _is_received(root):
    """root が外部から受け取った .tsz の記録か。読めない order.json は、安全側で受け取ったものとして扱う。"""
    try:
        if T._order(root).get("received"):
            return True
    except (ValueError, OSError, KeyError, TypeError):
        return True
    received = (T.registry_path().parent / "received").resolve()
    return root.resolve().is_relative_to(received)


def _find_git_root(start):
    """start から親へ辿り、最初に .git（フォルダか、worktree のファイル）がある階層を返す。見つからなければ None。

    ホームや根まで出たら打ち切る。ホームの dotfiles 管理などで $HOME/.git があっても、
    ホーム全体を画像の読める範囲にしないため。
    """
    for directory in (start, *start.parents):
        if _too_broad(directory):
            return None
        if (directory / ".git").exists():
            return directory
    return None


def _image_boundary(root, image_root=None):
    """記録 root の文書が指せる画像の許可範囲（解決済みのフォルダ）を返す。

    受け取った記録は、悪意のある共有ファイルから上のフォルダの画像を読ませないため、
    何を指定されても文書のフォルダに閉じる。手元の記録は、--image-root があればそこ（文書のフォルダを含むときだけ）、
    なければ git のルートまで広げる。docs/ に文書を置いて ../images/ の画像を指す書き方は、リポジトリでよく使うため。
    決められないときは文書のフォルダに閉じる（許可を広げる側へは倒さない）。
    """
    doc_dir = root.parent.resolve()
    if _is_received(root):
        return doc_dir
    if image_root is not None:
        candidate = Path(image_root).resolve()
        # 文書を含まない指定や、根・ホームのような広すぎる指定は、無関係なフォルダを開く入口になるため使わない
        if doc_dir.is_relative_to(candidate) and not _too_broad(candidate):
            return candidate
        return doc_dir
    return _find_git_root(doc_dir) or doc_dir


def _image_parts(src):
    """src の入口を検査して、"/" で分けた名前の並び（".." を含みうる）と画像の種類を返す。"""
    # ":" は Windows のドライブ指定と NTFS の代替データストリームになるため、どこにあっても断る。分け方は OS によらず "/" だけにする
    if not src or len(src) > 1024 or any(c in src for c in "\\\0:") or src.startswith("/"):
        raise ValueError("文書のフォルダからの相対パスだけを開けます")
    if any(unicodedata.category(c) in ("Cc", "Cf") and c not in _ALLOWED_FORMAT_CHARS for c in src):
        raise ValueError("制御文字を含む名前は開けません")
    kind = IMAGE_TYPES.get(PurePosixPath(src).suffix.lower())
    if kind is None:
        raise ValueError("画像のファイルではありません")
    return src.split("/"), kind


def _descend_from_boundary(parts, doc_dir, boundary):
    """文書のフォルダから parts を字面でたどり、許可範囲からの下りだけの名前の並びと、文書のフォルダ由来の先頭の数を返す。

    ".." は OS に渡さず、ここで字面のまま畳む。途中で一度でも許可範囲の外へ出る指定は、あとで戻ってきても断る。
    畳んだ結果だけを開くため、途中のリンクの先や差し替えで範囲の外へ出る道がなくなる。
    """
    # (名前, src が足した名前か)。文書のフォルダ自身の保存先が隠しフォルダでも、文書が置かれているだけのため断らない
    stack = [(name, False) for name in doc_dir.relative_to(boundary).parts]
    for name in parts:
        if name in ("", "."):
            continue
        if name == "..":
            if not stack:
                raise ValueError("画像の置ける範囲の外は開けません")
            stack.pop()
            continue
        if name.startswith(".") or _WINDOWS_SPECIAL.search(name):
            raise ValueError("隠しファイル・特別な名前は開けません")
        stack.append((name, True))
    if not stack or not stack[-1][1]:
        raise ValueError("画像のファイルではありません")
    kept = next((i for i, (_, added) in enumerate(stack) if added), len(stack))
    return [name for name, _ in stack], kept


def _read_regular(fd):
    """開いた記述子が通常のファイルで上限以下なら、上限＋1 バイトまで読んで返す（確認のあとに伸びても上限で止める）。"""
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_IMAGE:
        raise ValueError("画像が見つからないか、大きすぎます")
    data = bytearray()
    while len(data) <= MAX_IMAGE:
        chunk = os.read(fd, min(1 << 20, MAX_IMAGE + 1 - len(data)))
        if not chunk:
            break
        data += chunk
    if len(data) > MAX_IMAGE:
        raise ValueError("画像が大きすぎます")
    return bytes(data)


def document_image(root, src, image_root=None):
    """記録 root の文書のフォルダから相対パス src の画像を (バイト列, 種類) で返す。範囲の外・画像でない・大きすぎるものは ValueError。

    範囲は _image_boundary が決める。src の ".." は字面で畳み、許可範囲からの下りだけの名前にしてから開く。
    確認と読み込みの間にファイルをリンクへ差し替えられないよう、許可範囲を開いて名前を1段ずつリンクをたどらずに開き、開いた記述子で種類と大きさを確認して読む。
    その開き方ができない環境（Windows）では、パスで確認したうえで、実体の場所・隠しファイル・拡張子をもう一度確認する。
    """
    parts, kind = _image_parts(src)
    doc_dir = root.parent.resolve()
    boundary = _image_boundary(root, image_root)
    rel_parts, kept = _descend_from_boundary(parts, doc_dir, boundary)
    if IMAGE_TYPES.get(PurePosixPath(rel_parts[-1]).suffix.lower()) != kind:
        raise ValueError("画像のファイルではありません")
    if not _IMAGE_READS.acquire(timeout=10):
        raise ValueError("画像の読み込みが混んでいます")
    try:
        if os.open in os.supports_dir_fd and hasattr(os, "O_NOFOLLOW") and hasattr(os, "O_DIRECTORY"):
            # 範囲そのものも、決めたあとにリンクへ差し替えられた場合に辿らない（解決済みの実フォルダなら必ず開ける）
            fds = [os.open(boundary, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)]
            try:
                for name in rel_parts[:-1]:
                    fds.append(os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fds[-1]))
                try:
                    fds.append(os.open(rel_parts[-1], os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0), dir_fd=fds[-1]))
                except OSError as error:
                    raise ValueError("画像が見つからないか、リンクになっています") from error
                return _read_regular(fds[-1]), kind
            finally:
                for fd in reversed(fds):
                    os.close(fd)
        target = boundary.joinpath(*rel_parts)
        for step in [target, *target.parents]:
            if step == boundary:
                break
            if step.is_symlink() or getattr(step, "is_junction", lambda: False)():
                raise ValueError("リンクになった画像は開けません")
        real = target.resolve()
        if not real.is_relative_to(boundary) or real == boundary:
            raise ValueError("画像が見つかりません")
        inside = real.relative_to(boundary).parts
        # 先頭 kept 個は文書のフォルダの保存先のため、隠しフォルダでも断らない（fd 経路と同じ扱い）
        if any(part.startswith(".") for part in inside[kept:]) or IMAGE_TYPES.get(real.suffix.lower()) != kind:
            raise ValueError("画像が見つかりません")
        fd = os.open(real, os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NONBLOCK", 0))
        try:
            return _read_regular(fd), kind
        finally:
            os.close(fd)
    finally:
        _IMAGE_READS.release()


def app_version():
    """画面のファイル（web・icons・tokens.css）の版。名前・大きさ・更新時刻から作り、どれかが変わると変わる。

    開いたままの画面（とくに PWA の窓）が、アプリの更新を知って読み込み直すために使う。
    """
    files = sorted(p for base in (WEB, HERE / "icons") for p in base.rglob("*") if p.is_file()) + [HERE / "tokens.css"]
    digest = hashlib.sha1()
    for p in files:
        info = p.stat()
        digest.update(f"{p.relative_to(HERE)}\0{info.st_size}\0{info.st_mtime_ns}\n".encode())
    return digest.hexdigest()[:12]


# 利用者がほかのチャット AI に貼るプロンプト。正本はスキルの参考資料で、アプリは枠の中を写さずにそこから読む
PROMPTS = [("書いた経緯の書き出し", "チャット AI が書いた文章を読む前に、その文章を書かせた会話へ貼る。依頼・読み手・文ごとの目的が返ってくる",
            Path(T.__file__).resolve().parent.parent / "references" / "session-log-prompt.md")]


def prompt_rows():
    """貼るプロンプトの名前・使う場面・本文・元のファイルを返す。本文は元のファイルの最初のコードの枠の中。"""
    rows = []
    for name, scene, file in PROMPTS:
        match = re.search(r"^```[^\n]*\n(.*?)\n```$", file.read_text(encoding="utf-8"), re.S | re.M)
        if not match:
            raise ValueError(f"{file.name} にプロンプトの枠がありません")
        rows.append({"name": name, "scene": scene, "text": match.group(1), "path": str(file)})
    return rows


def unpack_received(name, data):
    """画面で選んだ .tsz（base64）を、受け取った記録の保存先に展開して開き、記録フォルダを返す。

    ブラウザはファイルの場所を渡せないため、中身を受け取って展開する。展開の検査は CLI の unpack と同じものを通す。
    保存先は ~/.config/tsuzuri/received/<ファイル名>/ で、同じ名前を2度受け取ったら -2, -3 と分ける
    （unpack は既存の名前に書かないため、前に受け取った記録とそのコメントを上書きしない）。
    """
    if not isinstance(name, str) or not name.endswith(".tsz") or not isinstance(data, str):
        raise ValueError(".tsz のファイルを選択してください")
    try:
        raw = base64.b64decode(data, validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError("ファイルを読み込めませんでした") from error
    if len(raw) > MAX_TSZ:
        raise ValueError("ファイルが大きすぎます")
    # 名前はフォルダ名にだけ使う。区切りや先頭の点を除き、利用者の保存先の外を指せないようにする
    stem = re.sub(r"[^\w\-]+", "_", Path(name).stem).strip("._") or "received"
    base = T.registry_path().parent / "received"
    target = base / stem
    n = 2
    while target.exists():
        target, n = base / f"{stem}-{n}", n + 1
    target.mkdir(parents=True)
    try:
        root = T.unpack_archive(io.BytesIO(raw), target)
    except (ValueError, OSError, zipfile.BadZipFile) as error:
        # 拒んだときは何も残さない（unpack は検査を終えてから書くが、作った保存先は消す）
        shutil.rmtree(target, ignore_errors=True)
        raise ValueError(f"共有用のファイルを開けませんでした: {error}") from error
    return open_record(str(root))


def first_run_sample():
    """初めて開いた人に、同梱のクイックスタートガイドを写して開く記録フォルダを返す。初めてでなければ None。

    初めてかどうかはライブラリのファイルがあるかで決める。一覧から見本を外した人に、開くたび写し直さないため。
    配布物の中をそのまま開くと、書いたコメントが配布物に入って更新のときにぶつかるため、
    一覧と同じ保存先（~/.config/tsuzuri/samples/）へ写してから開く。
    すでに写しがあれば、書いたコメントを消さないよう写し直さずにそれを開く。
    """
    if T.registry_path().exists():
        return None
    target = T.registry_path().parent / "samples" / "quickstart"
    root = target / "クイックスタート.md.tsuzuri"
    if not root.is_dir():
        target.mkdir(parents=True, exist_ok=True)
        shutil.copytree(HERE / "quickstart" / root.name, root)
        # 配布元の文書は空の場合もあるため、確定した記録から本文を作る。
        (target / "クイックスタート.md").write_text(T._article(root, T._order(root)), encoding="utf-8")
        # 同梱の order.json は文書の場所を名前だけで持つ。写した先の場所に書き換える（画面の文書の欄がこれを出す）
        order = T._read_json(root / "order.json")
        (root / "order.json").unlink()
        T._write_json(root / "order.json", {**order, "document": str(target / "クイックスタート.md")}, immutable=True)
    return open_record(str(root))


def main(argv=None):
    """記録フォルダを確認してから、閲覧アプリを配る。"""
    # 略称を許すと、将来の引数の追加で既存の呼び出しが別の意味になるため
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0], allow_abbrev=False)
    parser.add_argument("record", nargs="?", help="記録フォルダ（<文書の名前>.tsuzuri）。省くと、ライブラリから始まる")
    parser.add_argument("--port", type=int, default=8770)
    parser.add_argument("--image-root", help="文書が ../ で指せる画像の範囲にするフォルダ。省くと git のルート（無ければ文書のフォルダ）。受け取った記録には効かない")
    args = parser.parse_args(argv)
    if args.image_root is not None:
        image_root = Path(args.image_root).expanduser().resolve()
        if not image_root.is_dir():
            parser.error(f"--image-root は存在するフォルダを指定してください: {image_root}")
        if _too_broad(image_root):
            parser.error(f"--image-root にファイルシステムの根やホームは指定できません: {image_root}")
        Handler.image_root = image_root
    if args.record:
        Handler.root = open_record(args.record)  # 壊れた記録なら、配る前に理由を出して止める
    else:
        Handler.root = first_run_sample()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"http://127.0.0.1:{args.port}/  （{Handler.root or 'ライブラリから'}）")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
