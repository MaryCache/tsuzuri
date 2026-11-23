// 質感の SVG（web/tex/）を、読み込んだ最初の1回だけ画素の絵に焼いて CSS 変数に渡す。
// フィルタつきの SVG を背景にそのまま敷くと、要素の大きさが変わるたびに描き直され、文詳細の開閉で本文の紙が
// 1フレーム 33〜50ms かかった（実測・紙を外すと 16.8ms）。焼いた絵は普通の画像として扱われる。
// 「変わらないものは1回だけ描く」← design-library の knowledge/canvas/index.md の芯3。
// 正本は SVG のまま。焼けなかったときは CSS の既定（SVG を直接敷く）が使われる。
"use strict";

/** 焼く質感。name は CSS 変数 --tex-<name> の名前、size は SVG のタイルの大きさ（px） */
const TEXTURES = [
  { name: "frost", size: 256 },
  { name: "ground", size: 1024 },
  { name: "paper", size: 512 },
];

/** 1枚の SVG を画像として読み、canvas に描いて PNG の data URL を返す（CSP の img-src が data: を許す） */
async function bake({ name, size }) {
  const img = new Image();
  img.src = `/web/tex/${name}.svg`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d").drawImage(img, 0, 0, size, size);
  return c.toDataURL("image/png");
}

// 紙の質感の層（texture.css の .paper::before）の高さを、本文を下までスクロールした長さに合わせる。
// 層は紙の中で本文と一緒に流れるので、見えている高さだけだと下のほうに質感が無くなる。
// scrollHeight は層そのものの高さも含んで縮まなくなるので、本文の下端から測る。
// 下端 = 本文の箱の下 ＋ 最後の段落の外へはみ出す余白（.para の margin-bottom）＋ 紙の下の padding
const paper = document.getElementById("paper"), text = document.getElementById("text");
new ResizeObserver(() => {
  const last = text.lastElementChild;
  const bottom = text.offsetTop + text.offsetHeight
    + (last ? parseFloat(getComputedStyle(last).marginBottom) : 0)
    + parseFloat(getComputedStyle(paper).paddingBottom);
  paper.style.setProperty("--paper-h", `${Math.max(bottom, paper.clientHeight)}px`);
}).observe(text);

for (const t of TEXTURES) {
  bake(t)
    .then(url => document.body.style.setProperty(`--tex-${t.name}`, `url("${url}")`))
    .catch(() => {});
}
