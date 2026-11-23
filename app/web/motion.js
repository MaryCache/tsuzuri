// tsuzuri の閲覧アプリの動き（すりガラスのテーマ）。物理演算のような手触りで、開閉の途中の動きも補う。
// 動きは全部バネで解く。CSS の linear() で表せない「途中で行き先が変わる動き」（文から文へ滑るカード・開閉の途中で押し直す）のために、JS で毎フレーム積分する。
"use strict";

const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp01 = t => Math.min(1, Math.max(0, t));

/** 1本のバネ。k は硬さ、c は減衰。質量は1。to に向かって x を動かす。
    eps は「止まった」とみなす残りの幅。px で動くものは 0.05、0〜1 の進み具合は 0.001 にする
    （0〜1 に 0.05 を使うと、止まる瞬間に残り5%を一度に跳ばし、文詳細の幅で最大22px跳んでいた） */
class Spring {
  constructor(k = 280, c = 28, eps = 0.05) { this.k = k; this.c = c; this.eps = eps; this.x = 0; this.v = 0; this.to = 0; }
  /** dt 秒進め、止まったら true。半陰的オイラー法（速さを先に更新）で、大きめの dt でも暴れにくい */
  step(dt) {
    const a = -this.k * (this.x - this.to) - this.c * this.v;
    this.v += a * dt; this.x += this.v * dt;
    return Math.abs(this.x - this.to) < this.eps && Math.abs(this.v) < this.eps * 10;
  }
  snap(v) { this.x = this.to = v; this.v = 0; }
}

/** 名前つきのバネの束を1つの rAF で回し、毎フレーム apply(値) を呼ぶ。止まったら onRest を呼ぶ */
function rig(names, { k, c, eps = 0.05 }, apply) {
  const sp = Object.fromEntries(names.map(n => [n, new Spring(k, c, typeof eps === "object" ? eps[n] ?? 0.05 : eps)]));
  let raf = 0, last = 0, onRest = null;
  const values = () => Object.fromEntries(names.map(n => [n, sp[n].x]));
  const loop = now => {
    const dt = Math.min(0.032, (now - last) / 1000); last = now;
    let rest = true;
    for (const s of Object.values(sp)) for (let i = 0; i < 4; i++) rest = s.step(dt / 4) && rest;
    apply(values());
    if (rest) { raf = 0; for (const s of Object.values(sp)) s.snap(s.to); apply(values()); const f = onRest; onRest = null; f?.(); }
    else raf = requestAnimationFrame(loop);
  };
  return {
    /** 行き先を変える。初めてか、動きを減らす設定なら飛ぶ */
    to(target, { jump = false, then = null } = {}) {
      for (const [n, v] of Object.entries(target)) { if (jump || REDUCE) sp[n].snap(v); else sp[n].to = v; }
      onRest = then;
      if (jump || REDUCE) { apply(values()); const f = onRest; onRest = null; f?.(); return; }
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
    },
    get(n) { return sp[n].x; },
    /** バネ1本の硬さと減衰を変える（文のカードの、進む向きの辺と後ろの辺を別の硬さで動かすため） */
    tune(n, k, c) { sp[n].k = k; sp[n].c = c; },
    /** バネ1本に速さを足す（px/秒）。マウスの勢いをカードに渡すため */
    kick(n, v) { sp[n].v += v; },
    /** 動きを止める（次の出来事に置き換えられたとき）。止めた動きの onRest は呼ばない */
    stop() { if (raf) cancelAnimationFrame(raf); raf = 0; onRest = null; },
  };
}

// --- 文の後ろを滑るカード（選んだカード・ホバーのカード） ---------------------------------
// 液体のように動かす（本文のホバーと選択にも液体の表現を当て、行き過ぎて戻る物理的な動きにする。ホバーの快適さは保つ）。
// カードの上下左右の辺を別々のバネで動かす。進む向きの辺は硬く減衰を弱くして先に飛び、行き過ぎて揺れ戻る。
// 後ろの辺は柔らかく遅れてついてくるので、移る途中でカードが伸び、伸びている間は横に少し細る（液体の首）。
// アイコンの列の濃紺はぼかして輪郭を切り直すフィルターでつなぐが、カードはすりガラスの粒と縁の光を持つので、フィルターでなく辺の動きで液体に見せる。
// lead は進む向きの辺、trail は後ろの辺、side は左右の辺のバネ
const SUB_STEP = 17;   // 副の役割の印の間隔（px）。theme-glass.css の .mk-sub の 17px と同じ
function glideBox(cls, { lead, trail, side }) {
  const paper = document.getElementById("paper");
  const el = document.createElement("div"); el.className = `glide ${cls}`; el.setAttribute("aria-hidden", "true");
  paper.prepend(el);
  let placed = false, restH = 0;
  const box = rig(["t", "b", "l", "r", "o"], { k: side.k, c: side.c, eps: { t: 0.05, b: 0.05, l: 0.05, r: 0.05, o: 0.002 } }, v => {
    const h = Math.max(8, v.b - v.t);
    // 着いたときの高さより伸びた分だけ、左右を内へ寄せる（伸びの 6%・片側 12px まで）
    const pinch = Math.min(12, Math.max(0, (h - restH) * 0.06));
    el.style.transform = `translate(${v.l + pinch}px, ${v.t}px)`;
    el.style.width = `${Math.max(0, v.r - v.l - pinch * 2)}px`; el.style.height = `${h}px`;
    el.style.opacity = String(Math.min(1, Math.max(0, v.o)));
  });
  return {
    el,
    /** 文の位置へ動かす。紙の中の座標で測る（紙がスクロールしてもカードは文と一緒に流れる） */
    show(s, jump = false, fling = 0) {
      const text = document.getElementById("text");
      // 本文との差を画面の座標で取る。offsetLeft は位置の基準の要素からの距離で、番号付きの箇条書きの li（position: relative）の中では
      // li からの距離になり、カードが本文の頭のほうへずれて描かれた
      const sr = s.getBoundingClientRect(), tr = text.getBoundingClientRect();
      const x = sr.left - tr.left + text.offsetLeft, y = sr.top - tr.top + text.offsetTop;
      // 副の役割の印は主の印の左へ 17px ずつ並べて文の外にはみ出すので、そのぶんカードの左の辺を広げて印も包む
      // （theme-glass.css の .mk-sub と同じ間隔）
      const subs = (s.dataset.rsub || "").split(" ").filter(Boolean).length;
      // ユーザーと AI の両方のコメントがあるとき、2つめの印は右の外へはみ出すので、右の辺も同じだけ広げる
      const notes2 = (s.dataset.notes || "").split(" ").filter(Boolean).length > 1 ? 1 : 0;
      const r = { t: y, b: y + s.offsetHeight, l: x - SUB_STEP * subs, r: x + s.offsetWidth + SUB_STEP * notes2, o: 1 };
      restH = s.offsetHeight;
      // 文に付いていかせる（track）ときは位置と大きさだけ飛ばし、濃さは今の動きのまま（ここで濃さを 1 にすると、出かけのカードが濃いまま現れた）
      if (jump) { const { o, ...pos } = r; box.to(pos, { jump: true }); return; }
      // 見えていないカード（初めて・隠したあと）は、出る位置へ先に置いてから薄く出す。
      // 前は初めてのカードが濃いまま現れ、隠したカードは前の位置から滑りながら出ていた
      if (!placed || box.get("o") < 0.05) box.to({ ...r, o: 0 }, { jump: true });
      // 下へ移るなら下の辺が、上へ移るなら上の辺が先に飛ぶ
      const down = r.t > box.get("t");
      const [front, back] = down ? ["b", "t"] : ["t", "b"];
      // マウスの縦の勢いを、進む辺の初速として足し、勢いに応じて減衰も弱める（向きが合うときだけ）。
      // 初速だけでは減衰に吸われて、速く振っても行き過ぎが 2px ほどしか増えなかった。勢いが上限なら減衰は 70% まで下がる（55% では、とても速く振ると 43px 行き過ぎた）
      const push = fling && (fling > 0) === down ? Math.min(1, Math.abs(fling) / 1000) : 0;
      box.tune(front, lead.k, lead.c * (1 - 0.3 * push)); box.tune(back, trail.k, trail.c);
      box.to(r); placed = true;
      if (push) box.kick(front, fling);
    },
    hide() { if (placed) box.to({ o: 0 }); },
  };
}

let sel = null, hov = null, hovered = null;

/** 描き直したあとに呼ぶ。選んだ文へカードを滑らせる */
function afterRender() {
  if (document.body.dataset.theme !== "glass") return;
  if (!sel) setup();
  const s = document.querySelector('.s[aria-current="true"]');
  if (s) {
    sel.el.style.setProperty("--sel-k", getComputedStyle(s).getPropertyValue("--k"));
    sel.show(s);
  } else sel.hide();
  hovered = null; hov.hide();
  tocGlide();
  commentsIn();
}

// --- コメントの行が増える・消える ----------------------------------------------
// コメントの増減にアニメーションを付ける。
// 増えた行は高さ 0 から伸びながら現れ、消す行は縮みながら消える。高さ・濃さ・少しの沈み込みを1本のバネの進み具合 p で動かす。
// 行の間のすき間（一覧の row-gap）も一緒に畳まないと、消えた行の跡にすき間だけが残るので、下の余白を負にして詰める
let cmSeen = { sid: null, ids: new Set() };
function lineRig(li, apply) {
  const gap = parseFloat(getComputedStyle(li.parentElement).rowGap) || 0, h = li.offsetHeight;
  li.style.overflow = "hidden";
  return rig(["p"], { k: 260, c: 24, eps: 0.001 }, v => {
    const p = Math.max(0, v.p);
    li.style.height = `${h * Math.min(1, p)}px`;
    li.style.marginBottom = `${-(gap + 0) * (1 - Math.min(1, p))}px`;
    li.style.opacity = String(Math.min(1, p * 1.4 - 0.2));
    li.style.transform = `translateY(${(1 - Math.min(1, p)) * 8}px) scale(${0.97 + 0.03 * Math.min(1, p)})`;
    apply?.(p);
  });
}
const clearLine = li => { for (const k of ["height", "marginBottom", "opacity", "transform", "overflow"]) li.style[k] = ""; };
/** 描き直したあと、同じ文の一覧に新しく現れた行だけを伸ばして出す（別の文へ移ったときは、文詳細の入れ替えの動きに任せる） */
function commentsIn() {
  const sid = document.querySelector('.s[aria-current="true"]')?.dataset.sid ?? null;
  const lis = [...document.querySelectorAll("#detail .cms > li[data-cid]")];
  const ids = new Set(lis.map(li => li.dataset.cid));
  if (sid && sid === cmSeen.sid && !REDUCE) {
    for (const li of lis) {
      if (cmSeen.ids.has(li.dataset.cid)) continue;
      const r = lineRig(li);
      r.to({ p: 0 }, { jump: true });
      r.to({ p: 1 }, { then: () => clearLine(li) });
    }
  }
  cmSeen = { sid, ids };
}
/** 行を縮めて消す。消えきったら解決する（呼ぶ側は、それから描き直す） */
function collapseOut(li) {
  return new Promise(done => {
    if (!li || REDUCE || document.body.dataset.theme !== "glass") return done();
    if (cmSeen.ids) cmSeen.ids.delete(li.dataset.cid);
    const r = lineRig(li);
    r.to({ p: 1 }, { jump: true });
    r.to({ p: 0 }, { then: done });
  });
}

function setup() {
  // ホバーのカードは速く吸いつく（k 200 では吸いつきが遅く見えたので 520）。
  // 選んだカード: 進む辺は減衰比 約0.64（行き過ぎ 約7%）で揺れ戻り、後ろの辺は 約0.67 で遅れてついてくる。
  // 0.49 だと4文先へ移るとき下の辺が 66px 行き過ぎ、カードが 159px 伸びて読む邪魔になった（行き過ぎは移る距離に比例する）
  // ホバーのカード: 吸いつく速さは前（k 520）のまま、進む辺 約0.72・後ろ 約0.83 で伸びと行き過ぎを小さく抑える（読んでいる間に揺れて邪魔しない）
  sel = glideBox("sel", { lead: { k: 300, c: 22 }, trail: { k: 180, c: 18 }, side: { k: 300, c: 30 } });
  hov = glideBox("hov", { lead: { k: 560, c: 34 }, trail: { k: 400, c: 33 }, side: { k: 520, c: 40 } });
  const text = document.getElementById("text");
  // ポインターの縦の速さ（px/秒）を、直近 100ms の動きから測る（マウスの速さに応じて行き過ぎる慣性を付けるため）。
  // 文に入った瞬間の出来事（pointerover）は移動の出来事（pointermove）より先に届くので、その瞬間の位置も記録に入れてから測る。
  // 100ms より古い位置は捨てる（止まってから動き出したときに、古い位置で速さを薄めない）
  const trail = [];
  const note = e => {
    const t = performance.now();
    trail.push([t, e.clientY]);
    while (trail.length && t - trail[0][0] > 100) trail.shift();
  };
  text.addEventListener("pointermove", note);
  const pointerVy = () => {
    if (trail.length < 2) return 0;
    const [t0, y0] = trail[0], [t1, y1] = trail[trail.length - 1];
    return t1 - t0 > 4 ? (y1 - y0) / ((t1 - t0) / 1000) : 0;
  };
  text.addEventListener("pointerover", e => {
    note(e);
    const s = e.target.closest(".s");
    if (!s || s === hovered) return;
    hovered = s;
    // 勢いは速さの 0.7 倍を渡し、上限 ±1000px/秒（快適さのため。とても速く振っても行き過ぎを 20px 前後に収める）
    const fling = Math.max(-1000, Math.min(1000, pointerVy() * 0.7));
    if (s.getAttribute("aria-current") === "true") hov.hide(); else hov.show(s, false, fling);
  });
  text.addEventListener("pointerleave", () => { hovered = null; hov.hide(); });
  addEventListener("resize", () => { const s = document.querySelector('.s[aria-current="true"]'); if (s) sel.show(s); });
}

/** 文の今の位置へ、選んだカードとホバーのカードを飛ばす（バネを経由しない）。折り返しが変わる間に使う */
function track() {
  if (!sel) return;
  const s = document.querySelector('.s[aria-current="true"]');
  if (s) sel.show(s, true);
  if (hovered) hov.show(hovered, true);
}

// --- 段落目次の今の段落のカード -------------------------------------------------------
// 今の段落を示す白いカードを1枚だけ持ち、段落が移ると次の行へ滑り、選ぶと行の上で膨らみながら濃くなって出て、外すと縮みながら薄れて消える
// 位置・高さ・濃さ・大きさを1本のカードのバネで動かす。見えていないカードは、出る行へ先に置いてから出す
const TOC_SCALE = 0.94;   // 出るとき・消えるときの縮み。行の高さ 36px で上下に約1px ずつ
let tocBox = null;
function tocGlide() {
  const toc = document.getElementById("toc");
  if (!toc) return;
  if (!tocBox) {
    const el = document.createElement("div"); el.className = "toc-glide"; el.setAttribute("aria-hidden", "true");
    const r = rig(["y", "h", "w", "o", "s"], { k: 320, c: 32, eps: { y: 0.05, h: 0.05, w: 0.05, o: 0.002, s: 0.0005 } }, v => {
      el.style.transform = `translateY(${v.y}px) scale(${v.s})`;
      el.style.height = `${Math.max(0, v.h)}px`; el.style.width = `${Math.max(0, v.w)}px`;
      el.style.opacity = String(clamp01(v.o));
    });
    r.to({ s: TOC_SCALE, o: 0 }, { jump: true });
    tocBox = { el, r };
  }
  // 目次を作り直すとカードも一緒に消えるので、無ければ入れ直す
  if (!toc.contains(tocBox.el)) toc.prepend(tocBox.el);
  const cur = toc.querySelector('button[aria-current="true"]');
  const { r } = tocBox;
  if (!cur) { r.to({ o: 0, s: TOC_SCALE }); return; }
  const li = cur.parentElement, target = { y: li.offsetTop, h: li.offsetHeight, w: li.offsetWidth };
  if (r.get("o") < 0.05) r.to({ ...target, s: TOC_SCALE, o: 0 }, { jump: true });
  r.to({ ...target, o: 1, s: 1 });
}

// --- 文詳細の欄の開閉 ---------------------------------------------------------
// 閉じるとき、欄は右上の角へ縮んで開くボタン（44px のカード）と同じ大きさ・位置になり、そこでボタンに入れ替わる（吸い込まれる）。
// 開くときは逆にボタンから伸びて出る（アイコンに吸い込まれるような動きにする）。
// 縮みの進み具合 p（0＝開いた・1＝閉じた）1本で、幅・縦の縮み・角丸・中身の濃さ・くの字の形を全部動かす（ばらばらに動かさない）
// 引っ込むときは幅 0 まで縮める（開くボタンは外した）。縦は縮めず、右から畳むだけにする
const PANEL_W = 440, HANDLE = 0;
const PANEL_PAD = 16;   // 文詳細の左右の padding（theme-glass.css の .detail と同じ値）
let panelRig = null;

/** くの字の3点を p に合わせて「>」（p=0）から「<」（p=1）へ動かす。開閉ボタンとアイコンの列の両方 */
function chevron(p) {
  const q = Math.min(1, Math.max(0, p));
  const x1 = 8 + 2 * q, x2 = 11 - 4 * q;   // > は 8,9 11,12 8,15 ／ < は 10,9 7,12 10,15（Lucide の panel-right-close/open と同じ点）
  for (const el of document.querySelectorAll(".pchev")) el.setAttribute("points", `${x1},9 ${x2},12 ${x1},15`);
}

/** 欄が伸び縮みする間、本文の段の幅を固定する。紙の幅が毎フレーム変わると本文が何度も折り返し直し、文が1行ぶんずつ跳んでいた。
    幅は「狭いほう」に固定し、折り返しは開く前か閉じたあとの1回にまとめる（紙が段より広いときは何も変わらない） */
function holdText(width) {
  const text = document.getElementById("text");
  if (width == null) { text.style.width = ""; return; }
  text.style.width = `${Math.max(0, Math.min(text.offsetWidth, width))}px`;
}
/** 文詳細が開いたときの、本文の段の幅（紙の内側から欄と隙間の幅を引く。段の上限 760px は CSS の max-width） */
function textWidthWhenOpen() {
  const paper = document.getElementById("paper"), cs = getComputedStyle(paper);
  return paper.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - (PANEL_W + 12);
}

function panel() {
  if (panelRig) return panelRig;
  const el = document.getElementById("detail"), paper = document.getElementById("paper");
  panelRig = rig(["p"], { k: 230, c: 28, eps: 0.001 }, v => {
    const p = Math.min(1.02, Math.max(-0.02, v.p)), h = el.parentElement.clientHeight || 800;
    const w = PANEL_W + (HANDLE - PANEL_W) * p;
    el.style.width = el.style.flexBasis = `${Math.max(0, w)}px`;
    el.style.padding = w < 120 ? "0" : "";
    el.style.marginLeft = `${-12 * Math.min(1, Math.max(0, p))}px`;   // 並びの隙間 12px も一緒に畳む
    el.style.transformOrigin = "top right";
    el.style.transform = `translateX(${24 * Math.min(1, Math.max(0, p))}px)`;
    // カードの角丸 20 から、吸い込まれる先の開くボタンの角丸 14（--r-3）へ。窓の右の角に当たる右の2つは、開いているときは 0 で埋め、縮むにつれてボタンの 14 へ
    const q = clamp01(p);
    el.style.borderRadius = `${20 - 6 * p}px ${14 * q}px ${14 * q}px ${20 - 6 * p}px`;
    // 欄が畳まれると本文の紙が一番右のカードになり、その右の角が窓の角に当たる。欄と同じ進み具合で紙の右の角丸を 20 から 0 へ外し、地がのぞかないようにする
    paper.style.borderTopRightRadius = paper.style.borderBottomRightRadius = `${20 * (1 - q)}px`;
    el.style.overflow = "hidden";
    el.style.setProperty("--content-o", String(Math.max(0, 1 - p * 2.2)));   // 中身は縮みの前半で先に薄れる
    // 中身の浮き上がりも同じ p で動かす。前は CSS の rise（.55秒）が欄の幅のバネと別に走り、開く途中で動きがずれていた
    el.style.setProperty("--content-y", `${14 * clamp01(p * 2.2)}px`);
    // 中身は開いたときの幅のまま置き、欄の縁で切って見せる。欄の幅に合わせて折り返し直すと、開く途中で字が並び替わって見えた
    // 右の余白はスクロールバーの幅ぶん狭くしてあるので、左右の余白とスクロールバーを足すと PANEL_PAD の2倍になる
    el.style.setProperty("--content-w", `${PANEL_W - PANEL_PAD * 2}px`);
    chevron(p);
    window.liquid?.progress(v.p);   // アイコンの列の濃紺も、欄と同じ進み具合で流す（liquid.js）
    track();  // 欄の幅が変わると本文が折り返し直すので、選んだカードとホバーのカードを毎フレーム文に付いていかせる
  });
  panelRig.to({ p: 0 }, { jump: true });
  return panelRig;
}
function clearPanelStyle() {
  const el = document.getElementById("detail");
  for (const k of ["width", "flexBasis", "transform", "transformOrigin", "borderRadius", "overflow", "padding", "marginLeft"]) el.style[k] = "";
  const paper = document.getElementById("paper");
  paper.style.borderTopRightRadius = paper.style.borderBottomRightRadius = "";   // 止まったあとは body.closed の CSS が角を決める
  el.style.removeProperty("--content-o"); el.style.removeProperty("--content-y"); el.style.removeProperty("--content-w");
}
/** 欄を畳む。ボタンの大きさまで縮みきったら done（閉じた状態で描き直す）を呼び、ボタンに入れ替える */
function closeDetail(done) {
  if (document.body.dataset.theme !== "glass") return done();
  holdText(document.getElementById("text").offsetWidth);   // 閉じる間は今の（狭い）幅のまま。閉じきってから広げる
  panel().to({ p: 1 }, { then: () => { clearPanelStyle(); holdText(null); done(); chevron(1); } });
}
/** 欄を開く。開いた状態で描き直したあとに呼ぶ。ボタンの大きさから伸びて出る */
function openDetail() {
  if (document.body.dataset.theme !== "glass") return;
  const p = panel();
  p.to({ p: 1 }, { jump: true });
  holdText(textWidthWhenOpen());   // 開く前に、開いたあとの（狭い）幅で1回だけ折り返す
  track();
  p.to({ p: 0 }, { then: () => { clearPanelStyle(); holdText(null); chevron(0); afterRender(); } });
}

// --- 畳んだカード（指摘・参照要件・版履歴・解決済み）の伸び縮み --------------------
// 1つの畳みに1本のバネを持たせる。押すたびに新しく作ると、素早く2回押したときに2本が高さを取り合っていた
const foldRigs = new WeakMap();
document.addEventListener("click", e => {
  const summary = e.target.closest("details.more > summary");
  if (!summary || document.body.dataset.theme !== "glass" || REDUCE) return;
  e.preventDefault();
  const d = summary.parentElement, body = d.querySelector(":scope > .body");
  if (!body) { d.open = !d.open; return; }
  // 中身の高さ・濃さ・「›」の回転を、同じバネの進み具合 o（0〜1）で動かす（ばらばらに動かさない）
  const chev = summary.querySelector(".chev");
  let f = foldRigs.get(d);
  if (!f) {
    // 高さ・濃さ・「›」の回転を1本の進み具合 o（0〜1）で動かす。高さは開いたときの高さ full に o を掛ける
    // 余白（上下の padding）も高さと同じ進み具合で縮める。高さだけを縮めても、余白の 10px は残って最後に跳んだ
    const cs = getComputedStyle(body);
    f = { full: 0, closing: false, pt: parseFloat(cs.paddingTop), pb: parseFloat(cs.paddingBottom) };
    f.paint = x => {
      const o = clamp01(x);
      body.style.height = `${Math.max(0, f.full * x)}px`; body.style.opacity = String(o);
      body.style.paddingTop = `${f.pt * o}px`; body.style.paddingBottom = `${f.pb * o}px`;
      chev?.style.setProperty("--chev", `${o * 90}deg`);
    };
    f.r = rig(["o"], { k: 300, c: 32, eps: 0.001 }, v => f.paint(v.o));
    f.r.to({ o: d.open ? 1 : 0 }, { jump: true });
    body.style.height = body.style.opacity = ""; chev?.style.removeProperty("--chev");
    foldRigs.set(d, f);
  }
  // 高さは余白（padding）も含めて数える（box-sizing: border-box）
  body.style.overflow = "hidden"; body.style.boxSizing = "border-box";
  if (!d.open || f.closing) {
    // 開く（閉じかけの途中で押し直したときも、今の高さから開き直す）
    f.closing = false;
    if (!d.open) { d.open = true; d.dispatchEvent(new Event("toggle")); }
    // 開いたときの高さを測ったら、バネが動き出す前に今の進み具合の高さを置き直す。
    // 置き直さないと、測るために外した高さのまま1フレーム描かれ、中身が全部見えてから縮み直していた
    body.style.height = body.style.paddingTop = body.style.paddingBottom = ""; f.full = body.scrollHeight; f.paint(f.r.get("o"));
    f.r.to({ o: 1 }, { then: () => { body.style.height = body.style.overflow = body.style.boxSizing = body.style.paddingTop = body.style.paddingBottom = ""; chev?.style.removeProperty("--chev"); } });
  } else {
    f.closing = true;
    f.full = body.scrollHeight;
    f.r.to({ o: 0 }, { then: () => { f.closing = false; d.open = false; body.style.height = body.style.overflow = body.style.opacity = body.style.boxSizing = body.style.paddingTop = body.style.paddingBottom = ""; chev?.style.removeProperty("--chev"); } });
  }
}, true);

// --- 別の文へ移ったときの文詳細の入れ替え -------------------------------------
// 中身全体をまとめて一度だけ入れ替える。古い中身は少し上へ抜けて薄れ（退場）、そのあと新しい中身が下から上がって出る（登場）。
// 欄の高さは動かさない（退場演出を付けて、切り替わりが唐突にならないようにする）。
// 前は変わった要素だけを1つずつ入れ替えていたが、文を移ると中身のほぼ全部が変わるので、ばらばらに動いて落ち着かなかった。
// 1つの出来事なので、退場と登場を1本のバネの進み具合 p（0→1）で動かす。退場は p 0〜0.45 に ease-in、登場は p 0.45〜1 に ease-out。
// DOM はすぐ新しい中身に替え（id やイベントが新しい文のものになる）、古い中身は写しを上に重ねて退場させる。
// 欄の頭（文詳細・何段落目の何文目）は動かさず、字だけを退場が終わる瞬間に替える（先に替えると、古い中身の上に新しい文の位置が出て食い違った）
// 退場は2乗の ease-in（3乗だと動き出しが止まって見え、抜けていく様子がほとんど見えなかった）、登場は3乗の ease-out
const easeIn = t => t * t, easeOut = t => 1 - (1 - t) ** 3;
const OUT_Y = 8, IN_Y = 10;   // 退場で上へ抜ける量・登場で下から上がる量（px）
const SWAP = 0.5;             // 退場が終わり登場が始まる進み具合。k 110・c 21 でおよそ 150ms 目
let morphRig = null, morphGhost = null;

/** 文詳細の中身を html に入れ替える。古い中身は退場し、新しい中身が登場する。
    afterSwap は新しい中身が入って欄が頭まで戻った直後に呼ぶ（「全文で見る」が送り先までスクロールし直すため）。
    keepHead が真なら欄の頭（文詳細・何段落目の何文目）は動かさず字だけを替え、偽なら頭も中身と一緒に退場・登場させる
    （別の画面へ移るときは題そのものが変わるので、頭だけ止まっていると切り替わって見えなかった） */
function morphDetail(el, html, afterSwap, keepHead = true) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  if (REDUCE || document.body.dataset.theme !== "glass") { el.replaceChildren(tpl.content); afterSwap?.(); return; }
  // 前の入れ替えの途中で次の文へ移ったときは、前の動きを止めて写しを捨て、今見えている中身から入れ替え直す
  morphRig?.stop();
  morphGhost?.remove();
  const keep = c => keepHead && c.dataset.k === "head";
  const olds = [...el.children].filter(c => !keep(c));
  const ghost = document.createElement("div");
  ghost.className = "morph-ghost"; ghost.setAttribute("aria-hidden", "true");
  const top = olds[0] ? olds[0].offsetTop : 0;
  Object.assign(ghost.style, { position: "absolute", left: "0", top: `${top}px`, width: "100%", pointerEvents: "none",
    display: "flex", flexDirection: "column", gap: getComputedStyle(el).rowGap,
    paddingLeft: getComputedStyle(el).paddingLeft, paddingRight: getComputedStyle(el).paddingRight, boxSizing: "border-box" });
  for (const o of olds) {
    const c = o.cloneNode(true); c.removeAttribute("id");
    for (const x of c.querySelectorAll("[id]")) x.removeAttribute("id");
    c.style.opacity = c.style.transform = "";   // 前の登場の途中の値を写しに持ち込まない
    ghost.append(c);
  }
  // 頭はそのまま残し、残りを新しい中身に替える
  const head = keepHead ? tpl.content.querySelector('[data-k="head"]') : null, oldHead = keepHead ? el.querySelector(':scope > [data-k="head"]') : null;
  const firstHead = oldHead || head;
  el.replaceChildren(...(firstHead ? [firstHead] : []), ...[...tpl.content.children].filter(c => c !== head), ghost);
  const news = [...el.children].filter(c => !keep(c) && c !== ghost);
  morphGhost = ghost;
  let swapped = false;
  const r = morphRig = rig(["p"], { k: 110, c: 21, eps: 0.001 }, v => {
    const p = v.p, out = easeIn(clamp01(p / SWAP)), inn = easeOut(clamp01((p - SWAP) / (1 - SWAP)));
    ghost.style.opacity = String(1 - out);
    ghost.style.transform = `translateY(${-OUT_Y * out}px)`;
    // 退場が終わるまでは新しい中身を隠す。終わった瞬間に欄を頭までスクロールし直す（新しい文は頭から読む）
    if (!swapped && p >= SWAP) { swapped = true; el.scrollTop = 0; if (oldHead && head) oldHead.replaceWith(head); afterSwap?.(); }
    for (const n of news) { n.style.opacity = String(inn); n.style.transform = `translateY(${IN_Y * (1 - inn)}px)`; }
  });
  r.to({ p: 0 }, { jump: true });
  r.to({ p: 1 }, { then: () => {
    if (!swapped) { if (oldHead && head) oldHead.replaceWith(head); afterSwap?.(); }
    ghost.remove(); if (morphGhost === ghost) morphGhost = null;
    for (const n of news) { n.style.opacity = ""; n.style.transform = ""; }
  } });
}

window.motion = { afterRender, closeDetail, openDetail, morphDetail, tocGlide, collapseOut };
