#!/usr/bin/env python3
"""閲覧アプリを試すための記録（app/sample/構想.md.tsuzuri）を、スキルのスクリプトで作り直す。

使い方: python3 app/sample/make_sample.py
本文は架空の短い提案。執筆意図・文機能・ずれ・レビュー・人の文・書き直し・コメントを一通り入れる。
一時フォルダで検査まで済ませてから、見本のフォルダを入れ替える。
"""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import tempfile

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent.parent / "skills" / "tsuzuri" / "scripts" / "tsuzuri.py"
DOC = HERE / "構想.md"
ROOT = Path(str(DOC) + ".tsuzuri")

REQUIREMENTS = """# 要件（振り返りの書き方の提案）

## 1. 依頼
毎週の振り返りを、箇条書きから理由まで書いた短い文章に変える提案を書く
## 2. 書く理由
箇条書きだけの振り返りでは、なぜそうしたかが残らない
## 3. 公開する場所と読み手
チームの共有ページ。読むのはチームのメンバー
## 4. 言いたいこと
振り返りは、理由まで書ける短い文章にしたほうがよい
"""

# (執筆意図, 文, 文機能, ずれ)。アプリの表示と試験のための架空の文章で、文機能は執筆意図と語彙の定義に照らして付けた
SENTENCES = [
    ("提案の中身を最初に示して、読み手が何の話かをつかめるようにする",
     "毎週の振り返りを、箇条書きから、理由まで書いた短い文章に変えてみたい。",
     {"relation": "段落の始まり", "importance": "核", "role": ["主張"], "technique": [], "place": "1. 依頼"}, None),
    ("変えたい理由を、いま困っていることから示す",
     "箇条書きだと、何をしたかは残っても、なぜそうしたかが残らない。",
     {"relation": "段落の始まり", "importance": "衛星", "role": ["理由"], "technique": [], "place": "2. 書く理由"}, None),
    ("理由を、実際に起きたことで支える",
     "先月の振り返りを読み返したとき、どうしてその順番で作業したのかを誰も思い出せなかった。",
     {"relation": "補足", "importance": "衛星", "role": ["根拠"], "technique": [], "place": "2. 書く理由"},
     "誰のせいかに読めないよう、出来事だけを書いた。"),
    ("提案の芯を一文で言う",
     "理由まで書いておけば、次に同じ判断をするときの手がかりになる。",
     {"relation": "順接", "importance": "核", "role": ["主張"], "technique": [], "place": "4. 言いたいこと"}, None),
    ("書く手間が増える心配に先回りして答える",
     "もちろん書く手間は増えるけれど、一週間に数文なら続けられる。",
     {"relation": "段落の始まり", "importance": "衛星", "role": ["評価", "主張"], "technique": ["譲歩", "誤解の先回り"], "place": "4. 言いたいこと"}, None),
]
# 人の文は執筆意図を持たない（スキルの「人の文を読む」）
# 人が書いた文。執筆意図は書き手のものが無いので、AI が文と前後から推測したもの（memo --inferred・ADR-0002）を付ける
HUMAN = ("書く時間は、金曜の最後の十五分に決めてしまえばいい。",
         {"relation": "添加", "importance": "核", "role": ["主張"], "technique": [], "place": "4. 言いたいこと"},
         "書く時間を曜日と長さで具体的に示し、読み手が今週から始めることができるようにする。")


def run(*args):
    """スキルのスクリプトを呼び、標準出力を返す。失敗したら止める。"""
    result = subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True,
                            env={**os.environ, "TSUZURI_NO_GITIGNORE": "1",
                                 "TSUZURI_REGISTRY": str(Path(args[1]).parent / "records.json")})
    if result.returncode != 0:
        sys.exit(f"失敗: {' '.join(args)}\n{result.stderr}")
    return result.stdout.strip()


def _build(root):
    run("init", str(root.parent / DOC.name))
    req = root.parent / ".req.md"
    req.write_text(REQUIREMENTS, encoding="utf-8")
    run("req", str(root), "--file", str(req))
    req.unlink()
    for memo, text, tags, deviation in SENTENCES:
        sid, ver = run("memo", str(root), "--text", memo).split()
        args = ["write", str(root), "--sid", sid, "--ver", ver, "--text", text, "--tags", json.dumps(tags, ensure_ascii=False)]
        if deviation:
            args += ["--deviation", deviation]
        run(*args)
    run("memo", str(root), "--inferred", "--text", HUMAN[2])
    run("write", str(root), "--human", "--text", HUMAN[0], "--tags", json.dumps(HUMAN[1], ensure_ascii=False))
    # 3文目を書き直して v002 を作る（バージョン履歴を見るため）
    sid, ver = run("memo", str(root), "--sid", "s0003", "--text",
                   "コメントを受けて、実際にあったことの報告でもあると副の役割で示す").split()
    run("write", str(root), "--sid", sid, "--ver", ver, "--text",
        "先月の振り返りを読み返したとき、どうしてその順番で作業したのかを、誰も思い出せなかった。",
        "--tags", json.dumps({"relation": "補足", "importance": "衛星", "role": ["根拠", "報告"], "technique": [], "place": "2. 書く理由"}, ensure_ascii=False))
    run("review", str(root), "--sid", "s0005", "--ver", "v001", "--aspect", "指摘：前の文とのつながり",
        "--text", "段落の頭で「もちろん」から入るが、何に対する譲歩かが前の段落から読み取りにくい。")
    run("export", str(root))
    # コメントはアプリだけが書く。試すための1件を、アプリと同じ形で置く（利用者の発言を装わない文にする）
    (root / "comments" / "c0001.json").write_text(json.dumps({
        "id": "c0001", "sid": "s0003", "ver": "v001", "to": "役割",
        "text": "根拠として置いた文だけど、実際にあったことの報告でもあるので副の役割で示してほしい。", "status": "resolved",
        "created_at": time.time_ns(), "resolved_at": time.time_ns()}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    run("check", str(root))
    order_path = root / "order.json"
    order = json.loads(order_path.read_text(encoding="utf-8"))
    order["document"] = DOC.name
    order_path.write_text(json.dumps(order, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    """見本を一時フォルダで完成させ、失敗時は既存の見本を保って入れ替える。"""
    staging = Path(tempfile.mkdtemp(prefix=".sample-", dir=HERE))
    root, backup = staging / ROOT.name, staging / "previous"
    installed = False
    try:
        _build(root)
        if ROOT.exists():
            ROOT.rename(backup)
        try:
            root.rename(ROOT)
        except OSError:
            if backup.exists():
                backup.rename(ROOT)
            raise
        installed = True
    finally:
        # 復元も失敗した場合は、残った見本を消さず手動で戻せるようにする。
        if installed or not backup.exists():
            shutil.rmtree(staging)
    print(ROOT)


if __name__ == "__main__":
    main()
