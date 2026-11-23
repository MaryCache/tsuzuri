// アプリを開いたときのオープニング。
// 動かすのは transform・opacity と、糸を描く線の stroke-dashoffset だけ。ぼかしは動かさない（yui540.md 原則2・3）。
// 1つの出来事は 0.6〜0.7 秒（yui540.md「数字の地図」）で、重ねて全体を約1.9秒に収める。押す・打つで最後の姿まで飛ばせる。
// 入力は止めない（重ねる層はポインターを受けない。キーは打ったとおりに届き、同時に動きを終わらせる）。
"use strict";

const Opening = (() => {
  const body = document.body;
  // アプリを開くたびに1回流す。同じ窓で読み込み直したときは流さない（毎回の読み込み直しで待たせないため）
  const KEY = "tsuzuri-opened";
  const seen = () => { try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; } };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const anims = [];
  let cleanup = () => {};

  const spring = () => getComputedStyle(document.documentElement).getPropertyValue("--spring").trim() || "cubic-bezier(.2, .8, .2, 1)";
  const show = () => body.removeAttribute("data-opening");
  const visible = el => el && el.offsetParent !== null;

  /** カードを下から少し浮かせて着地させる。濃さは最初の 1/4 で出し切り、形は最後までバネで動かす（yui540.md 型 G） */
  function settle(els, start, gap, lift = 14) {
    els.filter(visible).forEach((el, i) => {
      anims.push(el.animate([
        { opacity: 0, transform: `translateY(${lift}px) scale(.985)` },
        { opacity: 1, offset: .25 },
        { opacity: 1, transform: "none" },
      ], { duration: 700, delay: start + i * gap, easing: spring(), fill: "backwards" }));
    });
  }

  // --- 糸で綴る -------------------------------------------------------------
  // ただのクリッピングでなくモーショングラフィックスとして凝るため「糸で綴る」にした（ほかに比べた案: カードが順に着地する・本文の紙だけ着地する・ロゴを左右に切り抜いて現す）。
  // 1本の糸が吹き出しの輪を一筆で描き、中に一文の棒が伸び、しっぽの糸が右へ波打って抜ける。糸が通った所で字が1つずつバネで立ち、
  // 糸が抜けたあとに z・u・r の切り抜きが残る（ロゴの作りそのもの: wordmark.py の波の帯）。組み上がったロゴは道具の欄へ飛ぶ。
  // 部品はロゴの正本から写す: 輪としっぽと棒は tsuzuri-lockup.svg、一筆の中心線は tsuzuri-opening.json（bubble.logo.js を同じ値で描いたもの）、
  // 字は tsuzuri-wordmark.glyphs.json。画素で切り抜かず、ベクターの部品ごとに動かす。

  // 部品は play() の頭で取りに行き、書体を待つ間に揃える
  let partsP = null;
  function loadParts() {
    partsP ??= Promise.all([
      fetch("/brand/tsuzuri-lockup.svg").then(r => r.text()),
      fetch("/brand/tsuzuri-opening.json").then(r => r.json()),
      fetch("/brand/tsuzuri-wordmark.glyphs.json").then(r => r.json()),
    ]).then(([svgText, line, word]) => {
      const root = new DOMParser().parseFromString(svgText, "image/svg+xml").documentElement;
      const sym = root.querySelector("#symbol");
      const [threadD, barD] = [...sym.querySelectorAll("path")].map(p => p.getAttribute("d"));
      const [, sx, sy, k] = sym.getAttribute("transform").match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/).map(Number);
      return { viewBox: root.getAttribute("viewBox"), sx, sy, k, threadD, barD, wordD: root.querySelector("#wordmark").getAttribute("d"), line, word };
    });
    return partsP;
  }

  /** cubic-bezier(x1, y1, x2, y2) の進み具合 y から、時間の割合 t を数値で逆に引く。糸の先が字に届く時刻を出すのに使う */
  function bezierTimeAt(p, [x1, y1, x2, y2]) {
    const at = (t, a, b) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { const s = (lo + hi) / 2; if (at(s, y1, y2) < p) lo = s; else hi = s; }
    return at((lo + hi) / 2, x1, x2);
  }

  const SVGNS = "http://www.w3.org/2000/svg";
  const el = (name, attrs = {}, parent) => {
    const n = document.createElementNS(SVGNS, name);
    for (const [a, v] of Object.entries(attrs)) n.setAttribute(a, v);
    parent?.append(n);
    return n;
  };
  const poly = pts => `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}`;

  /** 本体。道具の欄のロゴと同じ大きさ・同じ viewBox の SVG を作って画面の中央へ拡大して置き、組み上げてから縮めて定位置へ飛ばす。
      最後の姿は欄のロゴと同じ絵（同じパス・同じ沈み込みのフィルター）なので、着いた所で入れ替えても継ぎ目が出ない */
  async function stitch() {
    const P = await loadParts();
    const logo = document.querySelector(".brand .logo");
    const r = logo.getBoundingClientRect();
    // 中央で組み上げる間は濃紺のまま見せる（沈み込みのフィルターは淡い地に溶けて、糸の動きが読めなかった）。
    // 飛ぶ間に、同じ形で沈み込みの付いた写し（欄のロゴと同じ img）へ濃さを入れ替え、欄のカードに沈んで着く
    const svg = el("svg", { viewBox: P.viewBox, class: "op-ghost op-solid", "aria-hidden": "true" });
    Object.assign(svg.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const defs = el("defs", {}, svg);
    const ink = el("g", { fill: "#222B42" }, svg);

    // 輪としっぽ: 一筆の中心線に沿って太い線を伸ばし、それを覆いにして形を現す（線の端は丸く、形より少し太く）
    const mask = el("mask", { id: "op-draw", maskUnits: "userSpaceOnUse", x: -40, y: -40, width: 200, height: 200 }, defs);
    const draw = el("path", { d: poly(P.line.pts), fill: "none", stroke: "#fff", "stroke-width": P.line.weight * 1.3, "stroke-linecap": "round", "stroke-linejoin": "round" }, mask);
    const sym = el("g", { transform: `translate(${P.sx} ${P.sy}) scale(${P.k})` }, ink);
    el("path", { d: P.threadD, mask: "url(#op-draw)" }, sym);
    const bar = el("g", { style: "transform-box: fill-box; transform-origin: 0% 50%" }, sym);
    el("path", { d: P.barD }, bar);

    // 字: 1字ずつ置き、ロゴの文字の形（切り抜き済み）で切る。切った結果は z・u・r に糸の通った跡がある字になる
    const clip = el("clipPath", { id: "op-word" }, defs);
    el("path", { d: P.wordD }, clip);
    const letters = P.word.glyphs.map(g => {
      const outer = el("g", { style: "transform-box: fill-box; transform-origin: 50% 100%" }, ink);
      const inner = el("g", { "clip-path": "url(#op-word)" }, outer);
      const path = el("path", { d: g.d, transform: `translate(${g.x} 0)` }, inner);
      return { g, outer, path };
    });
    // 走る糸: しっぽの先から字の下を通って、波の帯の始まりへ。そこからは帯と同じ波で z・u・r を抜け、r と i のすき間で消える
    const thread = el("path", { fill: "none", stroke: "#222B42", "stroke-width": P.word.thread.width, "stroke-linecap": "round" }, ink);

    svg.style.visibility = "hidden";
    body.append(svg);
    // 字の外接の箱は、置いてから測る（wordmark.py と同じ式で波の位置を出すため）
    const box = letters.map(({ g, path }) => { const b = path.getBBox(); return { x0: g.x + b.x, x1: g.x + b.x + b.width }; });
    const idx = c => P.word.glyphs.map((g, i) => g.char === c ? i : -1).filter(i => i >= 0);
    const [u1, u2] = idx("u"), [z] = idx("z"), [rr] = idx("r"), last = letters.length - 1;
    const xu = (box[u2].x0 + box[u2].x1) / 2;
    const { mid, amp, lambda } = P.word.thread;
    const wave = x => mid + amp * Math.cos((2 * Math.PI * (x - xu)) / lambda);
    const xs = (box[u1].x1 + box[z].x0) / 2, xe = (box[rr].x1 + box[last].x0) / 2;
    const [ex, ey] = P.line.pts.at(-1);
    const E = [P.sx + ex * P.k, P.sy + ey * P.k];
    const pts = [];
    // しっぽの先から波の始まりまでは、3次の曲線で滑らかにつなぐ（出る向きは右、入る向きは波の傾き）
    const S = [xs, wave(xs)], c1 = [E[0] + lambda * .5, E[1]], c2 = [xs - lambda * .35, wave(xs)];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, u = 1 - t;
      pts.push([0, 1].map(j => u * u * u * E[j] + 3 * u * u * t * c1[j] + 3 * u * t * t * c2[j] + t * t * t * S[j]));
    }
    for (let i = 1; i <= 60; i++) { const x = xs + ((xe - xs) * i) / 60; pts.push([x, wave(x)]); }
    thread.setAttribute("d", poly(pts));
    const len = thread.getTotalLength();
    const seg = lambda * 1.1;
    Object.assign(thread.style, { strokeDasharray: `${seg} ${len + seg}`, strokeDashoffset: `${seg}` });
    const drawLen = draw.getTotalLength();
    Object.assign(draw.style, { strokeDasharray: `${drawLen} ${drawLen}`, strokeDashoffset: `${drawLen}` });

    logo.style.opacity = "0";
    svg.style.visibility = "";
    const scale = Math.min((innerWidth * .46) / r.width, 4.2);
    const center = `translate(${innerWidth / 2 - (r.left + r.width / 2)}px, ${innerHeight / 2 - (r.top + r.height / 2)}px) scale(${scale})`;
    svg.style.transform = center;

    // 拍（ms）: 輪を描く 0〜560 ／ 棒 360〜 ／ 糸が走る 470〜1170 ／ 字は糸の先が届いた時 ／ 最後の字が立ち上がる途中から、その勢いのまま飛ぶ
    const T_DRAW = 560, T_RUN0 = 470, T_RUN = 700;
    const RUN_EASE = [.45, 0, .25, 1];
    anims.push(draw.animate([{ strokeDashoffset: drawLen }, { strokeDashoffset: 0 }], { duration: T_DRAW, easing: "cubic-bezier(.6, 0, .3, 1)", fill: "both" }));
    anims.push(bar.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 620, delay: 360, easing: spring(), fill: "both" }));
    anims.push(thread.animate([{ strokeDashoffset: seg }, { strokeDashoffset: -len }], { duration: T_RUN, delay: T_RUN0, easing: `cubic-bezier(${RUN_EASE})`, fill: "both" }));
    // 糸の先が字の真ん中を越えた時刻に、その字を下から立てる。先の位置は「先の道のり ÷ (道の長さ＋糸の長さ)」の進み具合から引く
    const along = [];
    for (let s = 0; s <= len; s += len / 300) along.push([s, thread.getPointAtLength(s).x]);
    let lastPop = 0;
    letters.forEach(({ outer }, i) => {
      const cx = (box[i].x0 + box[i].x1) / 2;
      const hit = (along.find(([, x]) => x >= cx) ?? along.at(-1))[0];
      const at = T_RUN0 + T_RUN * bezierTimeAt(hit / (len + seg), RUN_EASE);
      lastPop = Math.max(lastPop, at);
      anims.push(outer.animate([
        { transform: "translateY(260px) scale(.3)", opacity: 0 },
        { opacity: 1, offset: .2 },
        { transform: "none", opacity: 1 },
      ], { duration: 620, delay: at, easing: spring(), fill: "both" }));
    });
    // 飛ぶ: 止めてから飛ばさない（ロゴができあがった所の慣性を活かして左上へ向かわせないと、動きが分断されて見えた）。
    // 最後の字が立ち上がる途中から、字が立つ上向きの速さと、糸が右へ抜ける速さを最初の速さとして渡し、位置と大きさをバネで解く。
    // 決まった曲線ではなく積分にしたので、組み上がりの勢いがそのまま続き、少し右上へ流れてから弧を描いて左上の定位置に着く
    const sunk = logo.cloneNode();
    sunk.className = "op-ghost";
    Object.assign(sunk.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, transform: center, opacity: "0" });
    body.append(sunk);
    const flyAt = lastPop + 90;
    anims.push(inertialFly(svg, sunk, flyAt, {
      x: innerWidth / 2 - (r.left + r.width / 2), y: innerHeight / 2 - (r.top + r.height / 2), s: scale,
      vx: 320, vy: -1100,
    }));
    settle([document.querySelector(".rail"), document.querySelector(".side"), $("paper"), $("detail")], flyAt + 60, 80);
    cleanup = () => { logo.style.opacity = ""; svg.remove(); sunk.remove(); };
    anims.find(a => a.inertial).finished.then(() => cleanup());
  }

  /** 位置（x, y・px）と大きさ s を、0・0・1 へ向かうバネで動かす。毎フレーム solid と sunk の両方に同じ姿を当て、
      定位置に近づくほど濃紺の solid から沈み込みの sunk へ濃さを入れ替える（同じ形を重ねて入れ替えるので二重には見えない）。
      WAAPI の Animation と同じく finished・finish・cancel・effect.getTiming を持たせ、押す・打つで飛ばす処理と終わりの見積もりにそのまま乗せる */
  function inertialFly(solid, sunk, delay, { x, y, s, vx, vy }) {
    // 硬さと減衰: 減衰比 約0.84（画面のほかのバネ spring(280, 28) と同じ）で、少しだけ行き過ぎて戻る。硬さは中央から欄までの距離に合わせて柔らかく
    const K = 70, C = 14, KS = 60, CS = 13;
    const st = { x, y, s, vx, vy, vs: 0 };
    const d0 = Math.hypot(x, y) || 1;
    let raf = 0, timer = 0, last = 0, done = false, resolve;
    const finished = new Promise(r => { resolve = r; });
    const apply = () => {
      const tf = `translate(${st.x}px, ${st.y}px) scale(${st.s})`;
      solid.style.transform = sunk.style.transform = tf;
      // 残りの距離が 7割5分 から 3割 に縮むあいだに入れ替える
      const f = clamp01((.75 - Math.hypot(st.x, st.y) / d0) / .45);
      sunk.style.opacity = String(f);
      solid.style.opacity = String(1 - f);
    };
    const stop = () => {
      if (done) return;
      done = true; clearTimeout(timer); cancelAnimationFrame(raf);
      Object.assign(st, { x: 0, y: 0, s: 1 }); apply();
      resolve();
    };
    const tick = now => {
      // フレームが詰まっても積分が暴れないよう、1歩は 1/30 秒まで
      const dt = Math.min(1 / 30, (now - last) / 1000); last = now;
      for (const [p, v, k, c, to] of [["x", "vx", K, C, 0], ["y", "vy", K, C, 0], ["s", "vs", KS, CS, 1]]) {
        st[v] += (-k * (st[p] - to) - c * st[v]) * dt;
        st[p] += st[v] * dt;
      }
      apply();
      const rest = Math.hypot(st.x, st.y) < .3 && Math.abs(st.s - 1) < .002 && Math.hypot(st.vx, st.vy) < 4;
      if (rest) stop(); else raf = requestAnimationFrame(tick);
    };
    timer = setTimeout(() => { last = performance.now(); raf = requestAnimationFrame(tick); }, delay);
    return { inertial: true, finished, finish: stop, cancel: stop, effect: { getTiming: () => ({ delay, duration: 900 }) } };
  }

  /** 動きを今すぐ最後の姿にする。押す・打つで飛ばすときに使う */
  function finish() {
    anims.forEach(a => { try { a.finish(); } catch {} });
  }

  /** 最初の描画が済んでから呼ぶ。終わったら解決する */
  async function play() {
    if (seen() || reduce) { show(); return; }
    try { sessionStorage.setItem(KEY, "1"); } catch {}
    loadParts().catch(() => {});
    // 書体の読み込みと最初の組みが落ち着いてから始める。組みの途中で始めると最初の数コマが詰まる
    await document.fonts.ready;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    // 部品が取れないなど何かで失敗しても、ロゴを隠したままにせず、カードだけ出す
    try { await stitch(); } catch { cleanup(); anims.forEach(a => a.cancel()); anims.length = 0; }
    show();
    if (!anims.length) return;
    const skip = () => finish();
    addEventListener("pointerdown", skip, { once: true, capture: true });
    addEventListener("keydown", skip, { once: true, capture: true });
    const all = Promise.allSettled(anims.map(a => a.finished)).then(() => {
      removeEventListener("pointerdown", skip, { capture: true });
      removeEventListener("keydown", skip, { capture: true });
    });
    // 呼んだ側の次の動き（ライブラリの窓）は、バネの揺れ戻りが収まるのを待たず、全体の7割5分で始めて重ねる。
    // 全部を待つと、着地してから窓が出るまで約1秒止まって見えた（順番待ちにしない）
    const end = Math.max(...anims.map(a => (a.effect.getTiming().delay || 0) + a.effect.getTiming().duration));
    await Promise.race([all, new Promise(r => setTimeout(r, end * .75))]);
  }

  // 何かで止まっても画面を隠したままにしない
  setTimeout(show, 4000);
  return { play };
})();
