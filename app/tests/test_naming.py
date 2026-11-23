"""作る側の呼び名が、画面の文字列と同梱のクイックスタートガイドに漏れていないかを見る試験。

漏れは4回起きた。どれも、書き手が作る側の呼び名を拾って
画面の名前として書いた形だった。決まりを文章で足しても防げなかったので、呼び名の表（app/naming/internal-names.tsv）を
機械で当てる。
"""

import json
import re
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
TABLE = APP / "naming" / "internal-names.tsv"
QUICKSTART = APP / "quickstart" / "クイックスタート.md.tsuzuri"


def rules():
    """表を (探す形, 画面の言葉) の並びにする。# の行と空の行は読まない。"""
    found = []
    for line in TABLE.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        cells = line.split("\t")
        found.append((re.compile(cells[0]), cells[1]))
    return found


def visible(text):
    """JS と HTML のコメントを外す。コメントには作る側の呼び名が残ってよい（コードを読む人のための言葉）。"""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    # 行のコメント。URL の // と文字列の中の // は残したいので、行頭か空白のあとの // だけを外す
    return re.sub(r"(?m)(^|\s)//.*$", r"\1", text)


def quickstart_texts():
    """同梱のガイドの、並びにある文とブロックの最新のバージョンの字と執筆意図を返す。"""
    order = json.loads((QUICKSTART / "order.json").read_text(encoding="utf-8"))["order"]
    for sid in order:
        folder = QUICKSTART / ("blocks" if sid.startswith("b") else "sentences") / sid
        latest = sorted(p for p in folder.glob("v*.json") if not p.name.endswith("-memo.json"))[-1]
        yield f"{sid} {latest.stem}", json.loads(latest.read_text(encoding="utf-8"))["text"]
        memo = latest.with_name(f"{latest.stem}-memo.json")
        if memo.is_file():
            yield f"{sid} {latest.stem} の執筆意図", json.loads(memo.read_text(encoding="utf-8"))["text"]


class NamingTest(unittest.TestCase):
    def test_screen_strings_use_screen_words(self):
        leaks = []
        for path in sorted([*(APP / "web").glob("*.js"), *(APP / "web").glob("*.html")]):
            text = visible(path.read_text(encoding="utf-8"))
            for pattern, word in rules():
                for found in pattern.finditer(text):
                    line = text.count("\n", 0, found.start()) + 1
                    leaks.append(f"{path.name}:{line} 「{found.group(0)}」→ {word}")
        self.assertEqual(leaks, [], "画面の文字列に作る側の呼び名がある")

    def test_quickstart_uses_screen_words(self):
        leaks = []
        for where, text in quickstart_texts():
            for pattern, word in rules():
                for found in pattern.finditer(text):
                    leaks.append(f"{where}: 「{found.group(0)}」→ {word}")
        self.assertEqual(leaks, [], "同梱のクイックスタートガイドに作る側の呼び名がある")


if __name__ == "__main__":
    unittest.main()
