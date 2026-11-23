# アイコン

画面に出ているアイコンは、tsuzuri のために面で描いた自作の形で、形の正本は `src/draw.py` です。

- 直すときは `src/draw.py` を直して `python3 src/draw.py` を流し、`<名前>.svg` を書き直します（ファイル名はアプリの呼び名のままです）
- 自作は21個です: book-open（本文）・messages-square（コメント一覧）・list-checks（要件定義書）・message-square（コメント）・clipboard-list（参照要件）・history（バージョン履歴）・chevron-right（畳みの矢印）・trash-2（削除）・panel-right-open（文詳細を開く）と、役割の role-claim・role-evaluation・role-reason・role-evidence・role-explanation・role-report、コメントの出どころの note-user・note-ai、ライブラリの画面の切り替えの template（テンプレート）・dictionary（校正辞書）、ライブラリの見出しの tsz-open（共有ファイルを開く）、ライブラリのボタンと見出しの library（2段の棚）
- 色は `currentColor` です。すぐ隣に見える語があるときは飾りとして読ませず（`aria-hidden`）、アイコンだけのボタンには `aria-label` と title を付けます

ほかのファイルは Lucide（lucide-react v1.14.0）から写した線のアイコンで、いまの画面には出ていません。
使う場面ができたら、同じ決まりで面の形に描き直します。
Lucide のライセンス（ISC。Feather 由来の形は MIT）は `LICENSE-lucide.txt` にあります。
