"""閲覧アプリのサーバー（app/server.py）の試験。見本の記録を一時フォルダに写して読み書きする。"""

import base64
import contextlib
import http.client
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
import zipfile
from unittest.mock import Mock, patch

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP))
import server  # noqa: E402

SAMPLE = APP / "sample" / "構想.md.tsuzuri"


class _HttpConnection:
    """ソケットの代わりに、HTTP要求と応答のバイト列を保持する。"""

    def __init__(self, data):
        self.input = io.BytesIO(data)
        self.output = io.BytesIO()

    def makefile(self, mode, *args):
        """標準のHTTPパーサーへ要求のストリームを渡す。"""
        return self.input

    def sendall(self, data):
        """ハンドラーが送る応答を保存する。"""
        self.output.write(data)


def request_url(request, *, forbid_body_read=False):
    """実際のHTTP解析・ハンドラー・応答解析を、ネットワークなしで通す。"""
    if isinstance(request, str):
        request = urllib.request.Request(request)
    url = urllib.parse.urlsplit(request.full_url)
    headers = {key.lower(): value for key, value in request.header_items()}
    headers.setdefault("host", url.netloc)
    body = request.data or b""
    if request.get_method() == "POST":
        headers.setdefault("content-length", str(len(body)))
    target = url.path + ("?" + url.query if url.query else "")
    wire = f"{request.get_method()} {target} HTTP/1.1\r\n" + "".join(f"{key}: {value}\r\n" for key, value in headers.items())
    connection = _HttpConnection(wire.encode() + b"\r\n" + body)
    if forbid_body_read:
        connection.input.read = Mock(side_effect=AssertionError("検査前に本文を読んだ"))
    server.Handler(connection, ("127.0.0.1", 18771), None)
    response = http.client.HTTPResponse(_HttpConnection(connection.output.getvalue()))
    response.begin()
    if response.status >= 400:
        raise urllib.error.HTTPError(request.full_url, response.status, "", response.headers, response)
    return response


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.root = self.tmp / "構想.md.tsuzuri"
        shutil.copytree(SAMPLE, self.root)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_load_document_reads_all_sentences_and_paragraphs(self):
        doc = server.load_document(self.root)
        self.assertEqual(len(doc["sentences"]), 6)
        self.assertEqual([s["paragraph_start"] for s in doc["sentences"]], [True, True, False, False, True, False])
        self.assertEqual(len(doc["sentences"][2]["versions"]), 2)
        self.assertEqual(doc["problems"], [])

    def test_record_stamp_changes_when_the_clock_moves_backwards(self):
        """未来の時刻が残っていても、時計が戻ったあとの保存を見逃さない。"""
        future = 2000000000
        os.utime(self.root, (future, future))
        os.utime(self.root / "comments", (100, 100))
        before = server.record_stamp(self.root)
        self.assertEqual(server.record_stamp(self.root), before)
        os.utime(self.root / "comments", (90, 90))
        self.assertNotEqual(server.record_stamp(self.root), before)
        before = server.record_stamp(self.root)
        status, _ = server._capture(server.T.main, ["memo", str(self.root), "--sid", "s0001", "--text", "言い直す"])
        self.assertEqual(status, 0)
        self.assertNotEqual(server.record_stamp(self.root), before)
        comment = server.add_comment(self.root, {"sid": "s0001", "ver": "v001", "text": "見直して"})
        before = server.record_stamp(self.root)
        server.set_status(self.root, comment["id"], "resolved")
        self.assertNotEqual(server.record_stamp(self.root), before)

    def test_retired_and_replaced_sentences_remain_readable(self):
        """削除・分割・統合の元の文は、本文と別に履歴を返し、コメントを開き直して消せる。"""
        for origins in (("s0001",), ("s0002",), ("s0004", "s0005")):
            with self.subTest(origins=origins):
                comments = [server.add_comment(self.root, {"sid": sid, "ver": "v001", "text": "直して"}) for sid in origins]
                if origins == ("s0001",):
                    status, _ = server._capture(server.T.main, ["retire", str(self.root), "--sid", origins[0], "--text", "重複"])
                else:
                    count = 2 if len(origins) == 1 else 1
                    for _ in range(count):
                        status, output = server._capture(server.T.main, ["memo", str(self.root), "--from", ",".join(origins), "--text", "置き換える"])
                        self.assertEqual(status, 0)
                        sid, ver = output[0].split()
                        tags = json.dumps({"place": "対応要件", "relation": "順接", "importance": "核", "role": ["解説"], "technique": []})
                        status, _ = server._capture(server.T.main, ["write", str(self.root), "--sid", sid, "--ver", ver, "--text", "新しい文。", "--tags", tags])
                        self.assertEqual(status, 0)
                self.assertEqual(status, 0)
                doc = server.load_document(self.root)
                for sid, comment in zip(origins, comments):
                    self.assertNotIn(sid, [s["sid"] for s in doc["sentences"]])
                    old = next(s for s in doc["retired_sentences"] if s["sid"] == sid)
                    self.assertEqual(old["versions"][-1]["text"], server.T._latest(self.root, sid)["text"])
                    server.set_status(self.root, comment["id"], "open")
                    read = next(c for c in server.load_document(self.root)["comments"] if c["id"] == comment["id"])
                    self.assertEqual(read["status"], "open")
                    server.delete_comment(self.root, comment["id"])
                    self.assertFalse((self.root / "comments" / f"{comment['id']}.json").exists())

    def test_retired_block_is_returned_as_a_block(self):
        """外した表は、本文から消え、外したものの一覧にブロックとして種類と中身つきで返る。"""
        status, output = server._capture(server.T.main, ["memo", str(self.root), "--block", "--text", "表で並べる"])
        self.assertEqual(status, 0)
        sid, ver = output[0].split()
        status, _ = server._capture(server.T.main, ["write", str(self.root), "--sid", sid, "--ver", ver, "--block", '{"kind":"table"}',
                                                    "--text", "| a |\n|---|\n| 1 |", "--tags", '{"place":"対応要件"}'])
        self.assertEqual(status, 0)
        status, _ = server._capture(server.T.main, ["retire", str(self.root), "--sid", sid, "--text", "箇条書きに置き換えた"])
        self.assertEqual(status, 0)
        doc = server.load_document(self.root)
        self.assertNotIn(sid, [s["sid"] for s in doc["sentences"]])
        old = next(s for s in doc["retired_sentences"] if s["sid"] == sid)
        self.assertEqual((old["kind"], old["block"]["kind"]), ("block", "table"))

    def test_old_version_comments_save_posting_time_latest(self):
        """宛先の旧版と、投稿時点の最新の版を文・要件・設計について別々に保存する。"""
        for kind, letter, item, text in (("requirements", "r", "1", "## 1. 依頼\n頼み\n"),
                                         ("design", "d", "p1", "要件定義書: r001\n\n## p1 主張\n")):
            (self.root / kind).mkdir(exist_ok=True)
            for n in (1, 2):
                (self.root / kind / f"{letter}{n:03d}.md").write_text(text + f"{n}\n", encoding="utf-8")
            made = server.add_comment(self.root, {"doc": kind, "ver": f"{letter}001", "item": item, "text": "直して"})
            self.assertEqual(made["posted_latest"], f"{letter}002")
            self.assertEqual(server.T._read_json(self.root / "comments" / f"{made['id']}.json")["posted_latest"], f"{letter}002")
            read = lambda: next(c for c in server.load_document(self.root)["comments"] if c["id"] == made["id"])
            self.assertEqual(read()["status"], "open")
            (self.root / kind / f"{letter}003.md").write_text(text + "直した\n", encoding="utf-8")
            self.assertEqual((read()["status"], read()["addressed_by"]), ("resolved", f"{letter}003"))
        made = server.add_comment(self.root, {"sid": "s0003", "ver": "v001", "text": "直して", "posted_latest": "v999"})
        self.assertEqual((made["ver"], made["posted_latest"]), ("v001", "v002"))
        self.assertEqual(server.T._read_json(self.root / "comments" / f"{made['id']}.json")["posted_latest"], "v002")
        read = lambda: next(c for c in server.load_document(self.root)["comments"] if c["id"] == made["id"])
        self.assertEqual(read()["status"], "open")
        status, _ = server._capture(server.T.main, ["write", str(self.root), "--human", "--sid", "s0003", "--text", "直した。", "--para", "p1",
            "--tags", json.dumps({"place": "対応要件", "relation": "順接", "importance": "核", "role": ["解説"], "technique": []})])
        self.assertEqual(status, 0)
        self.assertEqual((read()["status"], read()["addressed_by"]), ("resolved", "v003"))

    def test_load_document_lists_designs_and_paragraphs(self):
        # 見本は設計書より前の記録なので、設計書の一覧は空で、文の段落は null のまま読める（ADR-0003「前の記録はそのまま読む」）
        doc = server.load_document(self.root)
        self.assertEqual(doc["designs"], [])
        self.assertIsNone(doc["sentences"][0]["versions"][0]["para"])
        (self.root / "design").mkdir(exist_ok=True)
        (self.root / "design" / "d001.md").write_text("要件定義書: r001\n\n## p1 主張\n", encoding="utf-8")
        self.assertEqual(server.load_document(self.root)["designs"], ["d001"])

    def test_load_document_with_blocks_meta_and_comments(self):
        """ブロックと文を種類付きで読み、版の属性・付帯情報・コメントを返す。"""
        status, output = server._capture(server.T.main, ["memo", str(self.root), "--block", "--text", "箱を置く", "--after", "s0001"])
        self.assertEqual((status, output), (0, ["b0001 v001"]))
        status, _ = server._capture(server.T.main, ["write", str(self.root), "--sid", "b0001", "--ver", "v001",
                                                   "--block", '{"kind":"note","type":"info"}', "--text", "",
                                                   "--tags", '{"place":"対応要件"}'])
        self.assertEqual(status, 0)
        status, _ = server._capture(server.T.main, ["memo", str(self.root), "--inferred", "--text", "箱の中の文", "--after", "b0001"])
        self.assertEqual(status, 0)
        status, _ = server._capture(server.T.main, ["write", str(self.root), "--human", "--sid", "s0007", "--ver", "v001",
                                                   "--text", "注記。", "--in", "b0001",
                                                   "--tags", json.dumps({"place": "対応要件", "relation": "順接", "importance": "核",
                                                                         "role": ["解説"], "technique": []})])
        self.assertEqual(status, 0)
        meta = self.tmp / "meta.md"
        meta.write_text("title: 見本\n", encoding="utf-8")
        status, _ = server._capture(server.T.main, ["meta", str(self.root), "--file", str(meta)])
        self.assertEqual(status, 0)
        comment = server.add_comment(self.root, {"sid": "b0001", "ver": "v001", "text": "種類を見直して"})
        doc = server.load_document(self.root)
        block, child = doc["sentences"][1:3]
        self.assertEqual((block["sid"], block["kind"], block["block"]), ("b0001", "block", {"kind": "note", "type": "info"}))
        self.assertEqual(block["versions"][0]["block"], block["block"])
        self.assertEqual(block["versions"][0]["memo"], "箱を置く")
        self.assertFalse(block["paragraph_start"])
        self.assertEqual((child["kind"], child["versions"][0]["in"], child["paragraph_start"]), ("sentence", "b0001", True))
        # 人の文の執筆意図は推測の出どころ付きで渡し、AI のメモには出どころを付けない（ADR-0002）
        self.assertEqual((child["versions"][0]["memo"], child["versions"][0]["memo_by"]), ("箱の中の文", "inferred"))
        self.assertIsNone(block["versions"][0]["memo_by"])
        self.assertTrue(all(item["kind"] == "sentence" for item in doc["sentences"] if item["sid"].startswith("s")))
        self.assertEqual(doc["meta"], "title: 見本\n")
        self.assertIn(comment["id"], [item["id"] for item in doc["comments"]])
        self.assertEqual(doc["problems"], [])

    def test_paragraph_starts_use_shared_design_rule(self):
        """設計の段落番号による判定を CLI の共通関数から受け取る。"""
        (self.root / "design").mkdir(exist_ok=True)
        (self.root / "design/d001.md").write_text("要件定義書: r001\n\n## p1 前半\n\n## p2 後半\n", encoding="utf-8")
        for index, sid in enumerate(server.T._order(self.root)["order"]):
            path = server.T._versions(self.root, sid)[-1]
            sentence = server.T._read_json(path)
            sentence.update({"design": "d001", "para": "p1" if index < 2 else "p2"})
            server.T._write_json(path, sentence)
        with patch.object(server.T, "_paragraph_starts", wraps=server.T._paragraph_starts) as starts:
            doc = server.load_document(self.root)
        starts.assert_called_once()
        self.assertEqual([item["paragraph_start"] for item in doc["sentences"]], [True, False, True, False, False, False])
        self.assertIsNone(doc["meta"])

    def test_add_comment_writes_a_new_file(self):
        # 見本の記録には、画面で試したコメントが増えていくことがあるので、次の番号は今ある数から求める
        expected = f"c{len(list((self.root / 'comments').glob('c*.json'))) + 1:04d}"
        comment = server.add_comment(self.root, {"sid": "s0003", "ver": "v002", "to": "役割", "text": "報告にして"})
        self.assertEqual(comment["id"], expected)
        saved = json.loads((self.root / "comments" / f"{expected}.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["text"], "報告にして")
        self.assertEqual(saved["status"], "open")

    def test_delete_comment_removes_the_file_and_keeps_numbering(self):
        first = server.add_comment(self.root, {"sid": "s0003", "ver": "v002", "text": "打ち間違い"})
        second = server.add_comment(self.root, {"sid": "s0003", "ver": "v002", "text": "残す"})
        gone = server.delete_comment(self.root, first["id"])
        self.assertEqual(gone["text"], "打ち間違い")
        self.assertFalse((self.root / "comments" / f"{first['id']}.json").exists())
        # 間の番号を消しても、次の番号は一番大きい番号の次になり、残した書込と重ならない
        third = server.add_comment(self.root, {"sid": "s0003", "ver": "v002", "text": "次"})
        self.assertGreater(third["id"], second["id"])
        with self.assertRaises(OSError):
            server.delete_comment(self.root, first["id"])
        with self.assertRaises(ValueError):
            server.delete_comment(self.root, "../order")

    def test_add_comment_rejects_bad_input(self):
        for body in ({"sid": "s0003", "ver": "v009", "text": "x"},          # 無い版
                     {"sid": "s0003", "ver": "v001", "text": "  "},         # 空
                     {"sid": "s0003", "ver": "v001", "text": "x", "to": "<b>"},  # 項目名でない宛先
                     {"sid": "../x", "ver": "v001", "text": "x"}):          # ID でない
            with self.subTest(body=body), self.assertRaises(ValueError):
                server.add_comment(self.root, body)

    def test_comments_on_older_versions_read_as_addressed_until_reopened(self):
        """前のバージョンへの未解決のコメントは、新しいバージョンで対応済みとして読み、開き直せば次のバージョンまで開いたまま。"""
        comment = server.add_comment(self.root, {"sid": "s0003", "ver": "v001", "text": "直して"})
        read = lambda: next(c for c in server.load_document(self.root)["comments"] if c["id"] == comment["id"])
        # 新規コメントとは別に、posted_latest の無い既存コメントの互換性も守る。
        path = self.root / "comments" / f"{comment['id']}.json"
        legacy = server.T._read_json(path)
        del legacy["posted_latest"]
        server.T._write_json(path, legacy)
        self.assertEqual((read()["status"], read()["addressed_by"]), ("resolved", "v002"))
        self.assertEqual(json.loads((self.root / "comments" / f"{comment['id']}.json").read_text(encoding="utf-8"))["status"], "open")
        server.set_status(self.root, comment["id"], "open")
        self.assertEqual(read()["status"], "open")
        self.assertNotIn("addressed_by", read())
        tags = json.dumps({"place": "対応要件", "relation": "順接", "importance": "核", "role": ["解説"], "technique": []})
        status, _ = server._capture(server.T.main, ["write", str(self.root), "--human", "--sid", "s0003", "--text", "直した。", "--tags", tags])
        self.assertEqual(status, 0)
        self.assertEqual(read()["addressed_by"], "v003")
        current = server.add_comment(self.root, {"sid": "s0003", "ver": "v003", "text": "今の文へ"})
        self.assertEqual(next(c for c in server.load_document(self.root)["comments"] if c["id"] == current["id"])["status"], "open")

    def test_article_markdown_matches_export(self):
        """本文コピーの Markdown は export の text.md と同じ中身で、text.md を書き換えない。"""
        order = server.T._order(self.root)
        before = (self.root / "text.md").read_bytes() if (self.root / "text.md").exists() else None
        markdown = server.T._article(self.root, order)
        after = (self.root / "text.md").read_bytes() if (self.root / "text.md").exists() else None
        self.assertEqual(before, after)
        server.T._export(self.root, order)
        self.assertEqual((self.root / "text.md").read_text(encoding="utf-8"), markdown)

    def test_set_status_toggles(self):
        self.assertEqual(server.set_status(self.root, "c0001", "open")["status"], "open")
        self.assertEqual(server.set_status(self.root, "c0001", "resolved")["status"], "resolved")
        with self.assertRaises(ValueError):
            server.set_status(self.root, "c0001", "deleted")


class HttpTest(unittest.TestCase):
    """配る経路の守りを、要求から応答まで実際のHTTPハンドラーへ通して確かめる。"""

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.env = patch.dict(os.environ, {"HOME": str(cls.tmp), "TSUZURI_REGISTRY": str(cls.tmp / "records.json")})
        cls.env.start()
        root = cls.tmp / "構想.md.tsuzuri"
        shutil.copytree(SAMPLE, root)
        cls.root = root
        cls.previous_root = server.Handler.root
        server.Handler.root = root
        cls.base = "http://127.0.0.1:18771"

    @classmethod
    def tearDownClass(cls):
        server.Handler.root = cls.previous_root
        cls.env.stop()
        shutil.rmtree(cls.tmp)

    def _status(self, request):
        try:
            with request_url(request) as response:
                return response.status
        except urllib.error.HTTPError as error:
            return error.code

    def test_host_allowlist_applies_to_pages_reads_and_writes(self):
        """悪意のある Host と一致した Origin の組も、読込・書込とも拒否する。"""
        for host in ("evil.example", "127.0.0.1.evil.example", "localhost.evil.example", "127.1", "localhost@evil.example", "[::1].evil.example"):
            for path, data in (("/", None), ("/api/doc", None), ("/api/records", None), ("/api/comments", b"{}")):
                with self.subTest(host=host, path=path):
                    request = urllib.request.Request(self.base + path, data=data,
                        headers={"Host": host, "Origin": f"http://{host}", "Content-Type": "application/json"})
                    self.assertEqual(self._status(request), 403)
        for host in ("127.0.0.1", "localhost", "[::1]", "127.0.0.1:12345", "localhost:12345", "[::1]:12345"):
            self.assertEqual(self._status(urllib.request.Request(self.base + "/", headers={"Host": host})), 200)

    def test_bad_lengths_are_rejected_without_reading_the_body(self):
        """負数・非数値は本文を送らなくても直ちに400、大きすぎるものは413。"""
        for length, expected in (("-1", 400), ("abc", 400), ("+1", 400), ("99999999999999999999", 413)):
            with self.subTest(length=length):
                request = urllib.request.Request(self.base + "/api/comments", method="POST",
                    headers={"Content-Length": length, "Origin": self.base, "Content-Type": "application/json"})
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    request_url(request, forbid_body_read=True)
                self.assertEqual(caught.exception.code, expected)

    def test_markdown_rejects_bad_flavor(self):
        for flavor in ("bad", ""):
            self.assertEqual(self._status(self.base + "/api/markdown?flavor=" + flavor), 400)
        for flavor in server.T.FLAVORS:
            self.assertEqual(self._status(self.base + "/api/markdown?flavor=" + flavor), 200)

    def test_markdown_returns_full_text_and_body_without_meta(self):
        """全文（markdown）と、付帯情報を除いた本文だけ（body）を返す。付帯情報が無い記録では2つが一致する。"""
        for flavor in server.T.FLAVORS:
            with self.subTest(flavor=flavor, meta=False), request_url(self.base + "/api/markdown?flavor=" + flavor) as response:
                data = json.load(response)
                self.assertEqual(set(data), {"markdown", "body"})
                self.assertEqual(data["markdown"], data["body"])
        work = Path(tempfile.mkdtemp(dir=self.tmp))
        self.addCleanup(shutil.rmtree, work, ignore_errors=True)
        root = work / "構想.md.tsuzuri"
        shutil.copytree(SAMPLE, root)
        (root / "meta").mkdir()
        (root / "meta" / "m001.md").write_text("title: 付帯情報の試験\n", encoding="utf-8")
        with patch.object(server.Handler, "root", root):
            for flavor in server.T.FLAVORS:
                with self.subTest(flavor=flavor, meta=True), request_url(self.base + "/api/markdown?flavor=" + flavor) as response:
                    data = json.load(response)
                    # 付帯情報は全文にだけ入り、本文だけには入らない（画面が正規表現で剥がさずに済むようにする）
                    self.assertIn("付帯情報の試験", data["markdown"])
                    self.assertNotIn("付帯情報の試験", data["body"])
                    self.assertLess(len(data["body"]), len(data["markdown"]))

    def test_responses_carry_same_origin_resource_policy(self):
        """他サイトの <img> などから /api/image や API を読ませないため、成功・失敗・画像のどの応答にも付ける。"""
        for path in ("/", "/api/doc", "/api/markdown?flavor=gfm", "/api/image?src=missing.png", "/nothing"):
            with self.subTest(path=path):
                try:
                    with request_url(self.base + path) as response:
                        headers = response.headers
                except urllib.error.HTTPError as error:
                    headers = error.headers
                self.assertEqual(headers["Cross-Origin-Resource-Policy"], "same-origin")

    def test_markdown_flavor_error_follows_the_flavor_list(self):
        """断る文言の方言名は T.FLAVORS から組み、方言を足したときに古い一覧を出さない。"""
        for flavors in (server.T.FLAVORS, (*server.T.FLAVORS, "note")):
            with self.subTest(flavors=flavors), patch.object(server.T, "FLAVORS", flavors):
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    request_url(self.base + "/api/markdown?flavor=bad")
                self.assertEqual(caught.exception.code, 400)
                self.assertEqual(json.load(caught.exception)["error"], f"記法は {'・'.join(flavors)} から選択してください")

    def test_stale_tab_cannot_post_change_or_delete_other_record(self):
        """文章を切り替えたあと、同じ文ID・コメントIDへの古い画面からの3操作を409で断る。"""
        def post(path, body):
            """JSON の送信とエラー応答を同じ形で返す。"""
            request = urllib.request.Request(self.base + path, data=json.dumps(body).encode(),
                headers={"Content-Type": "application/json", "Origin": self.base})
            try:
                with request_url(request) as response:
                    return response.status, json.load(response)
            except urllib.error.HTTPError as error:
                return error.code, json.load(error)
        other = self.tmp / "別.md.tsuzuri"
        shutil.copytree(SAMPLE, other)
        self.addCleanup(shutil.rmtree, other)
        self.addCleanup(setattr, server.Handler, "root", self.root)
        with request_url(self.base + "/api/doc") as response:
            tab_a = json.load(response)
        self.assertEqual(post("/api/records/open", {"path": str(other)})[0], 200)
        before = {str(p.relative_to(other)): p.read_bytes() for p in other.rglob("*") if p.is_file()}
        for path, body in (("/api/comments", {"sid": "s0001", "ver": "v001", "text": "古い画面"}),
                           ("/api/comments/c0001/status", {"status": "open"}), ("/api/comments/c0001/delete", {})):
            for identity in ({}, {"record": tab_a["record"]}):
                status, body_returned = post(path, {**body, **identity})
                self.assertEqual(status, 409)
                self.assertIn("再読み込みして", body_returned["error"])
        self.assertEqual(before, {str(p.relative_to(other)): p.read_bytes() for p in other.rglob("*") if p.is_file()})
        status, made = post("/api/comments", {"record": str(other), "sid": "s0001", "ver": "v001", "text": "今の画面"})
        self.assertEqual(status, 200)
        self.assertEqual(post(f"/api/comments/{made['id']}/status", {"record": str(other), "status": "resolved"})[0], 200)
        self.assertEqual(post(f"/api/comments/{made['id']}/delete", {"record": str(other)})[0], 200)

    def test_app_version_changes_when_a_screen_file_changes(self):
        """開いたままの画面がアプリの更新を知れるよう、画面のファイルが変わると版が変わる。"""
        with request_url(self.base + "/api/app") as response:
            first = json.load(response)["version"]
        self.assertRegex(first, r"^[0-9a-f]{12}$")
        target = server.HERE / "tokens.css"
        info = target.stat()
        self.addCleanup(os.utime, target, ns=(info.st_atime_ns, info.st_mtime_ns))
        os.utime(target, ns=(info.st_atime_ns, info.st_mtime_ns + 1_000_000_000))
        self.assertNotEqual(server.app_version(), first)

    def test_prompts_come_from_the_skill_reference(self):
        """貼るプロンプトは参考資料のコードの枠の中そのもので、アプリに写しを持たない。"""
        with request_url(self.base + "/api/prompts") as response:
            prompts = json.load(response)["prompts"]
        source = (Path(server.T.__file__).resolve().parent.parent / "references" / "session-log-prompt.md").read_text(encoding="utf-8")
        self.assertEqual(len(prompts), 1)
        self.assertIn(f"```\n{prompts[0]['text']}\n```", source)
        self.assertTrue(prompts[0]["text"].startswith("この会話であなたが書いた文章について"))

    def test_unpack_opens_received_tsz_and_rejects_bad_files(self):
        """画面で選んだ .tsz は受け取りの置き場に展開して開き、同じ名前は別のフォルダに分け、壊れたものは何も残さず断る。"""
        def post(body):
            request = urllib.request.Request(self.base + "/api/records/unpack", data=json.dumps(body).encode(),
                headers={"Content-Type": "application/json", "Origin": self.base})
            try:
                with request_url(request) as response:
                    return response.status, json.load(response)
            except urllib.error.HTTPError as error:
                return error.code, json.load(error)
        self.addCleanup(setattr, server.Handler, "root", self.root)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            for path in sorted(SAMPLE.rglob("*")):
                if path.is_file():
                    archive.write(path, f"構想.md.tsuzuri/{path.relative_to(SAMPLE)}")
        data = base64.b64encode(buffer.getvalue()).decode()
        received = self.tmp / "received"
        for folder in ("共有", "共有-2"):
            status, body = post({"name": "共有.tsz", "data": data})
            self.assertEqual(status, 200, body)
            self.assertEqual(Path(body["path"]), received / folder / "構想.md.tsuzuri")
            self.assertEqual(server.Handler.root, received / folder / "構想.md.tsuzuri")
        for bad in ({"name": "x.zip", "data": data}, {"name": "x.tsz", "data": "!!"},
                    {"name": "../../x.tsz", "data": base64.b64encode(b"not a zip").decode()}):
            with self.subTest(bad=bad["name"]):
                self.assertEqual(post(bad)[0], 400)
        self.assertEqual(sorted(p.name for p in received.iterdir()), ["共有", "共有-2"])

    def test_foreign_origin_is_refused(self):
        body = json.dumps({"sid": "s0001", "ver": "v001", "text": "x"}).encode()
        request = urllib.request.Request(self.base + "/api/comments", data=body, method="POST",
                                         headers={"Content-Type": "application/json", "Origin": "http://evil.example"})
        self.assertEqual(self._status(request), 403)

    def test_text_plain_is_refused(self):
        request = urllib.request.Request(self.base + "/api/comments", data=b"{}", method="POST",
                                         headers={"Content-Type": "text/plain", "Origin": self.base})
        self.assertEqual(self._status(request), 403)

    def test_static_cannot_escape_its_folder(self):
        self.assertEqual(self._status(self.base + "/icons/..%2Fserver.py"), 404)
        self.assertEqual(self._status(self.base + "/api/req/..%2F..%2Forder"), 404)
        self.assertEqual(self._status(self.base + "/api/design/..%2F..%2Forder"), 404)
        self.assertEqual(self._status(self.base + "/api/design/d001"), 404)   # 見本には設計書が無い

    def test_image_serves_only_images_beside_the_document(self):
        """画像のブロックの画像は、文書のフォルダより下の画像だけを返し、外へ出るパス・隠しフォルダ・リンク・画像でないものは断る。"""
        png = b"\x89PNG\r\n\x1a\n" + b"\0" * 16
        (self.tmp / "img").mkdir(exist_ok=True)
        (self.tmp / "img" / "logo.png").write_bytes(png)
        (self.tmp / ".secret").mkdir(exist_ok=True)
        (self.tmp / ".secret" / "a.png").write_bytes(png)
        (self.tmp / "notes.txt").write_text("x", encoding="utf-8")
        outside = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, outside)
        (outside / "o.png").write_bytes(png)
        link = self.tmp / "link.png"
        if not link.exists():
            link.symlink_to(outside / "o.png")
        (self.tmp / "dir-link").unlink(missing_ok=True)
        (self.tmp / "dir-link").symlink_to(outside, target_is_directory=True)
        (self.tmp / "fifo.png").unlink(missing_ok=True)
        os.mkfifo(self.tmp / "fifo.png")   # 名前付きパイプを開いても待たずに断る
        (self.tmp / "big.png").write_bytes(png + b"\0" * 64)
        self.addCleanup(setattr, server, "MAX_IMAGE", server.MAX_IMAGE)
        server.MAX_IMAGE = 40
        # 記述子で1段ずつ開く経路と、それができない環境（Windows）の経路の両方で確かめる
        for mode, dir_fd in (("記述子", os.supports_dir_fd), ("パス", set())):
            with patch.object(server.os, "supports_dir_fd", dir_fd):
                with request_url(self.base + "/api/image?src=" + urllib.parse.quote("img/logo.png")) as response:
                    self.assertEqual(response.read(), png)
                    self.assertEqual(response.headers["Content-Type"], "image/png")
                    self.assertIn("sandbox", response.headers["Content-Security-Policy"])
                # 許可範囲の中へ畳める ".." と "." は通し、範囲の外へ出る ".." は、あとで戻る形でも断る
                for good in ("img/../img/logo.png", "./img/logo.png", "img/./logo.png", "img//logo.png"):
                    with self.subTest(mode=mode, src=good):
                        self.assertEqual(self._status(self.base + "/api/image?src=" + urllib.parse.quote(good)), 200)
                for bad in ("../o.png", "img/../../o.png", f"img/../../{self.tmp.name}/img/logo.png", "img/../.secret/a.png", "..",
                            "img/..", "/etc/hostname", ".secret/a.png", "link.png", "dir-link/o.png",
                            "notes.txt", "https://example.com/a.png", "img\\logo.png", "img/missing.png", "",
                            "img/C:logo.png", "notes.txt:x.png", "con.png", "img/logo.png.", "fifo.png", "big.png"):
                    with self.subTest(mode=mode, src=bad):
                        self.assertEqual(self._status(self.base + "/api/image?src=" + urllib.parse.quote(bad)), 404)

    # 画像の許可範囲の試験で使う。記述子で1段ずつ開く経路と、それができない環境（Windows）の経路の両方を回す
    PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 16

    def _modes(self):
        """(経路の名前, supports_dir_fd) の組。パスの経路は dir_fd を使えない環境を真似る。"""
        return (("記述子", os.supports_dir_fd), ("パス", set()))

    def _image_status(self, root, src, image_root=None):
        """root を開いた状態で /api/image を呼び、状態コードを返す。"""
        with patch.object(server.Handler, "root", root), patch.object(server.Handler, "image_root", image_root):
            return self._status(self.base + "/api/image?src=" + urllib.parse.quote(src))

    def _make_repo(self, git_as_file=False):
        """git のルートの下に docs/sub の文書と、外へ出る罠を置き、(作業場所, リポジトリ, 記録) を返す。"""
        work = Path(tempfile.mkdtemp(dir=self.tmp))
        self.addCleanup(shutil.rmtree, work, ignore_errors=True)
        repo = work / "repo"
        root = repo / "docs" / "sub" / "hogehoge.md.tsuzuri"
        shutil.copytree(SAMPLE, root)
        # worktree の .git はフォルダでなくファイル
        if git_as_file:
            (repo / ".git").write_text("gitdir: /elsewhere/worktrees/x\n", encoding="utf-8")
        else:
            (repo / ".git").mkdir()
        # 文書は docs/sub なので、../images は docs/images、../../images はリポジトリ直下の images を指す
        for images in (repo / "docs" / "images", repo / "images"):
            images.mkdir()
            (images / "image.png").write_bytes(self.PNG)
        (repo / "docs" / "sub" / "near.png").write_bytes(self.PNG)
        (repo / "docs" / ".hidden").mkdir()
        (repo / "docs" / ".hidden" / "a.png").write_bytes(self.PNG)
        (work / "outside.png").write_bytes(self.PNG)
        outside = work / "outside-dir"
        outside.mkdir()
        (outside / "o.png").write_bytes(self.PNG)
        (repo / "docs" / "images" / "link-to-outside.png").symlink_to(work / "outside.png")
        (repo / "docs" / "images" / "linkdir").symlink_to(outside, target_is_directory=True)
        return work, repo, root

    def test_image_parent_path_is_served_inside_the_git_root(self):
        """.git のフォルダでもファイルでも、git のルートの中なら ../ で上の画像フォルダを指せる。"""
        for git_as_file in (False, True):
            _, repo, root = self._make_repo(git_as_file)
            for mode, dir_fd in self._modes():
                with patch.object(server.os, "supports_dir_fd", dir_fd):
                    for src in ("../images/image.png", "../../images/image.png", "near.png", "../sub/near.png"):
                        with self.subTest(mode=mode, git_as_file=git_as_file, src=src):
                            self.assertEqual(self._image_status(root, src), 200)
                    with self.subTest(mode=mode, git_as_file=git_as_file, check="body"):
                        with patch.object(server.Handler, "root", root), request_url(self.base + "/api/image?src=" + urllib.parse.quote("../images/image.png")) as response:
                            self.assertEqual(response.read(), self.PNG)

    def test_image_cannot_leave_the_git_root_or_follow_hidden_and_links(self):
        """git のルートより外・隠しフォルダ・外へ向かうリンクは、上の画像フォルダを許しても断る。"""
        _, repo, root = self._make_repo()
        for mode, dir_fd in self._modes():
            with patch.object(server.os, "supports_dir_fd", dir_fd):
                for src in ("../../../outside.png", "../../../../outside.png", "../../../outside-dir/o.png",
                            "../.hidden/a.png", "../images/link-to-outside.png", "../images/linkdir/o.png",
                            "../images/../.hidden/a.png", "../../.git/config.png", "../images/missing.png",
                            # 一度範囲の外へ出てから、名前で範囲の中へ戻る形も断る
                            f"../../../{repo.parent.name}/repo/docs/images/image.png", "../.."):
                    with self.subTest(mode=mode, src=src):
                        self.assertEqual(self._image_status(root, src), 404)

    def test_received_record_stays_beside_its_document(self):
        """受け取った記録は、親に .git があっても --image-root があっても、文書のフォルダの外の画像を読ませない。"""
        _, repo, root = self._make_repo()
        order = json.loads((root / "order.json").read_text(encoding="utf-8"))
        (root / "order.json").write_text(json.dumps({**order, "received": True}, ensure_ascii=False), encoding="utf-8")
        # received/ の下に置いた記録は、order.json に印が無くても受け取ったものとして扱う
        received = self.tmp / "received"
        made_received = not received.exists()
        folder = received / "受領-画像の試験"
        self.addCleanup(shutil.rmtree, folder, ignore_errors=True)
        if made_received:
            self.addCleanup(lambda: received.rmdir() if received.is_dir() and not any(received.iterdir()) else None)
        (folder / ".git").mkdir(parents=True)
        (folder / "images").mkdir()
        (folder / "images" / "image.png").write_bytes(self.PNG)
        (folder / "docs").mkdir()
        (folder / "docs" / "near.png").write_bytes(self.PNG)
        by_path = folder / "docs" / "doc.md.tsuzuri"
        shutil.copytree(SAMPLE, by_path)
        for label, target, near in (("印", root, "near.png"), ("置き場", by_path, "near.png")):
            location = repo / "docs" / "sub" if target == root else folder / "docs"
            for mode, dir_fd in self._modes():
                with patch.object(server.os, "supports_dir_fd", dir_fd):
                    for image_root in (None, repo if target == root else folder):
                        with self.subTest(mode=mode, by=label, image_root=image_root):
                            self.assertEqual(self._image_status(target, "../images/image.png", image_root), 404)
                            self.assertEqual(self._image_status(target, near, image_root), 200)
            self.assertEqual(server._image_boundary(target, location.parent), location.resolve())
        # order.json が読めない記録も、安全側で受け取ったものとして扱う
        (root / "order.json").write_text("{", encoding="utf-8")
        self.assertEqual(server._image_boundary(root, repo), root.parent.resolve())

    def test_image_root_widens_the_range_without_git(self):
        """git が無いフォルダでも --image-root を指定すればその範囲の ../ を通し、その外は断る。"""
        work = Path(tempfile.mkdtemp(dir=self.tmp))
        self.addCleanup(shutil.rmtree, work, ignore_errors=True)
        project = work / "project"
        root = project / "docs" / "doc.md.tsuzuri"
        shutil.copytree(SAMPLE, root)
        (project / "images").mkdir()
        (project / "images" / "image.png").write_bytes(self.PNG)
        (work / "outside.png").write_bytes(self.PNG)
        unrelated = work / "unrelated"
        unrelated.mkdir()
        for mode, dir_fd in self._modes():
            with patch.object(server.os, "supports_dir_fd", dir_fd):
                with self.subTest(mode=mode):
                    self.assertEqual(self._image_status(root, "../images/image.png", project), 200)
                    self.assertEqual(self._image_status(root, "../../outside.png", project), 404)
                    # 指定が無ければ従来どおり文書のフォルダに閉じる
                    self.assertEqual(self._image_status(root, "../images/image.png"), 404)
                    # 文書を含まない指定は使わず、文書のフォルダに閉じる
                    self.assertEqual(self._image_status(root, "../images/image.png", unrelated), 404)

    def test_image_boundary_decisions(self):
        """許可範囲は、受け取った記録＞明示指定＞git のルート＞文書のフォルダの順で決まり、ホームと根は広げない。"""
        work, repo, root = self._make_repo()
        doc_dir = root.parent.resolve()
        self.assertEqual(server._image_boundary(root), repo.resolve())
        # 文書を含む指定はそれを使い、含まない指定と、根・ホームの指定は文書のフォルダに閉じる
        self.assertEqual(server._image_boundary(root, repo / "docs"), (repo / "docs").resolve())
        self.assertEqual(server._image_boundary(root, work / "elsewhere"), doc_dir)
        self.assertEqual(server._image_boundary(root, Path("/")), doc_dir)
        self.assertEqual(server._image_boundary(root, self.tmp), doc_dir)
        # ホームに .git があっても、ホーム全体を範囲にしない
        (self.tmp / ".git").mkdir()
        self.addCleanup(shutil.rmtree, self.tmp / ".git", ignore_errors=True)
        bare = work / "bare" / "doc.md.tsuzuri"
        shutil.copytree(SAMPLE, bare)
        self.assertEqual(server._image_boundary(bare), bare.parent.resolve())
        # git が無ければ文書のフォルダ（fail-closed）
        self.assertEqual(server._image_boundary(self.root), self.root.parent.resolve())

    def test_too_broad_rejects_home_ancestors_config_and_mounts(self):
        """根・ホーム・ホームの祖先・設定の保存先・マウントポイントは、画像の許可範囲にするには広すぎる。"""
        home = Path(tempfile.mkdtemp(dir=self.tmp)).resolve()
        self.addCleanup(shutil.rmtree, home, ignore_errors=True)
        (home / ".config" / "tsuzuri").mkdir(parents=True)
        (home / "project").mkdir()
        xdg = home / "xdg-config"
        xdg.mkdir()
        with patch.dict(os.environ, {"HOME": str(home), "XDG_CONFIG_HOME": str(xdg)}):
            for broad in (Path("/"), home, home.parent, home / ".config", xdg):
                with self.subTest(broad=str(broad)):
                    self.assertTrue(server._too_broad(broad))
            # ホームの下の普通のフォルダと、設定の下の個別の保存先は、範囲にしてよい
            for narrow in (home / "project", home / ".config" / "tsuzuri"):
                with self.subTest(narrow=str(narrow)):
                    self.assertFalse(server._too_broad(narrow))
            with patch.object(server.os.path, "ismount", side_effect=lambda path: path == str(home / "project")):
                self.assertTrue(server._too_broad(home / "project"))

    def test_git_root_in_config_or_home_ancestor_is_not_used_as_boundary(self):
        """~/.config/.git があっても、サンプルの記録から ~/.config 全体を許可範囲にしない。"""
        home = Path(tempfile.mkdtemp(dir=self.tmp)).resolve()
        self.addCleanup(shutil.rmtree, home, ignore_errors=True)
        root = home / ".config" / "tsuzuri" / "samples" / "quickstart" / "doc.md.tsuzuri"
        shutil.copytree(SAMPLE, root)
        (home / ".config" / ".git").mkdir()
        (home / ".config" / "secret.png").write_bytes(self.PNG)
        (home.parent / ".git").mkdir(exist_ok=True)
        self.addCleanup(shutil.rmtree, home.parent / ".git", ignore_errors=True)
        with patch.dict(os.environ, {"HOME": str(home), "XDG_CONFIG_HOME": ""}):
            self.assertEqual(server._image_boundary(root), root.parent.resolve())
            self.assertEqual(server._image_boundary(root, home / ".config"), root.parent.resolve())
            for mode, dir_fd in self._modes():
                with patch.object(server.os, "supports_dir_fd", dir_fd), self.subTest(mode=mode):
                    self.assertEqual(self._image_status(root, "../../../../secret.png"), 404)

    def test_image_boundary_replaced_by_a_symlink_is_refused(self):
        """許可範囲を決めたあとに範囲そのものがリンクへ差し替わっても、辿らずに断る（記述子の経路）。"""
        if not (hasattr(os, "O_NOFOLLOW") and hasattr(os, "O_DIRECTORY") and os.open in os.supports_dir_fd):
            self.skipTest("この環境では記述子で1段ずつ開けない")
        work = Path(tempfile.mkdtemp(dir=self.tmp)).resolve()
        self.addCleanup(shutil.rmtree, work, ignore_errors=True)
        real = work / "real"
        (real / "doc.md.tsuzuri").parent.mkdir(parents=True)
        shutil.copytree(SAMPLE, real / "doc.md.tsuzuri")
        (real / "image.png").write_bytes(self.PNG)
        link = work / "link"
        link.symlink_to(real, target_is_directory=True)
        root = real / "doc.md.tsuzuri"
        self.assertEqual(server.document_image(root, "image.png")[0], self.PNG)
        with patch.object(server, "_image_boundary", return_value=link), \
                patch.object(server, "_descend_from_boundary", return_value=(["image.png"], 0)):
            with self.assertRaises((ValueError, OSError)):
                server.document_image(root, "image.png")

    def test_image_rejects_control_and_format_characters(self):
        """双方向制御などの制御・書式文字を含む名前は断り、結合絵文字の ZWJ と異体字セレクタは正当な名前として通す。"""
        _, repo, root = self._make_repo()
        (repo / "docs" / "images" / "a\u200db.png").write_bytes(self.PNG)
        (repo / "docs" / "images" / "\u2764\ufe0f.png").write_bytes(self.PNG)
        (repo / "docs" / "images" / "evil\u202egnp.png").write_bytes(self.PNG)
        for mode, dir_fd in self._modes():
            with patch.object(server.os, "supports_dir_fd", dir_fd):
                for src in ("../images/a\u200db.png", "../images/\u2764\ufe0f.png"):
                    with self.subTest(mode=mode, src=src):
                        self.assertEqual(self._image_status(root, src), 200)
                for src in ("../images/evil\u202egnp.png", "../images/\u202eimage.png", "../images/image\u2066.png",
                            "../images/ima\x07ge.png", "../images/ima\x1bge.png", "../images/\u200bimage.png"):
                    with self.subTest(mode=mode, src=src):
                        self.assertEqual(self._image_status(root, src), 404)

    def test_doc_and_page_are_served(self):
        self.assertEqual(self._status(self.base + "/"), 200)
        self.assertEqual(self._status(self.base + "/api/doc"), 200)


class RecordsTest(unittest.TestCase):
    """ライブラリの一覧と、開く記録の切り替え（AI 経由でしか開けないと不便なため）。"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.root = self.tmp / "構想.md.tsuzuri"
        shutil.copytree(SAMPLE, self.root)
        # 利用者の一覧（~/.config/tsuzuri）を書き換えないよう、一覧を一時フォルダへ向ける
        env = patch.dict("os.environ", {"HOME": str(self.tmp), "TSUZURI_REGISTRY": str(self.tmp / "records.json")})
        env.start()
        self.addCleanup(env.stop)
        previous = server.Handler.root
        self.addCleanup(lambda: setattr(server.Handler, "root", previous))

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_open_record_registers_and_refuses_other_folders(self):
        self.assertEqual(server.open_record(str(self.root)), self.root.resolve())
        self.assertEqual(server.T.read_registry(), [str(self.root.resolve())])
        server.open_record(str(self.root))   # 2回開いても一覧は1行
        self.assertEqual(len(server.T.read_registry()), 1)
        with self.assertRaises(ValueError):
            server.open_record(str(self.tmp))          # 記録フォルダでないフォルダは開かせない
        with self.assertRaises(ValueError):
            server.open_record(str(self.tmp / "無い.md.tsuzuri"))
        # 人は記録フォルダより文書のパスを覚えているので、文書のパスでも隣の記録を開く
        self.assertEqual(server.open_record(str(self.tmp / "構想.md")), self.root.resolve())

    def test_summary_counts_and_missing_records(self):
        row = server.record_summary(self.root)
        self.assertTrue(row["exists"])
        self.assertEqual((row["name"], row["sentences"]), (f"{self.tmp.name}/構想.md", 6))
        self.assertGreaterEqual(row["open"], 0)
        # 検索に使う本文は最新の文をつないだもの。依頼は要件定義書の「1.」の節だけ
        latest = server.load_document(self.root)["sentences"][2]["versions"][-1]["text"]
        self.assertIn(latest, row["text"])
        (self.root / "requirements").mkdir(exist_ok=True)
        (self.root / "requirements" / "r009.md").write_text("## 1. 依頼\nQiita の記事。\n色の話。\n\n## 2. 言いたいこと\n別の節\n", encoding="utf-8")
        self.assertEqual(server.record_summary(self.root)["request"], "Qiita の記事。 色の話。")
        self.assertFalse(server.record_summary(self.tmp / "消えた.md.tsuzuri")["exists"])

    def test_records_list_keeps_healthy_rows_when_another_is_broken(self):
        """確定版の欠損・壊れたJSON・本文欠落の各場合で、正常な文章を一覧から開ける。"""
        server.T.register_record(self.root)
        broken = self.tmp / "破損.md.tsuzuri"
        shutil.copytree(SAMPLE, broken)
        server.T.register_record(broken)
        base = "http://127.0.0.1:18771"
        path = broken / "sentences/s0001/v001.json"
        for contents in (None, "{", '{}'):
            if contents is None:
                path.unlink()
            else:
                path.write_text(contents, encoding="utf-8")
            with self.subTest(contents=contents), request_url(base + "/api/records") as response:
                rows = json.load(response)["records"]
                self.assertEqual([(r["path"], r["exists"]) for r in rows], [(str(self.root), True), (str(broken), False)])
            request = urllib.request.Request(base + "/api/records/open", data=json.dumps({"path": str(self.root)}).encode(),
                headers={"Content-Type": "application/json", "Origin": base})
            self.assertEqual(request_url(request).status, 200)

    def test_templates_and_dictionary_are_shown_without_an_open_record(self):
        """テンプレートと校正辞書は記録を開く前でも返し、標準と自分を分け、同じ名前の自分のテンプレートは置き換えと示す。"""
        mine = self.tmp / "templates"
        mine.mkdir()
        (mine / "README.md").write_text("# README\n自分の README の骨組み。\n", encoding="utf-8")
        (mine / "社内記事.md").write_text("# 社内記事\n社内の記事に使う。\n", encoding="utf-8")
        words = self.tmp / "words.tsv"
        words.write_text("頼む\t依頼する\t文語で\n", encoding="utf-8")
        base = "http://127.0.0.1:18771"
        server.Handler.root = None
        with patch.dict("os.environ", {"TSUZURI_TEMPLATES": str(mine), "TSUZURI_WORDS": str(words)}):
            with request_url(base + "/api/templates") as response:
                body = json.load(response)
            with request_url(base + "/api/dictionary") as response:
                dictionary = json.load(response)
        rows = {r["name"]: r for r in body["templates"]}
        self.assertEqual((rows["README"]["source"], rows["README"]["replaces"]), ("自分", True))
        self.assertEqual((rows["社内記事"]["scene"], rows["社内記事"]["replaces"]), ("社内の記事に使う。", False))
        self.assertEqual(rows["ブログとエッセイ"]["source"], "標準")
        self.assertEqual(body["user_dir"], str(mine))
        self.assertIn(("頼む", "依頼する", "自分"), [(r["pattern"], r["to"], r["source"]) for r in dictionary["rows"]])
        self.assertEqual(dictionary["user_path"], str(words))

    def test_unreadable_template_is_listed_with_its_error_and_others_still_load(self):
        """UTF-8 で読めないテンプレートと *.md という名前のフォルダがあっても、ほかのテンプレートは返し、読めないものは理由を添える。"""
        mine = self.tmp / "templates"
        mine.mkdir()
        (mine / "壊れた.md").write_bytes("# 壊れた\n".encode("cp932"))
        (mine / "フォルダ.md").mkdir()
        (mine / "使える.md").write_text("# 使える\n使う場面。\n", encoding="utf-8")
        server.Handler.root = None
        with patch.dict("os.environ", {"TSUZURI_TEMPLATES": str(mine)}):
            with request_url("http://127.0.0.1:18771/api/templates") as response:
                rows = {r["name"]: r for r in json.load(response)["templates"]}
        self.assertEqual(rows["使える"]["scene"], "使う場面。")
        self.assertIn("UTF-8", rows["壊れた"]["error"])
        self.assertNotIn("フォルダ", rows)

    def test_first_run_copies_the_quickstart_once_and_keeps_written_comments(self):
        root = server.first_run_sample()
        sample = self.tmp / "samples" / "quickstart" / "クイックスタート.md.tsuzuri"
        self.assertEqual(root, sample.resolve())
        self.assertEqual({p.name for p in sample.parent.iterdir()}, {sample.name, "クイックスタート.md"})
        self.assertEqual((sample.parent / "クイックスタート.md").read_text(encoding="utf-8"), server.T._article(root, server.T._order(root)))
        self.assertEqual(server.T.read_registry(), [str(sample.resolve())])
        # 文書の欄は写した先を指す。同梱の名前だけの値や、作った人の PC のパスを出さない
        self.assertEqual(server.load_document(root)["document"], str(sample.parent / "クイックスタート.md"))
        self.assertEqual(server.load_document(root)["problems"], [])
        # 一覧ができたあとは、見本を外しても写し直さない
        server.T.forget_record(str(sample.resolve()))
        self.assertIsNone(server.first_run_sample())
        # 一覧を消しても、書いたコメントのある写しは上書きせずに開き直す
        server.add_comment(root, {"sid": "s0001", "ver": "v001", "text": "試しの書込", "to": None})
        server.T.registry_path().unlink()
        self.assertEqual(server.first_run_sample(), sample.resolve())
        texts = [c["text"] for c in server.load_document(root)["comments"]]
        self.assertIn("試しの書込", texts)

    def test_comments_on_requirement_items(self):
        """要件定義書の項目へのコメントを受け付け、無い項目は断り、開き直したら今の最新を覚える（ADR-0005）。"""
        (self.root / "requirements" / "r002.md").write_text("## 1. 依頼\n頼み\n\n## 2. 書く理由\n理由\n", encoding="utf-8")
        made = server.add_comment(self.root, {"doc": "requirements", "ver": "r002", "item": "2", "text": "理由が弱い", "to": "役割"})
        self.assertEqual((made["doc"], made["item"], made["to"]), ("requirements", "2", None))
        self.assertNotIn("sid", made)
        with self.assertRaises(ValueError):
            server.add_comment(self.root, {"doc": "requirements", "ver": "r002", "item": "9", "text": "無い項目"})
        with self.assertRaises(ValueError):
            server.add_comment(self.root, {"doc": "../x", "ver": "r002", "item": "1", "text": "変な種類"})
        listed = [c for c in server.load_document(self.root)["comments"] if c.get("doc")]
        self.assertEqual((listed[0]["status"], listed[0]["current_text"]), ("open", "## 2. 書く理由\n理由"))
        (self.root / "requirements" / "r003.md").write_text("## 1. 依頼\n頼み\n\n## 2. 書く理由\nもっと強い理由\n", encoding="utf-8")
        self.assertEqual([c for c in server.load_document(self.root)["comments"] if c.get("doc")][0]["addressed_by"], "r003")
        self.assertEqual(server.set_status(self.root, made["id"], "open")["reopened_at_ver"], "r003")
        self.assertEqual([c for c in server.load_document(self.root)["comments"] if c.get("doc")][0]["status"], "open")

    def test_main_validates_image_root_before_serving(self):
        """--image-root は存在するフォルダだけを受け付け、根・ホーム・ファイルと、略称での指定は起動前に断る。"""
        (self.tmp / "file.txt").write_text("x", encoding="utf-8")
        for args in (["--image-root", str(self.tmp / "無い")], ["--image-root", str(self.tmp / "file.txt")],
                     ["--image-root", "/"], ["--image-root", str(self.tmp)], ["--image", str(self.tmp / "sub")]):
            with self.subTest(args=args), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as caught:
                    server.main(args)
                self.assertEqual(caught.exception.code, 2)

    def test_server_without_record_starts_from_the_list(self):
        server.Handler.root = None
        server.T.register_record(self.root)
        base = "http://127.0.0.1:18771"
        with self.assertRaises(urllib.error.HTTPError) as caught:
            request_url(base + "/api/doc")
        self.assertEqual(caught.exception.code, 409)
        with request_url(base + "/api/records") as response:
            listed = json.load(response)
        self.assertIsNone(listed["current"])
        self.assertEqual([r["path"] for r in listed["records"]], [str(self.root.resolve())])
        body = json.dumps({"path": str(self.root)}).encode()
        request = urllib.request.Request(base + "/api/records/open", data=body, method="POST",
                                         headers={"Content-Type": "application/json", "Origin": base})
        with request_url(request) as response:
            self.assertTrue(json.load(response)["exists"])
        with request_url(base + "/api/doc") as response:
            self.assertEqual(len(json.load(response)["sentences"]), 6)

    def test_katex_vendor_assets_and_csp(self):
        """同梱の KaTeX 本体・CSS・woff2 フォントが配信され、CSP が 'self' のフォントを許す。"""
        base = "http://127.0.0.1:18771"
        with request_url(base + "/") as response:
            self.assertIn("font-src 'self'", response.headers["Content-Security-Policy"])
        with request_url(base + "/web/vendor/katex/katex.min.js") as response:
            self.assertEqual(response.status, 200)
            self.assertIn("javascript", response.headers["Content-Type"])
        with request_url(base + "/web/vendor/katex/katex.min.css") as response:
            self.assertEqual(response.status, 200)
            self.assertIn("text/css", response.headers["Content-Type"])
        with request_url(base + "/web/vendor/katex/fonts/KaTeX_Main-Regular.woff2") as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["Content-Type"], "font/woff2")


if __name__ == "__main__":
    unittest.main()
