// 説明カード（ホバーの説明がマウスに被り、見た目もブラウザ標準でデザインに沿わないので、個別に実装した）。
// ブラウザ標準の title をやめ、data-hint（短い名前）と data-hint-key（文章構造・コメントの分類の説明）を、このファイルが1枚のカードで出す。
// カードはポインターに重ねない。道具の列とアイコンの列の中の物は、そのカードの右の外へ、文詳細の中の物は、物の上へ出す。
// 出るまで 0.35 秒待ち（通りすがりに出さない）、Esc で消え、カードの上へポインターを動かしても消えない（design-library の parts/tooltip.md・WCAG 1.4.13）。
// app.js の ROLES・NOTES・ic・st を使うので、app.js のあとに読み込む。
"use strict";

// 分類ごとの「文の性質」と「分類の意図」。役割の語は木戸光子 1992 の文の機能（references/tag-vocabulary.md の2. 役割）だが、原本の定義には当たれていない。
// ここの文は平たく言い直したもの。カードには出典も操作の案内も書かない。
// 分類の意図は、主張や評価には理由があり、理由は報告と根拠で補強でき、つながりが複雑な場合は解説があるとやさしい、という整理を土台にした。
// 足したのは2点＝根拠は主張や評価を直接支えることもある・報告は起きたことを伝えるだけの文もある。たとえ（「鍵」など）は使わない。
// 例は文の性質と混ざらないよう、説明の文から外し、名前の下に別に出す。
// 性質と意図は見出しで分けず、1段落で続けて読ませる（混ぜたほうが分かりやすかった）
const HINT_INFO = {
  "role:claim": { kind: "意見", ex: "「〜すべきだ」「〜だと思う」", text: "書き手の最も言いたいことや、立場を明示する文。文章の中心になり、理由・根拠・報告はこの主張や評価を支えるために配置される。主張がずれると支える文もすべてずれるため、最初に確認する。" },
  "role:evaluation": { kind: "意見", ex: "「〜は大事だ」「〜はいまいちだ」", text: "物事の良し悪しや価値について、書き手の判断を述べる文。主張と同じく理由で支えられるため、判断の基準が主張と食い違っていないかを確認する。" },
  "role:reason": { kind: "意見", ex: "「〜だから」「なぜなら〜」", text: "主張や評価がなぜそう言えるのかを述べる文。主張や評価には理由が必要なため、理由の無い主張や評価が無いか、理由がどの主張や評価に対応しているかを確認する。理由は根拠と報告で補強される。" },
  "role:evidence": { kind: "事実", ex: "「調べると〜だった」「〜によると」", text: "事実・データ・引用で理由を補強する文。主張や評価を直接支えることもある。理由が書き手の思い込みだけになっていないかを確認する。" },
  "role:explanation": { kind: "事実", ex: "「〜とは〜のことだ」", text: "事柄の仕組みや、言葉の意味を説明する文。主張・理由・根拠のつながりが複雑なときに、読み手が追えるよう補足する。過剰になると中心の主張が目立たなくなる。" },
  "role:report": { kind: "事実", ex: "「〜した」「〜があった」", text: "起きたことや、書き手が実行したことを伝える文。書き手の経験で理由を補強するほか、起きたことを伝えるだけの文もある。事実の中に意見が混在していないかを確認する。" },
  "imp:core": { kind: "重要度", ex: "", text: "削除すると、書き手の言いたいことが崩れる文。押すと核の文だけが濃く残り、文章の骨組みを読める。核が衛星に埋もれていないかを確認する。" },
  "imp:sub": { kind: "重要度", ex: "", text: "核を支える文。削除しても言いたいことは残るが、理由や説明が減る。押すと衛星の文だけが濃く残る。衛星ばかり長くなっていないかを確認する。" },
  "note:user": { kind: "コメント", ex: "", text: "あなたがコメントを残した文。AI は次に修正するときにこのコメントを参照する。" },
  "note:ai": { kind: "コメント", ex: "", text: "AI が記述を変えた理由や、見直しで気づいた点が付いた文。意図とずれていないかを先に確認する。" },
};

const hint = { el: null, target: null, showT: 0, hideT: 0 };

function hintName(key) {
  const [kind, k] = key.split(":");
  if (kind === "role") return ROLES.flatMap(([, rs]) => rs).find(([, rk]) => rk === k)?.[0] || k;
  if (kind === "imp") return IMPS.find(([ik]) => ik === k)?.[1] || k;
  return NOTES.find(([nk]) => nk === k)?.[1] || k;
}

function hintBody(target) {
  const key = target.dataset.hintKey;
  // data-hint-kbd があれば、名前の横にキーをキーの形で添える（「キーの案内（?）」と括弧で書くと読みにくかった）
  const kbd = target.dataset.hintKbd ? `<kbd class="hint-kbd">${esc(target.dataset.hintKbd)}</kbd>` : "";
  if (!key) return `<p class="hint-name">${esc(target.dataset.hint)}${kbd}</p>`;
  const info = HINT_INFO[key];
  const [kind, k] = key.split(":");
  const n = target.querySelector(".n b")?.textContent ?? "0";
  const cv = `var(--${kind === "role" ? "role" : kind === "imp" ? "imp" : "hl"}-${k})`;
  return `<div class="hint-head" style="--k: ${cv}">${ic(`${kind}-${k}`, "ic mark")}<b>${esc(hintName(key))}</b><span class="hint-kind">${esc(info.kind)}</span><span class="hint-n">${n}文</span></div>
    ${info.ex ? `<p class="hint-ex">${esc(info.ex)}</p>` : ""}
    <p class="hint-text">${esc(info.text)}</p>
    <span class="hint-wm" data-wm="${kind}-${k}" style="--k: ${cv}">${ic(`${kind}-${k}`, "ic")}</span>`;
}

// カードを置く。道具の列とアイコンの列の中なら、そのカードの右の外へ、物の高さの中央にそろえる。それ以外は物の上へ出す（入らなければ下）
// 文詳細の欄が開いているときは本文の段が左へ寄り、欄の右の外のカードが本文の字にかぶるので、このときだけカードの位置を変える。
// そのときだけ、分類のカードは道具の欄の中に、欄の幅で、乗せた行のすぐ下（入らなければ上）に出す
function placeHint(target) {
  const el = hint.el, r = target.getBoundingClientRect(), gap = 12;
  const panel = target.closest(".side, .rail");
  const side = target.closest(".side"), detailOpen = (document.getElementById("detail")?.offsetWidth || 0) > 100;
  const inside = !!(side && detailOpen && target.dataset.hintKey);
  el.classList.toggle("inside", inside);
  if (inside) {
    const sr = side.getBoundingClientRect(), pad = 10;
    el.style.width = `${sr.width - pad * 2 - 18}px`;   // 18 は道具の欄の右端が紙の下にもぐっている幅（--overlap）
  } else el.style.width = "";
  const w = el.offsetWidth, h = el.offsetHeight, vw = innerWidth, vh = innerHeight;
  let x, y, from;
  if (inside) {
    x = side.getBoundingClientRect().left + 10;
    y = r.bottom + 6; from = "up";
    if (y + h > vh - 8) { y = r.top - h - 6; from = "down"; }
  } else if (panel) {
    x = panel.getBoundingClientRect().right + gap;
    y = r.top + r.height / 2 - h / 2; from = "left";
  } else {
    x = r.left;
    y = r.top - h - gap; from = "down";
    if (y < 8) { y = r.bottom + gap; from = "up"; }
  }
  // 出入りの向きは、カードから見て指した要素がある側（上にカードを置けば下から出て、下へ縮んで消える）
  const dir = { up: ["0px", "-4px", "50% 0%"], down: ["0px", "4px", "50% 100%"], left: ["-6px", "0px", "0% 50%"] }[from];
  el.style.setProperty("--hx", dir[0]); el.style.setProperty("--hy", dir[1]); el.style.setProperty("--ho", dir[2]);
  el.style.left = `${Math.max(8, Math.min(x, vw - w - 8))}px`;
  el.style.top = `${Math.max(8, Math.min(y, vh - h - 8))}px`;
}

function showHint(target) {
  clearTimeout(hint.hideT);
  if (hint.target === target && !hint.el.hidden) return;
  const entering = hint.el.hidden || !hint.el.classList.contains("on");
  // 出ているカードから隣の物へ移るときは、カードを今の位置と大きさから新しい所へバネで滑らせ、中身は短く入れ替える
  // （前はその場で中身と位置が飛んでいて、隣へ移るホバーにアニメーションが走らなかった）
  const from = entering ? null : hint.el.getBoundingClientRect();
  hint.target = target;
  hint.el.innerHTML = hintBody(target);
  hint.el.classList.toggle("rich", !!target.dataset.hintKey);
  clearTimeout(hint.goneT);
  hint.el.hidden = false;
  raiseHint();
  placeHint(target);
  if (from && !matchMedia("(prefers-reduced-motion: reduce)").matches) glideHint(from);
  // 隠れていたカードは、出る前の形を一度描かせてから印を付ける（同じフレームで付けると入りの動きが走らなかった）
  if (entering) { hint.el.classList.remove("on"); void hint.el.offsetWidth; }
  hint.el.classList.add("on");
  target.setAttribute("aria-describedby", "hint");
}

/** 置き直したカードを、前の位置（from）からずらして描き始め、バネ（app.js の --spring）で今の位置へ戻す。動かすのは位置（transform）だけ。
    高さと幅も動かすと毎フレーム組み直しになってかくつき、中身を薄くして入れ替えると一瞬空のカードが見えてフラッシュのようだった。中身はその場で入れ替える */
function glideHint(from) {
  const el = hint.el, to = el.getBoundingClientRect();
  const dx = from.left - to.left, dy = from.top - to.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  const spring = getComputedStyle(document.documentElement).getPropertyValue("--spring").trim() || "ease-out";
  hint.glide?.cancel();
  hint.glide = el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 360, easing: spring });
}

/** カードを最前面（top layer）に出す。ライブラリのような開いたモーダルは top layer に乗り、その外のカードは z-index に関わらず幕の下でぼかされる。
    top layer の中では後から出したものが上に来るので、隠すたびに閉じ、出すたびに開き直してモーダルより上にする。
    出ているカードを隣の物へ滑らせるときは開き直さない（開き直すと滑る動きが途切れる） */
function raiseHint() {
  if (hint.el.showPopover && !hint.el.matches(":popover-open")) hint.el.showPopover();
}

function hideHint(now = false) {
  clearTimeout(hint.showT);
  const go = () => {
    if (!hint.target) return;
    hint.target.removeAttribute("aria-describedby");
    hint.target = null;
    hint.el.classList.remove("on");
    // 退場の動き（CSS の .14 秒）が終わってから隠す。その間に別の要素へ乗ったら showHint が止める
    clearTimeout(hint.goneT);
    hint.goneT = setTimeout(() => { if (!hint.target) { hint.el.hidden = true; if (hint.el.matches(":popover-open")) hint.el.hidePopover(); } }, 160);
  };
  if (now) go(); else { clearTimeout(hint.hideT); hint.hideT = setTimeout(go, 150); }
}

function initHint() {
  hint.el = document.getElementById("hint");
  const find = t => t instanceof Element ? t.closest("[data-hint], [data-hint-key]") : null;
  document.addEventListener("pointerover", e => {
    if (hint.el.contains(e.target)) { clearTimeout(hint.hideT); return; }
    const t = find(e.target);
    if (!t) return;
    clearTimeout(hint.showT); clearTimeout(hint.hideT);
    // すでにカードが出ているあいだに隣へ移ったときは、待たずに中身を替える
    if (hint.target && !hint.el.hidden) showHint(t);
    else hint.showT = setTimeout(() => showHint(t), 350);
  });
  document.addEventListener("pointerout", e => {
    const to = e.relatedTarget;
    if (to instanceof Element && (hint.el.contains(to) || find(to) === hint.target)) return;
    if (find(e.target) || hint.el.contains(e.target)) hideHint();
  });
  document.addEventListener("focusin", e => { const t = find(e.target); if (t && t.matches(":focus-visible")) showHint(t); });
  document.addEventListener("focusout", () => hideHint(true));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && hint.target) hideHint(true); });
  // 押したら出し直さない（押した先へ移るので、カードが残ると邪魔になる）
  document.addEventListener("pointerdown", () => hideHint(true));
  document.addEventListener("scroll", () => hideHint(true), true);
}

// 凡例に乗せている間、本文で同じ分類の文の印に .lit を付け、ほかの印を CSS が薄くする（凡例と本文の印の対応を見せる）
function initLighting() {
  const clear = () => { delete document.body.dataset.lighting; document.querySelectorAll(".s.lit").forEach(e => e.classList.remove("lit")); };
  document.addEventListener("pointerover", e => {
    const key = e.target instanceof Element ? e.target.closest(".key[data-hint-key]") : null;
    if (!key) return;
    const [kind, k] = key.dataset.hintKey.split(":");
    clear();
    if (kind === "imp") return;  // 重要度は押して切り替えるので、乗せただけでは印を照らさない
    document.body.dataset.lighting = kind === "role" ? "l" : "r";
    document.querySelectorAll(".s").forEach(s => {
      const hit = kind === "role" ? s.dataset.rk === k || (s.dataset.rsub || "").split(" ").includes(k) : (s.dataset.notes || "").split(" ").includes(k);
      s.classList.toggle("lit", hit);
    });
  });
  document.addEventListener("pointerout", e => {
    const from = e.target instanceof Element ? e.target.closest(".key[data-hint-key]") : null;
    const to = e.relatedTarget instanceof Element ? e.relatedTarget.closest(".key[data-hint-key]") : null;
    if (from && !to) clear();
  });
}

initHint();
initLighting();
