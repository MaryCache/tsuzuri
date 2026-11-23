// アイコンの列の「今の画面」の濃紺を、液体のように流して移す。
// 濃紺の丸い四角を2つ（先頭と後ろ）置き、SVG のフィルター #goo（ぼかしてから輪郭を切り直す）を重ねた層にかける。
// 先頭は速いバネで飛び、後ろは遅いバネでついていく。離れている間は2つが糸を引くようにつながり、着くと1つに重なって戻る。
// 手本の呼び名は「リキッドモーション」（design-library の knowledge/motion/motion-names.md の 013・作例 svg-gooey-merge）。
// app.js が列のボタンの aria-current を書き換えるのを見張って動かすので、app.js の作りには手を入れない。
"use strict";

(() => {
  const rail = document.querySelector(".rail");
  if (!rail) return;
  const layer = document.createElement("div");
  layer.className = "rail-goo";
  layer.setAttribute("aria-hidden", "true");
  const head = document.createElement("i"), tail = document.createElement("i");
  layer.append(tail, head);
  rail.prepend(layer);

  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  // 先頭は減衰比 約0.48 で行き過ぎて揺れ戻り、後ろは 約0.53 で遅れてついてきて伸びる（前は 約0.84・0.91 で行き過ぎがほぼ無く、物理的な手触りに欠けた）
  const HEAD = { k: 280, c: 16 }, TAIL = { k: 150, c: 13 };   // 後ろが k 110 だと遅れすぎて首がちぎれ、2つの滴に分かれていた
  const st = { hy: 0, hv: 0, ty: 0, tv: 0, target: 0, show: 0, shown: 0, raf: 0, last: 0 };

  const current = () => rail.querySelector('[data-rail][aria-current="true"]');
  const yOf = b => b.offsetTop;

  function draw() {
    const x = current()?.offsetLeft ?? rail.querySelector("[data-rail]")?.offsetLeft ?? 0;
    // 後ろは先頭との距離に応じて少し細る（引き伸ばされた液体の首）
    const gap = Math.abs(st.hy - st.ty), thin = Math.max(.62, 1 - gap / 140);
    head.style.transform = `translate(${x}px, ${st.hy}px) scale(${st.shown})`;
    tail.style.transform = `translate(${x}px, ${st.ty}px) scale(${st.shown * thin})`;
    // アイコンの白は、濃紺が実際に覆っている縦の範囲だけに見せる。紺のアイコンは濃紺の下にあり、上に重ねた白い写しを
    // 濃紺の範囲で切り抜く（間を飛ばして移るとき途中が白く見えたため）。
    // 前はボタン単位で丸ごと白くしていて、通り道のアイコンが一瞬まるごと白く光った。今は液体が上を流れる間、覆われた部分だけが白い。
    // 濃紺の縦の範囲は、先頭と後ろの丸い四角（大きさ 44px を scale で縮めたもの）の上端から下端まで。間は首でつながっている
    // 先頭・後ろ・首を別々の区間にして、重なる区間をまとめる。首は2つが近いときだけある（離れすぎるとぼかしでもつながらず、2つの滴に分かれる）
    const hh = 22 * st.shown, th = 22 * st.shown * thin;
    const spans = [[st.hy + 22 - hh, st.hy + 22 + hh], [st.ty + 22 - th, st.ty + 22 + th]].sort((a, b) => a[0] - b[0]);
    const NECK = 14;   // ぼかし（標準偏差 5）で2つがつながる、縁どうしのすき間の目安
    const merged = spans[1][0] - spans[0][1] < NECK ? [[spans[0][0], Math.max(spans[0][1], spans[1][1])]] : spans;
    for (const b of rail.querySelectorAll("[data-rail]")) {
      const ic = b.querySelector(".ic"), copy = hiOf(b);
      if (!ic || !copy) continue;
      const y = b.offsetTop + ic.offsetTop, h = ic.offsetHeight;
      copy.style.transform = `translate(${b.offsetLeft + ic.offsetLeft}px, ${y}px)`;
      // アイコンに一番広く重なる区間で切り抜く（1つのアイコンに2つの区間がかかることは、アイコンが小さいのでほぼ無い）
      let best = null, bestLen = 0;
      for (const [t0, t1] of merged) { const len = Math.min(t1, y + h) - Math.max(t0, y); if (len > bestLen) { best = [t0, t1]; bestLen = len; } }
      copy.style.clipPath = st.shown > .05 && best ? `inset(${Math.max(0, best[0] - y)}px 0 ${Math.max(0, y + h - best[1])}px 0)` : "inset(50%)";
    }
  }

  // 白い写しの層。アイコンの中身（SVG）は app.js が後から読み込んで入れるので、写しは描くたびに中身がそろっているかを見て作り直す
  const hi = document.createElement("div");
  hi.className = "rail-hi";
  hi.setAttribute("aria-hidden", "true");
  rail.append(hi);
  const copies = new Map();
  function hiOf(b) {
    const ic = b.querySelector(".ic");
    if (!ic || !ic.innerHTML) return null;
    let c = copies.get(b);
    if (!c || c.dataset.src !== ic.innerHTML.length + "") {
      c?.remove();
      c = document.createElement("span");
      c.className = "ic";
      c.innerHTML = ic.innerHTML;
      c.dataset.src = ic.innerHTML.length + "";
      hi.append(c); copies.set(b, c);
    }
    return c;
  }

  function step(t) {
    const dt = Math.min(.032, (t - (st.last || t)) / 1000) || .016;
    st.last = t;
    const sub = 4, h = dt / sub;
    for (let i = 0; i < sub; i++) {
      st.hv += (-HEAD.k * (st.hy - st.target) - HEAD.c * st.hv) * h; st.hy += st.hv * h;
      st.tv += (-TAIL.k * (st.ty - st.target) - TAIL.c * st.tv) * h; st.ty += st.tv * h;
    }
    st.shown += (st.show - st.shown) * Math.min(1, dt * 14);
    draw();
    const moving = Math.abs(st.hy - st.target) > .3 || Math.abs(st.ty - st.target) > .3 || Math.abs(st.hv) + Math.abs(st.tv) > 2 || Math.abs(st.shown - st.show) > .01;
    if (moving) st.raf = requestAnimationFrame(step);
    else { st.hy = st.ty = st.target; st.hv = st.tv = 0; st.shown = st.show; st.raf = 0; st.last = 0; draw(); }
  }

  function sync(jump) {
    const b = current();
    st.show = b ? 1 : 0;
    if (b) st.target = yOf(b);
    if (jump || reduce.matches) {
      st.hy = st.ty = st.target; st.hv = st.tv = 0; st.shown = st.show; draw(); return;
    }
    if (!st.raf) st.raf = requestAnimationFrame(step);
  }

  // 文詳細の欄の開閉と重なる切り替えは、欄と同じバネの進み具合で動かす（連動していないと動きがばらばらに見えたため）。
  // 前は、欄を閉じるときは閉じきってから aria-current が変わるので濃紺が遅れて流れ、開くときは欄と別のバネで動いていた。
  // app.js が欄を動かす前に flow(行き先, "open" | "close") を呼び、motion.js が毎フレーム progress(p) を渡す。
  // 先頭は進み具合の 7割で着き、後ろは2乗で遅れて最後に追いつく。この間は aria-current の書き換えでバネを動かさない
  // armed: 欄の進み具合が動き始めの値（閉じるなら開いた 0、開くなら閉じた 1）にあるのを一度見てから動かす。
  // 欄の仕組みは初めて使うときに一度「開いた状態」に置き直され、その p=0 を開く動きの「着いた」と取り違えて濃紺が跳んでいた
  const drive = { mode: null, from: 0, to: 0, armed: false };
  function flow(name, mode) {
    const b = rail.querySelector(`[data-rail="${name}"]`);
    if (!b || reduce.matches) return;
    cancelAnimationFrame(st.raf); st.raf = 0; st.last = 0;
    drive.mode = mode; drive.from = st.hy; drive.to = st.target = yOf(b); drive.armed = false;
    st.show = 1;
  }
  function progress(p) {
    if (!drive.mode) return;
    if (!drive.armed) { if (Math.abs(p - (drive.mode === "close" ? 0 : 1)) < .02) drive.armed = true; return; }
    const q = Math.min(1, Math.max(0, drive.mode === "close" ? p : 1 - p));
    const lerp = f => drive.from + (drive.to - drive.from) * Math.min(1, Math.max(0, f));
    // 先頭は進み具合の7割で着く手前から行き過ぎ、着く瞬間に戻る（easeOutBack・行き過ぎ 約10%）。後ろは2乗で遅れて最後に追いつく
    const u = Math.min(1, q / .7), back = 1 + 2.70158 * (u - 1) ** 3 + 1.70158 * (u - 1) ** 2;
    st.hy = drive.from + (drive.to - drive.from) * back; st.ty = lerp(q * q); st.hv = st.tv = 0;
    st.shown += (st.show - st.shown) * .3;
    draw();
    if (q >= .999) { drive.mode = null; st.hy = st.ty = st.target; st.shown = st.show; draw(); }
  }
  window.liquid = { flow, progress };

  // --- ホバーの淡い液体 ----------------------------------------------------------
  // アイコン側のホバーも液体にし、本文と同じく速度に応じた動きにする。
  // 今の画面の濃紺とは別の層（.rail-goo.hov・濃紺とアイコンより奥）に、淡い丸い四角を2つ置いて同じフィルターでつなぐ。
  // 乗せたボタンへ先頭が飛び、後ろが遅れてついてくる。マウスの縦の速さ（直近 100ms）の 0.7 倍を先頭の初速として足し、
  // 勢いに応じて先頭の減衰を最大 30% 弱める（本文のホバーと同じ・上限 1000px/秒）。列から外れたら、その場で縮んで消える
  const hovLayer = document.createElement("div");
  hovLayer.className = "rail-goo hov";
  hovLayer.setAttribute("aria-hidden", "true");
  const hHead = document.createElement("i"), hTail = document.createElement("i");
  hovLayer.append(hTail, hHead);
  rail.prepend(hovLayer);
  const HOV_HEAD = { k: 560, c: 30 }, HOV_TAIL = { k: 360, c: 28 };
  const hv = { hy: 0, hv: 0, ty: 0, tv: 0, target: 0, show: 0, shown: 0, raf: 0, last: 0, c: HOV_HEAD.c, at: null };
  function drawHov() {
    const b = rail.querySelector("[data-rail]"), x = b?.offsetLeft ?? 0;
    const thin = Math.max(.62, 1 - Math.abs(hv.hy - hv.ty) / 140);
    hHead.style.transform = `translate(${x}px, ${hv.hy}px) scale(${hv.shown})`;
    hTail.style.transform = `translate(${x}px, ${hv.ty}px) scale(${hv.shown * thin})`;
  }
  function stepHov(t) {
    const dt = Math.min(.032, (t - (hv.last || t)) / 1000) || .016;
    hv.last = t;
    const sub = 4, h = dt / sub;
    for (let i = 0; i < sub; i++) {
      hv.hv += (-HOV_HEAD.k * (hv.hy - hv.target) - hv.c * hv.hv) * h; hv.hy += hv.hv * h;
      hv.tv += (-HOV_TAIL.k * (hv.ty - hv.target) - HOV_TAIL.c * hv.tv) * h; hv.ty += hv.tv * h;
    }
    hv.shown += (hv.show - hv.shown) * Math.min(1, dt * 18);
    drawHov();
    const moving = Math.abs(hv.hy - hv.target) > .3 || Math.abs(hv.ty - hv.target) > .3 || Math.abs(hv.hv) + Math.abs(hv.tv) > 2 || Math.abs(hv.shown - hv.show) > .01;
    if (moving) hv.raf = requestAnimationFrame(stepHov);
    else { hv.hy = hv.ty = hv.target; hv.hv = hv.tv = 0; hv.shown = hv.show; hv.raf = 0; hv.last = 0; drawHov(); }
  }
  const trail = [];
  const note = e => { const t = performance.now(); trail.push([t, e.clientY]); while (trail.length && t - trail[0][0] > 100) trail.shift(); };
  const vy = () => { if (trail.length < 2) return 0; const [t0, y0] = trail[0], [t1, y1] = trail[trail.length - 1]; return t1 - t0 > 4 ? (y1 - y0) / ((t1 - t0) / 1000) : 0; };
  rail.addEventListener("pointermove", note);
  rail.addEventListener("pointerover", e => {
    note(e);
    // ライブラリのボタン（#open-records）は画面を替えないので data-rail を持たないが、ホバーの液体はほかのアイコンと同じに乗せる
    const b = e.target instanceof Element ? e.target.closest("[data-rail], #open-records") : null;
    if (!b || b === hv.at) return;
    hv.at = b;
    const y = yOf(b);
    // 見えていない（出始め）なら、出る場所へ先に置いてから膨らませる（遠くから滑ってこない）
    if (hv.shown < .05 || reduce.matches) { hv.hy = hv.ty = y; hv.hv = hv.tv = 0; }
    hv.target = y; hv.show = 1;
    const fling = Math.max(-1000, Math.min(1000, vy() * 0.7)), down = y > hv.hy;
    const push = fling && (fling > 0) === down && hv.shown >= .05 ? Math.min(1, Math.abs(fling) / 1000) : 0;
    hv.c = HOV_HEAD.c * (1 - 0.3 * push);
    if (push) hv.hv += fling;
    if (reduce.matches) { hv.shown = 1; drawHov(); return; }
    if (!hv.raf) hv.raf = requestAnimationFrame(stepHov);
  });
  rail.addEventListener("pointerleave", () => {
    hv.at = null; hv.show = 0;
    if (reduce.matches) { hv.shown = 0; drawHov(); return; }
    if (!hv.raf) hv.raf = requestAnimationFrame(stepHov);
  });
  drawHov();

  new MutationObserver(() => { if (!drive.mode) sync(false); }).observe(rail, { subtree: true, attributes: true, attributeFilter: ["aria-current"] });
  addEventListener("resize", () => sync(true));
  // アイコンの中身は app.js が後から読み込んで入れる。入ったら白い写しを作るために描き直す
  new MutationObserver(() => draw()).observe(rail, { subtree: true, childList: true });
  // 最初の描画は動かさずに置く（列のボタンが並んでから）
  requestAnimationFrame(() => sync(true));
})();

// --- 大きさの違う項目のあいだを流れる液体（押すと開くメニュー） ------------------------------
// 本文コピーメニューの中身も、他と同じ液体の動きにする。
// アイコンの列と同じく、丸い四角を2つ（先頭と後ろ）置いて #goo でつなぐ。列と違って項目ごとに幅と高さが違うので、
// 位置だけでなく幅と高さもバネで動かす。先頭は硬いバネで飛び、後ろは柔らかいバネで遅れて首を引く。
// 位置は offsetLeft・offsetTop で測る（メニューは出入りのあいだ scale がかかり、画面の座標で測ると縮んだ値になる）。
// layer は動かす項目と同じ位置の基準の要素の中に置く
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  /** layer の中に液体を作り、to(項目) でその項目へ流し、hide() でその場で縮めて消す */
  function pair(layer, { head = { k: 420, c: 26 }, tail = { k: 230, c: 22 } } = {}) {
    const h = document.createElement("i"), t = document.createElement("i");
    layer.append(t, h);
    const K = ["x", "y", "w", "h"], names = [...K.map(k => "h" + k), ...K.map(k => "t" + k), "o"];
    const r = rig(names, { k: head.k, c: head.c, eps: 0.05 }, v => {
      for (const [el, p] of [[h, "h"], [t, "t"]]) {
        // 縮んで消えるときは中心へ寄せる（左上へ縮まない）
        const s = Math.max(0, Math.min(1, v.o));
        el.style.transform = `translate(${v[p + "x"] + v[p + "w"] * (1 - s) / 2}px, ${v[p + "y"] + v[p + "h"] * (1 - s) / 2}px)`;
        el.style.width = `${Math.max(0, v[p + "w"] * s)}px`; el.style.height = `${Math.max(0, v[p + "h"] * s)}px`;
      }
    });
    for (const k of K) r.tune("t" + k, tail.k, tail.c);
    let shown = false;
    return {
      to(el) {
        const box = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
        const target = Object.fromEntries([...K.map(k => ["h" + k, box[k]]), ...K.map(k => ["t" + k, box[k]])]);
        // 見えていないときは、出る場所へ先に置いてから膨らませる（遠くから滑ってこない）
        if (!shown || reduce.matches) r.to({ ...target, o: shown ? 1 : 0 }, { jump: true });
        r.to({ ...target, o: 1 }, { jump: reduce.matches });
        shown = true;
      },
      /** 位置は動かさずに縮めて消す。jump なら即座に（メニューを閉じたあとの片付け） */
      hide(jump = false) { if (shown) r.to({ o: 0 }, { jump: jump || reduce.matches }); shown = false; },
    };
  }

  const mk = (parent, cls) => { const l = document.createElement("div"); l.className = `menu-goo ${cls}`; l.setAttribute("aria-hidden", "true"); parent.prepend(l); return l; };
  // ライブラリの行も同じ液体で流すので、app.js から使えるようにする（app.js はこのファイルより先に読まれるので、開くときに取りに来る）
  window.liquid = Object.assign(window.liquid || {}, { pair, layer: mk });
  // 押すと開くメニュー（.pop）すべてに、ホバーとキーボードのフォーカスで淡い液体を流す（本文コピー・起点の回の一覧）。
  // 中身を描き直すメニューも、液体の層はメニューの直下に残るので作り直さない
  for (const menu of document.querySelectorAll(".pop")) {
    const hov = pair(mk(menu, "hov"), { head: { k: 560, c: 30 }, tail: { k: 360, c: 28 } });
    const flavor = menu.querySelector(".flavor");
    const target = e => e.target instanceof Element ? e.target.closest("button")?.closest(".pop") === menu ? e.target.closest("button:not(:disabled)") : null : null;
    // 方言のボタンは .flavor の中なので、位置は .flavor の分を足して測る
    const move = b => {
      if (!b) return;
      if (flavor && b.parentElement === flavor) hov.to({ offsetLeft: flavor.offsetLeft + b.offsetLeft, offsetTop: flavor.offsetTop + b.offsetTop, offsetWidth: b.offsetWidth, offsetHeight: b.offsetHeight });
      else hov.to(b);
    };
    menu.addEventListener("pointerover", e => move(target(e)));
    menu.addEventListener("pointerleave", () => hov.hide());
    menu.addEventListener("focusin", e => { const b = target(e); if (b?.matches(":focus-visible")) move(b); });
    new MutationObserver(() => { if (menu.hidden) hov.hide(true); }).observe(menu, { attributes: true, attributeFilter: ["hidden"] });
    if (!flavor) continue;
    // 本文コピーの方言: 選んだ方言の濃紺を aria-checked の書き換えを見張って流す（app.js の作りには手を入れない）
    const sel = pair(mk(flavor, "sel"));
    const checked = () => flavor.querySelector('[aria-checked="true"]');
    new MutationObserver(() => { const b = checked(); if (b && !menu.hidden) sel.to(b); })
      .observe(flavor, { subtree: true, attributes: true, attributeFilter: ["aria-checked"] });
    // メニューが開いたら、濃紺を今の方言へ置く（閉じている間は大きさが測れない）
    new MutationObserver(() => {
      if (menu.hidden) { sel.hide(true); return; }
      const b = checked(); if (b) { sel.hide(true); sel.to(b); }
    }).observe(menu, { attributes: true, attributeFilter: ["hidden"] });
  }
})();

// --- 見方の切り替え（重要度と変更の、ハイライト・フィルター） ------------------------------
// メニューと同じ pair で、ホバーには淡い面、押している方には白いカードを液体で流す。
// app.js が aria-pressed を書き換えるのを見張って動かすので、app.js の作りには手を入れない
for (const box of document.querySelectorAll(".mode-toggle")) (() => {
  if (!window.liquid?.pair) return;
  const { pair, layer } = window.liquid;
  // layer は先頭へ足すので、先に作った選択の層が手前、あとのホバーの層が奥になる
  const sel = pair(layer(box, "mode-sel"));
  const hov = pair(layer(box, "mode-hov"), { head: { k: 560, c: 30 }, tail: { k: 360, c: 28 } });
  box.classList.add("lq");   // 液体が描くので、押している方のボタン自身の白い面は消す（CSS）
  const pressed = () => box.querySelector('[aria-pressed="true"]');
  // 押している方の上では淡い面を出さない（白いカードの下に淡い面が透けて二重に見えるため）
  const hover = b => { if (b && b !== pressed()) hov.to(b); else hov.hide(); };
  box.addEventListener("pointerover", e => hover(e.target instanceof Element ? e.target.closest(".mbtn") : null));
  box.addEventListener("pointerleave", () => hov.hide());
  box.addEventListener("focusin", e => { const b = e.target.closest?.(".mbtn"); if (b?.matches(":focus-visible")) hover(b); });
  new MutationObserver(() => { const b = pressed(); if (b) { sel.to(b); hov.hide(); } })
    .observe(box, { subtree: true, attributes: true, attributeFilter: ["aria-pressed"] });
  // 最初は動かさずに置く（ボタンの大きさが決まってから）
  requestAnimationFrame(() => { const b = pressed(); if (b) sel.to(b); });
})();
