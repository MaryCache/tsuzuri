"""画面の名前の一覧（app/naming/feature-map.tsv）が画面と合っているか、ガイドが一覧にない画面の名前を使っていないかを見る試験。

test_naming.py は漏れた呼び名を1つずつ禁じる。漏れる語は毎回ちがう形で来た（道具の欄・アイコンの列・記録を開く）ので、
こちらは画面の部品を指す語を、実在する名前の一覧と突き合わせる。一覧が画面から外れると試験が守るものも外れるので、
一覧の「画面の字」が画面の文字列に実際にあることも確かめる。
"""

import re
import unittest

from test_naming import APP, quickstart_texts, visible

MAP = APP / "naming" / "feature-map.tsv"

# 画面の部品を指す語の終わり方。ここに当たる語だけを一覧と比べる。
# 過去の漏れは「道具の欄」「記録の一覧」のように「の」でつながっていたので、「〇〇の」を1つだけ前に含める
_WORD = r"[一-龥ァ-ヴー々A-Za-z]"
UI_NOUN = re.compile(
    rf"(?:{_WORD}{{1,8}}の)?{_WORD}{{0,10}}(?:画面|パネル|バー|一覧|ボタン|タブ|メニュー|欄|ダイアログ|カード|ウィンドウ)"
)
_SUFFIX = re.compile(r"(?:画面|パネル|バー|一覧|ボタン|タブ|メニュー|欄|ダイアログ|カード|ウィンドウ)$")
# 部品の終わり方をしているが、画面の部品の名前ではない語。当たっても一覧には足さず、ここに入れる
IGNORE = {"サーバー", "メンバー"}
# 「いちばん上のボタン」のように位置で指すのは、小さな操作の部品なら説明として通す。
# 欄やパネルのような領域を位置で呼ぶと名前の代わりになる（「右の欄」が詳細パネルの代わりに漏れた・internal-names.tsv）ので通さない
POSITIONS = {"上", "下", "右", "左"}
SMALL_PARTS = {"ボタン"}


def feature_map():
    """一覧を (名前, 画面の字) の並びにする。# の行と空の行は読まない。"""
    rows = []
    for line in MAP.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        cells = line.split("\t")
        rows.append((cells[0], cells[2]))
    return rows


def screen_text():
    """画面の文字列（app/web の JS と HTML から、コメントを外したもの）をつなげて返す。"""
    paths = sorted([*(APP / "web").glob("*.js"), *(APP / "web").glob("*.html")])
    return "\n".join(visible(p.read_text(encoding="utf-8")) for p in paths)


def unknown_ui_nouns(text, names):
    """text の中の部品を指す語のうち、一覧の名前で終わらないものを返す。

    通すのは次の4つ。どれにも当たらない語が、一覧に無い画面の名前として返る。
    - 一覧の名前で終わる語（「左のアイコンバー」）。正規表現は最長で取るので、終わりで比べる
    - 部品の語だけ（「画面」「ボタン」）。何かの名前ではなく、ふつうの名詞として使っている
    - 「一覧の名前＋の＋部品の語」（「コメントの欄」）。実在する物の部分を説明している
    - 「位置＋の＋小さな部品」（「上のボタン」）
    """
    found = []
    for word in UI_NOUN.findall(text):
        if word in IGNORE or any(word.endswith(name) for name in names):
            continue
        suffix = _SUFFIX.search(word).group(0)
        head = word[: -len(suffix)]
        if not head:
            continue
        if head.endswith("の"):
            owner = head[:-1]
            if owner in names or (owner in POSITIONS and suffix in SMALL_PARTS):
                continue
        found.append(word)
    return found


class FeatureMapTest(unittest.TestCase):
    def test_map_names_are_on_screen(self):
        text = screen_text()
        missing = [name for name, shown in feature_map() if shown != "字なし" and shown not in text]
        self.assertEqual(missing, [], "一覧の名前が画面の文字列に無い（画面で名前を変えたなら一覧も直す）")

    def test_quickstart_names_screen_parts_from_map(self):
        names = [name for name, _ in feature_map()]
        leaks = []
        for where, text in quickstart_texts():
            leaks += [f"{where}: 「{w}」" for w in unknown_ui_nouns(text, names)]
        self.assertEqual(leaks, [], "ガイドが一覧に無い画面の名前を使っている（実在しない名前なら直し、実在するなら一覧に足す）")

    def test_detector_catches_past_leaks(self):
        """過去に漏れた形を、この試験が本当に止めるかを確かめる（実際に漏れた2件）。"""
        names = [name for name, _ in feature_map()]
        self.assertEqual(unknown_ui_nouns("道具の欄を開く", names), ["道具の欄"])
        self.assertEqual(unknown_ui_nouns("記録の一覧から選ぶ", names), ["記録の一覧"])
        self.assertEqual(unknown_ui_nouns("右の欄に出る", names), ["右の欄"])
        self.assertEqual(unknown_ui_nouns("左のアイコンバーで切り替える", names), [])
        self.assertEqual(unknown_ui_nouns("いちばん上のボタンか、コメントの欄へ。画面の中に出る", names), [])


if __name__ == "__main__":
    unittest.main()
