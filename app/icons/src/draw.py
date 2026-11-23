"""tsuzuri の面のアイコンを描く（svg は線ではなく面の性質を持つようにデザインする）。

24px の格子に、面（時計回り）と切り抜き（反時計回り）を nonzero で重ねて1色の形にする。
決まり: 外側の角丸 3・切り抜きの幅 2・面どうしのすき間 1.5・色は currentColor。
吹き出しはロゴのシンボルと同じ形の系統にする。
実行すると ../<名前>.svg を書き直す。
"""
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent


def rr(x: float, y: float, w: float, h: float, r: float, hole: bool = False) -> str:
    """角丸の四角。hole なら反時計回りに回して、nonzero で切り抜きになる。"""
    r = min(r, w / 2, h / 2)
    if not hole:
        return (f"M{x+r} {y}H{x+w-r}A{r} {r} 0 0 1 {x+w} {y+r}V{y+h-r}A{r} {r} 0 0 1 {x+w-r} {y+h}"
                f"H{x+r}A{r} {r} 0 0 1 {x} {y+h-r}V{y+r}A{r} {r} 0 0 1 {x+r} {y}Z")
    return (f"M{x+r} {y}A{r} {r} 0 0 0 {x} {y+r}V{y+h-r}A{r} {r} 0 0 0 {x+r} {y+h}H{x+w-r}"
            f"A{r} {r} 0 0 0 {x+w} {y+h-r}V{y+r}A{r} {r} 0 0 0 {x+w-r} {y}Z")


def circle(cx: float, cy: float, r: float, hole: bool = False) -> str:
    s = 0 if hole else 1
    return f"M{cx-r} {cy}A{r} {r} 0 0 {s} {cx+r} {cy}A{r} {r} 0 0 {s} {cx-r} {cy}Z"


def bubble(x: float, y: float, w: float, h: float, r: float) -> str:
    """ロゴの思考メモの吹き出し。左下の角がしっぽになって左下へ流れる。"""
    return (f"M{x+r} {y}H{x+w-r}A{r} {r} 0 0 1 {x+w} {y+r}V{y+h-r}A{r} {r} 0 0 1 {x+w-r} {y+h}"
            f"H{x+7}Q{x+3.2} {y+h+0.6} {x+0.6} {y+h+3.4}Q{x+1} {y+h-0.6} {x} {y+h-4.5}V{y+r}A{r} {r} 0 0 1 {x+r} {y}Z")


def svg(body: str, defs: str = "") -> str:
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
            + defs + body + "</svg>\n")


def path(d: str, extra: str = "") -> str:
    return f'<path d="{d}"{extra}/>'


ICONS: dict[str, str] = {}

# 本文: 紙に一文ずつの行を切り抜く（文を1行ずつ並べるアプリの紙）
ICONS["book-open"] = svg(path(rr(4.5, 2.5, 15, 19, 3) + rr(8, 7, 8, 2, 1, True) + rr(8, 11, 8, 2, 1, True) + rr(8, 15, 5, 2, 1, True)))

# コメント（送る）: ロゴの吹き出しに一文の棒を切り抜く
ICONS["message-square"] = svg(path(bubble(3, 3, 18, 14.5, 5) + rr(7.5, 9, 9, 2.5, 1.25, True)))

# コメント一覧: 手前の吹き出しと、奥にずらした吹き出し。奥は手前の形を太らせた形で抜いて、すき間を作る
_front = bubble(2.5, 7, 15, 12, 4.2) + rr(6.5, 12, 7, 2.2, 1.1, True)
ICONS["messages-square"] = svg(
    f'<path d="{rr(7.5, 2.5, 14, 11.5, 4)}" mask="url(#tz-ms)"/>' + path(_front),
    defs=f'<defs><mask id="tz-ms" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">'
         f'<rect width="24" height="24" fill="#fff"/><path d="{bubble(2.5, 7, 15, 12, 4.2)}" fill="#000" stroke="#000" stroke-width="3" stroke-linejoin="round"/></mask></defs>')

# 要件網羅: 応えている項目は塗った四角、抜けは輪だけの四角（画面の「抜けを先に目立たせる」と同じ意味）
ICONS["list-checks"] = svg(path(
    rr(2.5, 3, 5, 5, 1.6) + rr(10.5, 4.4, 11, 2.2, 1.1)
    + rr(2.5, 9.5, 5, 5, 1.6) + rr(10.5, 10.9, 11, 2.2, 1.1)
    + rr(2.5, 16, 5, 5, 1.6) + rr(4, 17.5, 2, 2, 0.6, True) + rr(10.5, 17.4, 7, 2.2, 1.1)))

# 設計書: 左の背骨に節を3つ、右へ段落の帯（段落を順につないだ骨組み・ADR-0003）。本文と要件定義書は紙の形なので、紙にしないで分ける。
# 段落の塊に並び順の丸を切り抜いた形・紙に段落の塊・折った紙と並べ、これを採った
ICONS["design-doc"] = svg(path(
    rr(4.6, 4, 1.8, 16, 0.9) + circle(5.5, 5, 2.6) + circle(5.5, 12, 2.6) + circle(5.5, 19, 2.6)
    + rr(10, 3, 11.5, 4, 2) + rr(10, 10, 11.5, 4, 2) + rr(10, 17, 8, 4, 2)))

# キーの案内: 横長の板にキーを切り抜く（上の段に3つ、下の段は短いキー2つと長いスペース）
ICONS["keyboard"] = svg(path(
    rr(1.5, 5, 21, 14, 3)
    + rr(4.5, 8, 3, 2.6, 0.8, True) + rr(10.5, 8, 3, 2.6, 0.8, True) + rr(16.5, 8, 3, 2.6, 0.8, True)
    + rr(4.5, 13.4, 3, 2.6, 0.8, True) + rr(9.5, 13.4, 10, 2.6, 1.3, True)))

# 要件定義書（前の参照要件）: 留め具の付いた板に要件の行を切り抜く
ICONS["clipboard-list"] = svg(path(
    rr(4.5, 4, 15, 18, 3) + rr(8, 1.8, 8, 4.4, 1.6)
    + rr(10, 3.1, 4, 1.6, 0.8, True)
    + rr(8, 10, 8, 2, 1, True) + rr(8, 14, 8, 2, 1, True) + rr(8, 18, 5, 2, 1, True)))

# バージョン履歴: 時計の面に針を切り抜く（戻る矢じりは小さい大きさで浮いて見えたので付けない）
ICONS["history"] = svg(path(circle(12, 12, 9.5) + rr(11, 6, 2, 7, 1, True) + rr(11, 11, 5.5, 2, 1, True)))

# 畳みの矢印: 太い山形（回転は motion.js）
ICONS["chevron-right"] = svg(path("M8.4 5.6L10.6 3.4L19.2 12L10.6 20.6L8.4 18.4L14.8 12Z",
                                  ' stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"'))

# 削除: ふたと取っ手、すき間をあけた箱に2本の溝
ICONS["trash-2"] = svg(path(
    rr(3, 5, 18, 2.6, 1.3) + rr(8.5, 2, 7, 4, 1.6) + rr(10.3, 3.5, 3.4, 1.5, 0.7, True)
    + "M5.4 9.2H18.6L17.6 19.4A2.8 2.8 0 0 1 14.8 22H9.2A2.8 2.8 0 0 1 6.4 19.4Z"
    + rr(9, 11.5, 2, 7.5, 1, True) + rr(13, 11.5, 2, 7.5, 1, True)))

# 本文コピー: 手前の紙（本文と同じ行の切り抜き）と、左上へずらした奥の紙。奥は手前の形を太らせた形で抜いて、すき間を作る（コメント一覧と同じ作り）
_sheet = rr(8, 6.5, 13.5, 15.5, 3)
ICONS["copy"] = svg(
    f'<path d="{rr(2.5, 2, 13.5, 15.5, 3)}" mask="url(#tz-cp)"/>'
    + path(_sheet + rr(11.5, 10.5, 6.5, 2, 1, True) + rr(11.5, 14.5, 6.5, 2, 1, True) + rr(11.5, 18.5, 4, 1.6, 0.8, True)),
    defs=f'<defs><mask id="tz-cp" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">'
         f'<rect width="24" height="24" fill="#fff"/><path d="{_sheet}" fill="#000" stroke="#000" stroke-width="3" stroke-linejoin="round"/></mask></defs>')

# 変更（道具の欄の節）: 消した行と足した行。上の帯に「−」、下の帯に「＋」を切り抜く。
# ＋は2本の四角を重ねて抜くと nonzero で重なりが塗りに戻るので、十字の形を1本の反時計回りの線で抜く
_plus = "M11 15.6V14.1Q11 13.5 11.6 13.5H12.4Q13 13.5 13 14.1V15.6H14.5Q15.1 15.6 15.1 16.2V17Q15.1 17.6 14.5 17.6H13V19.1Q13 19.7 12.4 19.7H11.6Q11 19.7 11 19.1V17.6H9.5Q8.9 17.6 8.9 17V16.2Q8.9 15.6 9.5 15.6Z"
_plus_hole = "M11 15.6H9.5Q8.9 15.6 8.9 16.2V17Q8.9 17.6 9.5 17.6H11V19.1Q11 19.7 11.6 19.7H12.4Q13 19.7 13 19.1V17.6H14.5Q15.1 17.6 15.1 17V16.2Q15.1 15.6 14.5 15.6H13V14.1Q13 13.5 12.4 13.5H11.6Q11 13.5 11 14.1Z"
ICONS["diff"] = svg(path(rr(2.5, 2.5, 19, 8, 3) + rr(8.9, 5.5, 6.2, 2, 1, True) + rr(2.5, 12.6, 19, 8, 3) + _plus_hole))

# ハイライト（重要度と変更の見方）: 本文の3行（塗った帯）と、真ん中の行の左に縦の印（本文の文の左の印と同じ見せ方）
ICONS["diff-mark"] = svg(path(
    rr(8, 3.5, 13.5, 3, 1.5) + rr(8, 10.5, 13.5, 3, 1.5) + rr(8, 17.5, 9, 3, 1.5) + rr(2.5, 8.5, 3, 7, 1.5)))

# フィルター（重要度と変更の見方）: 3行のうち変わった真ん中の1行だけを塗り、上下の行は輪郭だけ残す（そこにあるが見せない行）
ICONS["diff-only"] = svg(path(
    rr(2.5, 3, 19, 4.5, 2.25) + rr(4, 4.5, 16, 1.5, 0.75, True)
    + rr(2.5, 9.75, 19, 4.5, 2.25)
    + rr(2.5, 16.5, 19, 4.5, 2.25) + rr(4, 18, 16, 1.5, 0.75, True)))

# 文詳細を開く: 枠の右の欄を塗り、左の本文の側は抜く
ICONS["panel-right-open"] = svg(path(rr(2.5, 4, 19, 16, 3) + rr(4.5, 6, 9, 12, 1.4, True)))


def star(cx: float, cy: float, ro: float, ri: float, n: int = 5, cut_o: float = 1.3, cut_i: float = 0.7) -> str:
    """角の数 n の星。角は形そのもので丸める（頂点の手前 cut だけ辺を戻し、頂点を制御点にした2次曲線でつなぐ）。

    前は塗りに同じ色の stroke を重ねて丸めていたが、説明の札の透かしで色を薄めると、塗りと線の重なりだけ2倍の濃さになり、
    縁取りの線に見えた。形が塗り1枚なら、どの濃さでも一様に見える。
    """
    import math
    v = []
    for i in range(n * 2):
        r = ro if i % 2 == 0 else ri
        a = -math.pi / 2 + i * math.pi / n
        v.append((cx + r * math.cos(a), cy + r * math.sin(a)))

    def toward(p: tuple, q: tuple, d: float) -> tuple:
        L = math.hypot(q[0] - p[0], q[1] - p[1])
        return (p[0] + (q[0] - p[0]) * d / L, p[1] + (q[1] - p[1]) * d / L)

    out = []
    m = len(v)
    for i, p in enumerate(v):
        d = cut_o if i % 2 == 0 else cut_i
        a, b = toward(p, v[i - 1], d), toward(p, v[(i + 1) % m], d)
        out.append(f"{'M' if i == 0 else 'L'}{a[0]:.2f} {a[1]:.2f}Q{p[0]:.2f} {p[1]:.2f} {b[0]:.2f} {b[1]:.2f}")
    return "".join(out) + "Z"

# 役割とコメントの出どころの印（色だけで示すと認知負荷が高いため）。色に加えて形で見分ける
# 主張: 立てる旗
ICONS["role-claim"] = svg(path(rr(4, 2.5, 2.4, 19, 1.2) + "M8 4H18.6Q19.9 4 19.2 5.1L16.8 8.8L19.2 12.5Q19.9 13.6 18.6 13.6H8Z"))
# 評価: 星（点を付ける）
ICONS["role-evaluation"] = svg(path(star(12, 12.8, 10.6, 4.8)))
# 理由: 主張を開ける鍵（∵ は記号を知らないと点が3つに見え、丸に ? は解説の丸に i と見分けにくく、下から支える矢印はアップロードに見えた）
ICONS["role-reason"] = svg(path(circle(8, 8, 5.6) + circle(8, 8, 2, True) + "M11.6 10.4L13.2 8.8L21.4 17Q22 17.6 21.4 18.2L19.8 19.8Q19.2 20.4 18.6 19.8L17.6 18.8L16.2 20.2L14.6 18.6L16 17.2L14.6 15.8L13.2 17.2L11.6 15.6L13 14.2L11.6 12.8Z"))
# 根拠: データの棒
ICONS["role-evidence"] = svg(path(rr(3.5, 13, 4.5, 8, 1.5) + rr(9.75, 8, 4.5, 13, 1.5) + rr(16, 3, 4.5, 18, 1.5)))
# 解説: 丸に i
ICONS["role-explanation"] = svg(path(circle(12, 12, 9.5) + circle(12, 7.4, 1.6, True) + rr(10.75, 10.4, 2.5, 7.6, 1.25, True)))
# 報告: 拡声器（知らせる）。取っ手は本体につなげ、音の線は付けない（離れた小さな部品は 16px で欠片に見えた）
ICONS["role-report"] = svg(path(
    "M4.5 8.2H8.2L17 3.4Q19 2.4 19 4.6V19.4Q19 21.6 17 20.6L8.2 15.8H4.5Q2.5 15.8 2.5 13.8V10.2Q2.5 8.2 4.5 8.2Z"
    + rr(5.5, 13, 4, 8.5, 2)))
# ユーザー: 人
ICONS["note-user"] = svg(path(circle(12, 7.6, 4.6) + "M3.5 21.2Q3.5 13.8 12 13.8Q20.5 13.8 20.5 21.2Q20.5 22 19.7 22H4.3Q3.5 22 3.5 21.2Z"))
# AI: きらめき。添えていた小さいきらめきは 16px で欠片に見えたので外し、1つを大きく置く
ICONS["note-ai"] = svg(path("M12 1.5Q13.2 10.8 22.5 12Q13.2 13.2 12 22.5Q10.8 13.2 1.5 12Q10.8 10.8 12 1.5Z"))

# 重要度。核と衛星は同じ軌道の輪を持ち、塗った所がその文の立ち位置になる: 核は中心の塊、衛星は軌道の右下を回る粒。
# 中心は小さな輪に残し、何の周りを回るかを見せる。塗った丸と輪だけでは何の印か形から読めず、
# 右上に粒を置いた案は男性の記号（♂）に、輪の無い案は虫眼鏡に見えた。
# 見出し（重要度の欄）は、中心の塊と軌道上の粒を両方塗って、核と衛星を合わせた形にする（輪に中の点のままだと核と同じ形に見えた）
_ORBIT = 10.1          # 軌道の輪の外の半径（線の幅 1.6）
_SAT = (12 + 9.2 * 0.766, 12 + 9.2 * 0.643)   # 軌道の上の 4時の方向（40度）


def _orbit_masked(mask_id: str) -> tuple[str, str]:
    """軌道の輪から、衛星の粒の周り（すき間 1.5）を消した path と、そのマスク。同じページに並ぶ別のアイコンと id を分ける。"""
    ring = f'<path d="{circle(12, 12, _ORBIT) + circle(12, 12, _ORBIT - 1.6, True)}" mask="url(#{mask_id})"/>'
    mask = (f'<defs><mask id="{mask_id}" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">'
            f'<rect width="24" height="24" fill="#fff"/><path d="{circle(*_SAT, 4.6)}" fill="#000"/></mask></defs>')
    return ring, mask


ICONS["imp-core"] = svg(path(circle(12, 12, 5.4) + circle(12, 12, _ORBIT) + circle(12, 12, _ORBIT - 1.6, True)))
_ring, _mask = _orbit_masked("tz-sat")
ICONS["imp-sub"] = svg(_ring + path(circle(12, 12, 3.4) + circle(12, 12, 1.8, True) + circle(*_SAT, 3.1)), defs=_mask)
_ring, _mask = _orbit_masked("tz-sat-all")
ICONS["circle-dot"] = svg(_ring + path(circle(12, 12, 5.4) + circle(*_SAT, 3.1)), defs=_mask)

# ライブラリ。本文のアイコンと同じ紙を手前に置き、後ろにもう1枚ずらして重ねる＝これまで書いた記録の束。
# 後ろの紙は手前の紙の周り（すき間 1.5）をマスクで消し、2枚が1つの塊に溶けないようにする
_front = (3, 6.5, 13.5, 15.5)
_back_mask = ('<defs><mask id="tz-rec" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/>'
              f'<path d="{rr(_front[0] - 1.5, _front[1] - 1.5, _front[2] + 3, _front[3] + 3, 4.5)}" fill="#000"/></mask></defs>')
ICONS["records"] = svg(
    f'<path d="{rr(7.5, 2, 13.5, 15.5, 3)}" mask="url(#tz-rec)"/>'
    + path(rr(*_front, 3) + rr(6, 10.5, 7.5, 2, 1, True) + rr(6, 14.5, 7.5, 2, 1, True) + rr(6, 18.5, 4.5, 2, 1, True)),
    defs=_back_mask)

# 閉じる（ライブラリ）。幅 2.6 の角の丸い棒を2本、45度で交差させる
ICONS["x"] = svg(path(rr(10.7, 3, 2.6, 18, 1.3), ' transform="rotate(45 12 12)"') + path(rr(10.7, 3, 2.6, 18, 1.3), ' transform="rotate(-45 12 12)"'))

# 表示中（ライブラリで今開いている文章）。太さ 2.8 のチェックの形を面で描く。字の札「開いている」は長い題の横で2行に折れ、
# 本文のアイコンを入れた丸は何の印か伝わらなかった
ICONS["check"] = svg(path("M3.6 12.6L5.6 10.6L9.6 14.6L18.4 5.8L20.4 7.8L9.6 18.6Z", ' stroke="currentColor" stroke-width="0.8" stroke-linejoin="round"'))

# 未解決（コメント一覧の切り替え）。吹き出しの右上に、輪の中に点（GitHub の未解決の issue と同じ「開いている」の印）。
# 吹き出しは印の周り 1.5 をマスクで抜き、2つの形を分ける。解決済みはチェックで示すので、その反対の「まだ開いている」を印にした
# （最初の案は未解決の印として説明になっていなかったので、3案を比べて A を採った。B の塗った点は通知に読め、C の輪だけは印として弱かった）
_ob = bubble(2, 5.5, 16.5, 13.5, 4.6) + rr(6, 11, 8, 2.4, 1.2, True)
ICONS["message-open"] = svg(
    f'<path d="{_ob}" mask="url(#tz-mo)"/>' + path(circle(18.5, 5.5, 4.5) + circle(18.5, 5.5, 2.4, True) + circle(18.5, 5.5, 1.4)),
    defs=f'<defs><mask id="tz-mo" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/>'
         f'<path d="{circle(18.5, 5.5, 6)}" fill="#000"/></mask></defs>')

# テンプレート（ライブラリの切り替え）: 本文と同じ紙に、見出しの帯と、左右2つの段の枠を切り抜く（中身の入る前の骨組み）
ICONS["template"] = svg(path(rr(4.5, 2.5, 15, 19, 3) + rr(7.5, 5.5, 9, 3, 1.2, True) + rr(7.5, 10.5, 4, 8, 1.2, True) + rr(13, 10.5, 3.5, 8, 1.2, True)))

# 校正辞書（ライブラリの切り替え）: 左に背の帯を切り抜いた本の表紙に、チェックの形を切り抜く（直す先を引く辞書）。
# 最初は右の端に爪を出した本にしたが、16px でリングノートの綴じ輪に見えた。チェックは表示中の印と同じ形を縮めて反時計回りに回す
ICONS["dictionary"] = svg(path(rr(3.5, 2.5, 17, 19, 3) + rr(6.2, 5.5, 1.8, 13, 0.9, True) + "M12.76 15.57L18.81 9.52L17.69 8.4L12.76 13.33L10.52 11.09L9.4 12.21Z"))

# 共有ファイルを開く（ライブラリ）: 本文と同じ紙に、下向きの矢印と受け皿の帯を切り抜く（受け取った .tsz を取り込む）。
# 矢印は軸と先を1つの反時計回りの輪郭にする（別々の切り抜きを重ねると、重なりが nonzero で面に戻るため）
ICONS["tsz-open"] = svg(path(rr(4.5, 2.5, 15, 19, 3)
                             + "M10.9 5.5V11.6H7.8L12 16.2L16.2 11.6H13.1V5.5Q13.1 5 12.6 5H11.4Q10.9 5 10.9 5.5Z"
                             + rr(7.5, 17.8, 9, 2, 1, True)))

# ライブラリ: 外の箱に2段の棚を切り抜き、各段に背表紙を3冊立てる（文章・テンプレート・校正辞書・プロンプトを置く棚）。
# 紙を重ねた records は中の「文章」の表示に残す。背表紙の幅 2.6・すき間 1.5 で、最初の案はすき間が 1 ほどで 16px で潰れた
ICONS["library"] = svg(path(rr(2.5, 2.5, 19, 19, 3) + rr(4.5, 4.5, 15, 6.5, 1.2, True) + rr(4.5, 13, 15, 6.5, 1.2, True))
                       + path(rr(6.3, 6, 2.6, 5, 0.6) + rr(10.4, 7.2, 2.6, 3.8, 0.6) + rr(14.5, 6, 3.2, 5, 0.6)
                              + rr(6.3, 14.5, 3.2, 5, 0.6) + rr(11, 14.5, 2.6, 5, 0.6) + rr(15.1, 15.7, 2.6, 3.8, 0.6)))

if __name__ == "__main__":
    for name, s in ICONS.items():
        (OUT / f"{name}.svg").write_text(s, encoding="utf-8")
        print("wrote", name)
