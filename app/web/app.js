// tsuzuri の閲覧アプリの動き。サーバー（app/server.py）の /api/doc を読み、ユーザーのコメントだけを /api/comments に送る。
// 画面の状態は st に1つだけ持ち、変わるたびに描き直す（約500文までを想定。描き直しで足りる量）。
"use strict";

// 働きの項目。記録の tags の鍵 → 画面の熟語とアイコン
const FIELDS = [
  ["role", "役割", "drama"], ["relation", "接続", "link-2"], ["importance", "重要度", "circle-dot"],
  ["technique", "工夫", "pen-tool"], ["place", "対応要件", "target"],
];
// 文機能を一続きの文で読ませる（表にすると抽象的になりすぎて分かりにくかったので、表をやめた）。
// 言い回しは references/tag-vocabulary.md の各語の定義を平たく言い直したもの。語そのものは押すと出るカード（title）に残す。
// 項目ごとに押せて、押すとその項目がコメントの宛先になる（コメントの to は今までどおり 役割/接続/重要度/工夫/対応要件）
const RELATION_SAY = {
  順接: "前の文を受けてその帰結を述べ", 逆接: "前の文と反対のことを述べ", 添加: "前の文に情報を追加して",
  対比: "前の文と比較して異なる面を述べ", 転換: "前の文から話題を転換し", 同列: "前の文を別の言い方で重ね",
  補足: "前の文を補って", 連鎖: "前の文から接続語なしでそのまま続き", 段落の始まり: "段落を始めていて", 関係なし: "段落を始めていて",
};
// 重要度は RST の核・衛星（専門用語なので言い換えない）
const IMPORTANCE_SAY = { 核: "消すと言いたいことが崩れる文", 衛星: "核を支える文。消しても言いたいことは残る" };
const IMP_KEY = { 核: "core", 衛星: "sub" };
const TECHNIQUE_SAY = {
  関係の明示: "頭でつながりを示し", 否定の根拠: "否定に根拠を付し", 対比定義: "述部を統一して相違を際立たせ",
  譲歩: "相手の言い分を事実として認め", 命題の書き出し: "否定する命題を先に提示し", 誤解の先回り: "誤った解釈を先に否定し",
  シャレード: "感情を動作で示し", 描写: "様子を描き", 記号での回収: "描写したものを言葉で集約し",
  フォーカスの予告: "視点を移動する前にその人物を外から描写し", 五感: "五感で描き", 欠落を書く: "無いものを描写し", 文長を揺らす: "文長に緩急をつけ",
};

/** 文機能の1つの項目。押すとその項目（to）へ「違う」と書き込む先にする。語そのものは title に出す */
function clause(to, term, text) {
  const on = st.draftTo === to;
  // ボタン要素だと項目ごとに箱になって行が折れるので、文の中を流れる span にし、role と tabindex で押せるようにする（Enter・Space は keydown で拾う）
  return `<span class="clause" role="button" tabindex="0" data-to="${to}" aria-pressed="${on}" data-hint="${to}：${esc(term)}。押すと、この要素を対象にコメントできる">${esc(text)}</span>`;
}

/** 重要度のチップ。役割のチップと同じく押すとコメントの宛先になり、乗せると意味が出る */
function impChip(imp) {
  if (!imp) return "";
  const k = IMP_KEY[imp];
  return `<span class="clause imp" role="button" tabindex="0" data-to="重要度" aria-pressed="${st.draftTo === "重要度"}" data-hint="重要度：${esc(imp)}。${esc(IMPORTANCE_SAY[imp] ?? "")}。押すと、この要素を対象にコメントできる" style="--k:${k ? `var(--imp-${k})` : "var(--icon)"}">${k ? ic(`imp-${k}`, "ic mark") : ""}${esc(imp)}</span>`;
}

/** 文機能の欄の中身。役割と重要度を見出しに、残りの3つを2文の説明にする */
function funcProse(v) {
  const t = v.tags, role = [].concat(t.role ?? []), rel = [].concat(t.relation ?? [])[0], imp = [].concat(t.importance ?? [])[0];
  const tech = [].concat(t.technique ?? []), place = [].concat(t.place ?? [])[0];
  const k = ROLE_KEY[role[0]];
  const head = `<p class="func-role"><span class="clause role" role="button" tabindex="0" data-to="役割" aria-pressed="${st.draftTo === "役割"}" data-hint="役割。押すと、この要素を対象にコメントできる" style="--k:${k ? `var(--role-${k})` : "var(--icon)"}">${k ? ic(`role-${k}`, "ic mark") : ""}${esc(role[0] || "役割なし")}${role.slice(1).map(r => `<span class="sub-role" style="--k:${ROLE_KEY[r] ? `var(--role-${ROLE_KEY[r]})` : "var(--icon)"}">${ROLE_KEY[r] ? ic(`role-${ROLE_KEY[r]}`, "ic mark") : ""}${esc(r)}</span>`).join("")}</span>${impChip(imp)}</p>`;
  // 重要度は説明文から外して、役割の横のチップで名乗る（詳細パネルにも重要度を出すため）
  const one = [rel && clause("接続", rel, RELATION_SAY[rel] ?? `前の文と「${rel}」の関係で`)].filter(Boolean);
  const techs = tech.map(x => TECHNIQUE_SAY[x] ?? `「${x}」を使い`).join("、");
  const two = [tech.length && clause("工夫", tech.join("・"), techs), place && clause("対応要件", place, `要件の「${place}」を満たす`)].filter(Boolean);
  // 重要度をチップへ移したあと、接続の項目（「〜ていて」）だけで文を切ると「段落を始めていて。」と途切れた。
  // 接続・工夫・対応要件の項目を1文につなぐ
  const all = [...one, ...two], prose = all.length ? `${all.join("、")}。` : "";
  // 「違うと書き込む」ボタンは置かない。項目を押せばコメントの宛先になる
  return `${head}<p class="func">${prose}</p>`;
}

// 文章構造の色。意見は暖色・事実は寒色（tokens.css の --role-*）。小説の役割など語彙の外は無彩で塗る
const ROLES = [["意見", [["主張", "claim"], ["評価", "evaluation"], ["理由", "reason"]]],
               ["事実", [["根拠", "evidence"], ["解説", "explanation"], ["報告", "report"]]]];
const ROLE_KEY = Object.fromEntries(ROLES.flatMap(([, rs]) => rs));
// 右の印はコメントだけで、ユーザーのコメントと AI のコメントの2色（出どころが分かれば足りるため）。AI のコメントは、スキルの見直しの指摘（reviews/）と、
// 書く前のメモから文がずれた理由（deviation）。人が書いた文の印（自筆）はコメントではないので外した。1文に両方あるときはユーザーを先に塗る
const NOTES = [["user", "ユーザー"], ["ai", "AI"]];
// 重要度の鍵と画面の名前
const IMPS = [["core", "核"], ["sub", "衛星"]];
const ICON_NAMES = ["list-tree", "highlighter", "pilcrow", "messages-square", "flag", "panel-right-open",
  "panel-right-close", "file-text", "x", "lightbulb", "arrow-right-left", "tags", "message-square", "message-square-x",
  "clipboard-list", "history", "chevron-right", "chevron-left", "drama", "link-2", "circle-dot", "pen-tool", "target", "book-open", "trash-2",
  "design-doc", "keyboard", "role-claim", "role-evaluation", "role-reason", "role-evidence", "role-explanation", "role-report", "note-user", "note-ai", "imp-core", "imp-sub", "copy", "diff", "diff-mark", "diff-only", "records", "check", "message-open", "template", "dictionary", "tsz-open", "library"];

// 文章構造は左の印、注記は右の印で、いつも両方出す（両方を同時に出せるので、切り替えは要らない）
// imp: 道具の欄の重要度で押した方（core・sub）。押した方の文だけ濃く残し、もう一方を薄くする
// impMode: 重要度の見方。mark はもう一方を薄くし、only はもう一方の文を本文から外す（見出しの右のアイコンで切り替える）
const st = { doc: null, sel: null, viewVer: null, struct: true, note: true, closed: false, panel: "detail", draftTo: null, imp: null, impMode: "mark",
  // texts: 要件定義書と設計書の本文（r001・d001 をキーに）。docVer: 全文の画面で開いているバージョン（null なら最新）。reveal: 全文の画面で送る先の要素の id
  texts: {}, docVer: { requirements: null, design: null }, reveal: null,
  // docSel: 文書の画面（真ん中の要件定義書・設計書）で選んだ項目か段落の key（docItems）
  docSel: null,
  // diff: 本文の見方（off＝本文・mark＝変更のハイライト・only＝変更のフィルター）。diffMode: 見出しの右で選んだ見方。
  // 「変更箇所」の行を押すと、off と diffMode のあいだで切り替わる。round: 起点にする直しの回（1 が直近）
  diff: "off", diffMode: "mark", round: 1,
  // roundPage: 起点の回の一覧で開いているページ（0 から）
  roundPage: 0,
  // drafts: 文ごとの書きかけのコメント（別の文へ移っても消さない）。focusInput: 中身の入れ替えのあとにコメント欄へフォーカスする
  drafts: {}, focusInput: false,
  // openOnly: コメント一覧で未解決だけを出す。画面を見る人の手元に覚える
  openOnly: (() => { try { return localStorage.getItem("tsuzuri-open-only") === "on"; } catch { return false; } })() };
const icons = {};
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ic = (name, cls = "ic") => `<span class="${cls}" aria-hidden="true">${icons[name] || ""}</span>`;

async function loadIcons() {
  await Promise.all(ICON_NAMES.map(async n => { const r = await fetch(`/icons/${n}.svg`); if (r.ok) icons[n] = await r.text(); }));
  document.querySelectorAll("[data-ic]").forEach(el => { el.innerHTML = icons[el.dataset.ic] || ""; el.setAttribute("aria-hidden", "true"); });
}

async function loadDoc() {
  const r = await fetch("/api/doc");
  const body = await r.json();
  if (!r.ok) throw Object.assign(new Error(body.error || "読み込めませんでした"), { noRecord: !!body.no_record });
  st.doc = body;
  // 文詳細の切り出しは文ごとに照らしたバージョンを使うので、要件定義書と設計書は全部のバージョンを読んでおく（読めなければ切り出しを出さない）
  const texts = {};
  await Promise.all([...body.requirements.map(id => ["req", id]), ...(body.designs ?? []).map(id => ["design", id])].map(async ([kind, id]) => {
    const q = await fetch(`/api/${kind}/${encodeURIComponent(id)}`);
    if (q.ok) texts[id] = (await q.json()).text;
  }));
  st.texts = texts;
}

// --- 文の性質 -------------------------------------------------------------
const latest = s => s.versions[s.versions.length - 1];
/** バージョン履歴に出すタイトル。タイトルの無い最初のバージョンは「初稿」、タイトルを持たない古い記録は空にする */
const verTitle = (s, x) => x.title || (x === s.versions[0] ? "初稿" : "");
/** 選んだ文は履歴で指定したバージョンを返し、ほかの文は最新を返す。 */
const viewed = s => s.sid === st.sel ? s.versions.find(v => v.ver === st.viewVer) ?? latest(s) : latest(s);
const isBlock = s => s.kind === "block";
const BLOCK_LABEL = { heading: "見出し", code: "コード", image: "画像", table: "表", note: "注記の箱", list: "箇条書き", quote: "引用", footnote: "脚注" };
const NOTE_LABEL = { info: "情報", warn: "注意", alert: "警告" };
const blockLabel = b => BLOCK_LABEL[b.kind] || "ブロック";
// --- 差分（直した所だけを見られるようにする）-------------------
// 書き手が続けて書いた変更を「直しの回」にまとめ、直近の何回分を見るかを切り替える。回は書いた時刻（written_at・ナノ秒）が
// 10分以上あいたら分ける。C3 では、コメントでの直し（9件・約1分）と、あとで目次を直した1件（15分後）が別の回になった
const ROUND_GAP = 10 * 60 * 1e9;
/** 直しの回の始まりの時刻を、新しい順に返す */
function rounds() {
  const ts = st.doc.sentences.flatMap(s => s.versions.map(v => v.written_at).filter(Boolean)).sort((a, b) => a - b);
  const starts = [];
  for (let i = 0; i < ts.length; i++) if (!i || ts[i] - ts[i - 1] > ROUND_GAP) starts.push(ts[i]);
  return starts.reverse();
}
/** 起点（選んだ回の始まり）。回が足りなければ一番古い回 */
const diffBase = () => { const r = rounds(); return r[Math.min(st.round, r.length) - 1] ?? Infinity; };
/**
 * 文かブロックの、起点からの変化。起点より後に書いたバージョンが無ければ null。
 * kind は new（起点より前のバージョンが無い）・rewrite（字が変わった）・intent（字は同じで執筆意図が変わった）・tags（札だけ）
 */
function changeOf(s, base = diffBase()) {
  const cur = latest(s);
  if (!cur.written_at || cur.written_at < base) return null;
  const before = [...s.versions].reverse().find(v => v.written_at && v.written_at < base) ?? null;
  const kind = !before ? "new" : before.text !== cur.text ? "rewrite" : before.memo !== cur.memo ? "intent" : "tags";
  return { kind, before, cur };
}
const CHANGE_LABEL = { new: "新しい文", rewrite: "修正", intent: "執筆意図だけ", tags: "文機能だけ" };
/**
 * 2つの文字列の字の差分を、消えた字は <del>・足した字は <ins> の HTML にする（最長共通部分列）。
 * 文は長くても数百字なので表で解く。表が大きすぎる（コードのブロックなど）ときは、全体を消して全体を足した形にする
 */
function charDiff(a, b) {
  const x = Array.from(String(a ?? "")), y = Array.from(String(b ?? ""));
  if (x.length * y.length > 400000) return `<del>${esc(a)}</del><ins>${esc(b)}</ins>`;
  const n = x.length, m = y.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  const push = (k, c) => { const last = out.at(-1); if (last && last.k === k) last.s += c; else out.push({ k, s: c }); };
  while (i < n && j < m) {
    if (x[i] === y[j]) { push("=", x[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) push("-", x[i++]); else push("+", y[j++]);
  }
  while (i < n) push("-", x[i++]);
  while (j < m) push("+", y[j++]);
  // 共通の字が長いほうの半分に満たない文は、書き直しとして前の文を丸ごと消し、今の文を丸ごと足す。
  // 字ごとに混ぜると、偶然そろった「を」「の」だけが残って読めなかった（C3 の s0011 で画面で確かめた）
  if (L[0][0] < Math.max(n, m) / 2) return `<del>${esc(a)}</del><br><ins>${esc(b)}</ins>`;
  // 変わった所に挟まれた2字以下の共通部分は、消した側と足した側の両方に含めて、細切れの印を減らす。
  // 続く変更は「消した字をまとめて先に、足した字をまとめて後に」の1組にする
  const merged = []; let dels = "", inss = "";
  const flush = () => { if (dels) merged.push({ k: "-", s: dels }); if (inss) merged.push({ k: "+", s: inss }); dels = inss = ""; };
  out.forEach((p, k) => {
    const short = p.k === "=" && Array.from(p.s).length <= 2 && k > 0 && k < out.length - 1;
    if (p.k === "=" && !short) { flush(); merged.push(p); }
    else if (short) { dels += p.s; inss += p.s; }
    else if (p.k === "-") dels += p.s; else inss += p.s;
  });
  flush();
  return merged.map(p => p.k === "=" ? esc(p.s) : p.k === "-" ? `<del>${esc(p.s)}</del>` : `<ins>${esc(p.s)}</ins>`).join("");
}
/** 差分を見ているとき、文詳細に起点の前からの執筆意図の変化を出す（最新のバージョンを見ているときだけ） */
function intentDiff(s, v) {
  const c = st.diff !== "off" ? changeOf(s) : null;
  if (!c?.before || v !== c.cur || c.before.memo === c.cur.memo) return "";
  return `<div class="dev intent-diff"><h4 class="k">${ic("history")}執筆意図の変化（${esc(c.before.ver)} → ${esc(c.cur.ver)}）</h4><p class="memo">${charDiff(c.before.memo, c.cur.memo)}</p></div>`;
}
/** 本文の文の中身。変更のハイライトのときは、書き換えた文を字の差分で描き、新しい文は丸ごと足した字にする */
function inText(s) {
  if (viewed(s) !== latest(s)) return mdInline(viewed(s).text);
  const c = st.diff === "mark" ? changeOf(s) : null;
  if (c?.kind === "rewrite") return charDiff(c.before.text, c.cur.text);
  if (c?.kind === "new") return `<ins>${mdInline(c.cur.text)}</ins>`;
  return mdInline(latest(s).text);
}
/**
 * 文書の画面の差分（要件定義書と設計書の差分も文書の画面で見られるようにする）。
 * 要件定義書と設計書は書いた時刻を持たないので、起点は直しの回でなくバージョンにする。直近 n 回＝n 個前のバージョンと比べる。
 * 項目は番号（設計書は段落の id）で前のバージョンと突き合わせる
 */
function docDiff(view, want = st.round) {
  const cur = docItems(view);
  const k = cur.ids.indexOf(cur.id), n = Math.min(want, k);
  if (n < 1) return { base: null, n: 0, max: Math.max(0, k), changes: new Map(), removed: [] };
  const base = docItems(view, cur.ids[k - n]);
  const old = new Map(base.items.map(i => [i.match, i]));
  const changes = new Map();
  for (const i of cur.items) {
    const b = old.get(i.match);
    if (!b) changes.set(i.key, { kind: "new" });
    else if (b.title !== i.title || b.body !== i.body) changes.set(i.key, { kind: "rewrite", before: b });
  }
  const now = new Set(cur.items.map(i => i.match));
  return { base: base.id, n, max: k, changes, removed: base.items.filter(i => !now.has(i.match)) };
}
/** 文書の項目の見出しと本文を、差分つきの HTML にする。本文は Markdown を描かずに字の差分のまま出す（行は保つ） */
function docItemHTML(i, c, unit) {
  const tag = c ? `<span class="tag tag-${c.kind}">${c.kind === "new" ? `新しい${unit}` : c.kind === "removed" ? `削除した${unit}` : "修正"}</span>` : "";
  const title = c?.kind === "rewrite" ? charDiff(c.before.title, i.title) : c?.kind === "new" ? `<ins>${esc(i.title)}</ins>` : c?.kind === "removed" ? `<del>${esc(i.title)}</del>` : esc(i.title);
  const body = c?.kind === "rewrite" ? `<div class="md md-diff">${charDiff(c.before.body, i.body)}</div>`
    : c?.kind === "new" ? `<div class="md md-diff"><ins>${esc(i.body)}</ins></div>`
    : c?.kind === "removed" ? `<div class="md md-diff"><del>${esc(i.body)}</del></div>`
    : i.body ? `<div class="md">${mdLite(i.body)}</div>` : "";
  return { tag, title, body };
}
/**
 * 起点の回の一覧の行。本文では直しの回ごとに、その回に書いた文とブロックの数と、最初に変わった所を出す。
 * 文書の画面では回の代わりに、比べる前のバージョンを並べる。n は選んだときの st.round
 */
function roundRows() {
  const fmt = ns => new Date(ns / 1e6).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  if (DOC_VIEW[st.panel]) {
    const max = docDiff(st.panel).max;
    return Array.from({ length: max }, (_, i) => {
      const dd = docDiff(st.panel, i + 1), first = docItems(st.panel).items.find(x => dd.changes.has(x.key));
      const count = dd.changes.size + dd.removed.length;
      return { n: i + 1, label: `${dd.base} と比べる`, count, sub: first ? `${first.title}${count > 1 ? ` ほか ${count - 1}件` : ""}` : "変更なし" };
    });
  }
  const starts = rounds();
  return starts.map((start, i) => {
    const end = i ? starts[i - 1] : Infinity;
    const units = st.doc.sentences.filter(s => s.versions.some(v => v.written_at >= start && v.written_at < end));
    const first = units[0], where = first ? (isBlock(first) ? blockLabel(first.block) : position(first.sid)) : "";
    return { n: i + 1, label: fmt(start), count: units.length,
      sub: i === starts.length - 1 && units.length && units.every(s => s.versions[0].written_at >= start) ? "初稿" : first ? `${where}${units.length > 1 ? ` ほか ${units.length - 1}件` : ""}` : "" };
  });
}
// 1ページの回の数。8 だとメニューが約 460px になり、道具の欄の中ほどから開くと画面の下へはみ出した
const ROUND_PAGE = 5;
/** 起点の回の一覧を、開いているページの分だけ描く。メニューの中の液体の層は残し、中の箱だけを差し替える */
function renderRoundList() {
  const rows = roundRows(), pages = Math.max(1, Math.ceil(rows.length / ROUND_PAGE));
  st.roundPage = Math.max(0, Math.min(pages - 1, st.roundPage));
  const cur = Math.min(st.round, rows.length);
  const shown = rows.slice(st.roundPage * ROUND_PAGE, (st.roundPage + 1) * ROUND_PAGE);
  $("round-list").innerHTML = shown.map(r => `<button type="button" class="row" role="menuitemradio" aria-checked="${r.n === cur}" data-pick-round="${r.n}">
      <span class="no">${r.n}</span><span>${esc(r.label)}</span><span class="cnt">${r.count}件</span><span class="sub">${esc(r.sub)}</span></button>`).join("")
    + (pages > 1 ? `<div class="pager"><button type="button" data-round-page="-1" aria-label="前のページ"${st.roundPage ? "" : " disabled"}>‹</button>
      <span>${st.roundPage + 1} / ${pages}</span><button type="button" data-round-page="1" aria-label="次のページ"${st.roundPage < pages - 1 ? "" : " disabled"}>›</button></div>` : "");
}

/** さかのぼれる回の数。文書の画面では、今のバージョンより前のバージョンの数 */
const roundMax = () => DOC_VIEW[st.panel] ? docDiff(st.panel).max : rounds().length;
/**
 * 道具の欄の「変更」の節（本文の上に常駐すると目障りで、字だけで要素を示すのも分かりにくかったため、道具の欄に節として置く）。
 * 文章構造・コメント・重要度と同じく「本文をどう見るか」の道具なので、同じ行の形（アイコン・名前・件数）にする。
 * 行を押すとその見方に入り、もう一度押すと本文に戻る。起点の回は節の見出しの ‹ ›
 */
function renderDiffSide() {
  // 文書の画面では、起点を直しの回でなく文書のバージョンにする（docDiff）
  const dd = DOC_VIEW[st.panel] ? docDiff(st.panel) : null;
  const r = dd ? Array.from({ length: dd.max }) : rounds(), n = dd ? dd.n : Math.min(st.round, r.length || 1);
  const count = dd ? dd.changes.size + dd.removed.length : st.doc.sentences.filter(s => changeOf(s)).length;
  const when = dd ? (dd.base ?? "")
    : r[n - 1] ? new Date(r[n - 1] / 1e6).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  // 起点の回（‹ 直近N回 ▾ ›）は、行のカードの下の段に起点の時刻と並べる。見出しに置くと、見方の切り替えと並んで幅が足りず右へはみ出した。
  // 時刻は「〜からの変更」だと下の段でも「直近N回」が折り返し、「〜から」でも節の幅を超えたので、「11/19 12:35〜」に縮めた（変更の節の中なので何の起点かは分かる）
  const roundsHTML = r.length ? `<button type="button" class="rbtn" data-round="1" aria-label="ひとつ前の回までさかのぼる"${n >= r.length ? " disabled" : ""}>‹</button>
    <button type="button" class="r" id="round-btn" aria-haspopup="menu" aria-controls="round-menu" aria-expanded="${!$("round-menu").hidden && $("round-menu").classList.contains("on")}" data-hint="起点の回を一覧から選ぶ">直近${n}回 ▾</button>
    <button type="button" class="rbtn" data-round="-1" aria-label="新しい回へ戻る"${n <= 1 ? " disabled" : ""}>›</button>` : "";
  // 重要度の節と同じ形にそろえた。見方（ハイライト・フィルター）は見出しの右のアイコンで選び、行は「変更箇所」の1つだけで、押すと見方を当てる・外す
  // （前は「変更をハイライト」「差分だけ」の2行を縦に並べていた）
  setHTML($("legend-diff"), `<button type="button" class="key" data-diff-row aria-pressed="${st.diff !== "off"}" aria-disabled="${!count}" style="--k: var(--navy)"><span class="w">${ic("diff", "ic mark")}変更箇所</span><span class="n"><b>${count}</b><i>件</i></span></button>`
    + (when || roundsHTML ? `<div class="diff-foot"><p class="since">${when ? `${esc(when)}〜` : ""}</p><span class="rounds">${roundsHTML}</span></div>` : ""));
  document.querySelectorAll("[data-diff-mode]").forEach(b => b.setAttribute("aria-pressed", String(st.diffMode === b.dataset.diffMode)));
}
/** 変更のフィルター: 変わった文とブロックを記事の順に並べ、字の差分を描く。文は .s にして、選ぶと文詳細が開く */
function renderDiffOnly() {
  const rows = st.doc.sentences.map(s => [s, changeOf(s)]).filter(([, c]) => c).map(([s, c]) => {
    const where = isBlock(s) ? blockLabel(s.block) : position(s.sid);
    const vers = c.before ? `${esc(c.before.ver)} → ${esc(c.cur.ver)}` : esc(c.cur.ver);
    const body = c.kind === "rewrite" ? charDiff(c.before.text, c.cur.text) : c.kind === "new" ? `<ins>${esc(c.cur.text)}</ins>` : mdInline(c.cur.text);
    return `<div class="dif"><div class="dif-h"><span>${esc(where)}</span><span class="tag tag-${c.kind}">${CHANGE_LABEL[c.kind]}</span><span class="v">${vers}</span></div>
      <span class="s" id="s-${s.sid}" data-sid="${s.sid}" tabindex="0" role="button" aria-current="false" style="--k:var(--g-paper)"><span class="in">${body}</span></span></div>`;
  });
  setHTML($("text"), rows.length ? rows.join("") : `<p class="empty">この回からの変更は無い。‹ で前の回までさかのぼれる。</p>`);
  if (st.sel) $(`s-${st.sel}`)?.setAttribute("aria-current", "true");
}

/**
 * 文の中の Markdown（太字・行内のコード・リンク・脚注の呼び出し）を描く。先に esc してから置き換えるので、文の中の HTML はそのまま字で出る。
 * 重要度は太さでなく「核だけを見る」ときの薄さで見せるので、太字と重ならない。
 * リンクは押しても移らない字にする。本文の文は押すと選ぶので、リンクで別の場所へ飛ぶと選ぶ操作とぶつかる
 */
function mdInline(text) {
  return balanceTags(obsidian(allowTags(esc(text)))
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[\^([^\]\s]+)\](?!:)/g, '<sup class="fn-ref">$1</sup>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<span class="md-link">$1</span>'));
}
/**
 * 文の中の HTML のうち、決まった形のタグだけを効かせる（文字の色の span・斜体と太字・改行）。esc したあとの字から戻すので、
 * ここに無い形のタグや属性は今までどおり字のまま出る。色は # と16進数か英字だけの色の名前を受け、ほかの値（url() や式）は通さない。
 * 歌詞の色分けを span の色で書いた構想の文書が、タグの字だらけで読めなかった。
 * 色はそのまま使わず、明るさに上限を付けて不透明にする（oklch の相対色）。transparent・white・紙と同じ色で、画面には見えないのに
 * 記録と AI には読める字を作れたため（Carbon のセキュリティレビューの指摘）。開きと閉じの数は balanceTags が合わせる
 */
const TAG_DECL = "(?:color:(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})|white-space:nowrap)";
const SPAN_OPEN = new RegExp(`&lt;span style=&quot;(${TAG_DECL}(?:;${TAG_DECL})*);?&quot;&gt;`, "g");
function allowTags(escaped) {
  return escaped
    .replace(SPAN_OPEN, (_, decl) => { const c = decl.match(/color:(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})/); return c ? `<span style="color:oklch(from ${c[1]} min(l, 0.72) c h / 1)">` : "<span>"; })
    .replace(/&lt;\/span&gt;/g, "</span>")
    .replace(/&lt;(\/?)(i|b|em|strong)&gt;/g, "<$1$2>")
    .replace(/&lt;br\s*\/?&gt;/g, "<br>");
}
/**
 * mdInline の出力のタグの開きと閉じを1組ずつ合わせる。開きの無い閉じは捨て、閉じの無い開きは末尾で閉じ、入れ子の順が違えば内側から閉じる。
 * 文は <span class="s"><span class="in"> で包むので、閉じの無い span や余分な </span> があると、文の枠が途中で閉じたり後ろの文を取り込んだりした。
 * 閉じの無い i・b・em・strong は、ブラウザが後ろの段落で作り直して文書の終わりまで書体が移る（Carbon のセキュリティレビューの指摘）
 */
const BALANCED = /<(\/?)(span|i|b|em|strong|code|sup|mark)\b[^>]*>/g;
function balanceTags(html) {
  const stack = [];
  const out = html.replace(BALANCED, (tag, close, name) => {
    if (!close) { stack.push(name); return tag; }
    const at = stack.lastIndexOf(name);
    if (at < 0) return "";
    return stack.splice(at).reverse().map(n => `</${n}>`).join("");
  });
  return out + stack.reverse().map(n => `</${n}>`).join("");
}
/**
 * Obsidian の方言のうち、見出しへのリンク [[#見出し|表示名]] と ハイライト ==字== を描く。リンクは押しても移らない字（md-link）にし、
 * 表示名が無ければ見出しの名前を出す。リンクを先に処理する（見出しの名前の中の == をハイライトにしないため）。
 * ハイライトの頭に色の絵文字（🔴🔵🟠🟢🟡🟣）があれば、その色の蛍光ペンにする（曲の構想が声ごとの色を絵文字で書いていた）
 */
const HL_COLORS = { "🔴": "red", "🔵": "blue", "🟠": "orange", "🟢": "green", "🟡": "yellow", "🟣": "purple" };
function obsidian(html) {
  return html
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '<span class="md-link">$2</span>')
    .replace(/\[\[#?([^\]]+)\]\]/g, '<span class="md-link">$1</span>')
    // == のすぐ内側が空白のものは拾わない（コードの a == b を、間の字ごとハイライトにしないため）
    .replace(/==(?=\S)([^=]+?)(?<=\S)==/g, (_, inner) => {
      const color = HL_COLORS[[...inner][0]];
      return `<mark class="md-hl${color ? ` md-hl-${color}` : ""}">${inner}</mark>`;
    });
}
/** 目次やカードの説明のように、装飾なしの字で出す所のために、タグと太字の記号を外す */
const plainText = text => String(text ?? "").replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1").replace(/\[\[#?([^\]]+)\]\]/g, "$1")
  .replace(/<[^>]*>/g, "").replace(/\*\*|==/g, "");
/**
 * 画像のブロックの本文（Markdown の ![代替](パス) か HTML の <img>・<picture>）から画像を描く。画像が1つも無ければ null を返し、呼ぶ側は元の文字のまま出す。
 * 文書のフォルダからの相対パスはサーバーの /api/image から読む。<picture> は明るい画面に合う <img> の src を使う（暗い画面用の source は読まない）。
 * 外部の URL は読み込まず、URL を字で出す。読みに行くと、文章を開いたことが画像の置き場の持ち主に伝わるため
 */
const IMAGE_TEXT_MAX = 20000, IMAGE_COUNT_MAX = 32;
function imageBlock(md) {
  // 人から受け取った記録の本文は長さも中身も信じない。長すぎる本文と多すぎる画像は描かず、元の字のまま出す
  if (md.length > IMAGE_TEXT_MAX) return null;
  const found = [];
  for (const m of md.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) found.push({ alt: m[1], src: m[2] });
  // <img の後ろは次の > までを indexOf で切り出す。正規表現で探すと、閉じない <img が続く本文で走査が文字数の2乗に伸びる
  const lower = md.toLowerCase();
  for (let at = lower.indexOf("<img"); at !== -1; at = lower.indexOf("<img", at + 4)) {
    const end = md.indexOf(">", at);
    if (end === -1) break;
    const tag = md.slice(at, end + 1);
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i), alt = tag.match(/\balt\s*=\s*["']([^"']*)["']/i);
    const width = tag.match(/\bwidth\s*=\s*["']?(\d{1,4})["']?/i);
    if (src) found.push({ alt: alt ? alt[1] : "", src: src[1].trim(), width: width ? Number(width[1]) : null });
  }
  if (!found.length || found.length > IMAGE_COUNT_MAX) return null;
  return found.map(({ alt, src, width }) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) {
      return `<p class="img-ext">外部の画像は読み込みません: <span>${esc(src)}</span>${alt ? `（${esc(alt)}）` : ""}</p>`;
    }
    const size = width ? ` style="width:min(100%, ${width}px)"` : "";
    return `<img src="/api/image?src=${encodeURIComponent(src)}" alt="${esc(alt)}" loading="lazy"${size}>`;
  }).join("");
}
/**
 * 表のブロックの Markdown（GFM の表）を <table> にする。2行目が区切りの行でなければ null を返し、呼ぶ側は元の文字のまま出す。
 * セルの中は文と同じく mdInline を通す（強調・コード・決まった形のタグ）。前は字のまま出していて、色分けした歌詞の表がタグの字で埋まった
 */
function mdTable(md) {
  const rows = md.trim().split("\n").map(line => line.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()));
  if (rows.length < 2 || !rows[1].every(c => /^:?-+:?$/.test(c))) return null;
  const align = rows[1].map(c => c.endsWith(":") ? (c.startsWith(":") ? "center" : "right") : "left");
  const cell = (tag, c, i) => `<${tag} style="text-align:${align[i] || "left"}">${mdInline(c)}</${tag}>`;
  return `<table class="md-table"><thead><tr>${rows[0].map((c, i) => cell("th", c, i)).join("")}</tr></thead>`
    + `<tbody>${rows.slice(2).map(r => `<tr>${r.map((c, i) => cell("td", c, i)).join("")}</tr>`).join("")}</tbody></table>`;
}
const sentence = sid => st.doc.sentences.find(s => s.sid === sid) ?? (st.doc.retired_sentences ?? []).find(s => s.sid === sid);
const openComments = sid => st.doc.comments.filter(c => c.sid === sid && c.status !== "resolved" && !c.file);
const reviewsOf = sid => st.doc.reviews.filter(r => r.sid === sid);
/** 指摘後の更新がすべて推敲だけなら、対応の記録が付くまで未解決として持ち越す。 */
function aiOpen(s) {
  const rs = reviewsOf(s.sid), index = ver => s.versions.findIndex(v => v.ver === ver);
  return rs.filter(r => {
    const i = index(r.ver);
    return r.aspect.startsWith("指摘：") && i >= 0
      && !rs.some(a => a.aspect.startsWith("対応：") && index(a.ver) >= i)
      && s.versions.slice(i, -1).every(v => rs.some(a => a.ver === v.ver && a.aspect.startsWith("推敲：")));
  }).map(r => ({ head: r.aspect, ver: r.ver, text: r.text }));
}
/** 言い回しを直した作業の記録を、指摘とは分けて返す。 */
const aiWork = s => reviewsOf(s.sid).filter(r => r.aspect.startsWith("推敲："))
  .map(r => ({ head: r.aspect, ver: r.ver, text: r.text }));
/** AI のコメント（見直しの指摘と、最新のバージョンのずれた理由）。記録の形は別のまま、画面でだけ1つの並びにする */
function aiComments(s) {
  const v = latest(s);
  return [...reviewsOf(s.sid).filter(r => !r.aspect.startsWith("推敲：")).map(r => ({ head: r.aspect, ver: r.ver, text: r.text })),
          ...(v.deviation ? [{ head: "執筆意図からの変更", ver: v.ver, text: v.deviation }] : [])];
}
/** ユーザーのコメントが付いたことがあり、全部が解決済みの文（新しいバージョンで対応済みになったものを含む） */
function resolvedOnly(s) {
  const cs = st.doc.comments.filter(c => c.sid === s.sid && !c.file);
  return cs.length > 0 && cs.every(c => c.status === "resolved");
}
function notesOf(s) {
  return NOTES.map(([k]) => k).filter(k => (k === "user" && openComments(s.sid).length) || (k === "ai" && aiComments(s).length));
}
const roleKey = s => ROLE_KEY[viewed(s).tags.role?.[0]] || null;
// 役割は配列で、先頭が主の役割、2つ目以降が副の役割（1文が複数の性質を併せ持つことがあるため）。
// 主は色・印・数に使い、副は主の印の下に小さく添え、道具の欄では「副 n」で数える
const subRoleKeys = s => [].concat(viewed(s).tags.role ?? []).slice(1).map(r => ROLE_KEY[r]).filter(Boolean);
const impKey = s => IMPS.find(([, w]) => w === [].concat(viewed(s).tags.importance ?? [])[0])?.[0] || null;
function position(sid) {
  let p = 0, n = 0;
  for (const s of st.doc.sentences) {
    if (isBlock(s)) { if (s.sid === sid) return blockLabel(s.block); continue; }
    if (s.paragraph_start) { p++; n = 0; } n++;
    if (s.sid === sid) return `${p}段落目の${n}文目`;
  }
  return sentence(sid) ? "本文から外した文" : "";
}
const fmtTime = ns => { if (!ns) return ""; const d = new Date(Number(BigInt(ns) / 1000000n)); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

// --- 描く ---------------------------------------------------------------
/** 中身が前と同じなら書き換えない innerHTML。文を選ぶたびに本文と道具の列を丸ごと作り直すと、動き出しの1フレームが長くなって
    選んだカードの滑りが一度に跳んでいた（実測）。選んだ印は setCurrent で付け替える */
function setHTML(el, html) {
  if (el.__html === html) return false;
  el.innerHTML = html; el.__html = html; return true;
}

function renderSide() {
  const doc = st.doc, name = doc.document.split(/[\\/]/).pop();
  const sentences = doc.sentences.filter(s => !isBlock(s));
  $("doc-name").textContent = name;
  document.title = `${name} — tsuzuri`;
  document.querySelectorAll(".hbtn").forEach(b => b.setAttribute("aria-pressed", String(st[b.dataset.paint])));
  document.querySelectorAll(".sec[data-sec]").forEach(s => s.classList.toggle("off", !st[s.dataset.sec]));
  // 文の数は数字だけを太字で見せ、単位の「文」は見た目だけ隠して読み上げに残す（
  // design-library の parts/badge.md「件数は何の数かを読み上げに含める」）
  const num = n => `<span class="n"><b>${n}</b><i>文</i></span>`;
  const count = key => sentences.filter(s => roleKey(s) === key).length;
  setHTML($("legend-struct"), ROLES.map(([g, rs]) => `<div class="grp">${g}</div>` + rs.map(([w, k]) => {
    const n = count(k), m = sentences.filter(s => subRoleKeys(s).includes(k)).length;
    const sub = m ? `<span class="sub-n" aria-label="副の役割として ${m}文">副${m}</span>` : "";
    return `<button type="button" class="key" data-jump="role:${k}" data-hint-key="role:${k}" style="--k: var(--role-${k})" aria-disabled="${!n && !m}"><span class="w">${ic(`role-${k}`, "ic mark")}${w}</span>${sub}${num(n)}</button>`;
  }).join("")).join(""));
  const noteCount = k => sentences.filter(s => notesOf(s).includes(k)).length;
  setHTML($("legend-note"), NOTES.map(([k, w]) => {
    const n = noteCount(k);
    return `<button type="button" class="key" data-jump="note:${k}" data-hint-key="note:${k}" style="--k: var(--hl-${k})" aria-disabled="${!n}"><span class="w">${ic(`note-${k}`, "ic mark")}${w}</span>${num(n)}</button>`;
  }).join(""));
  setHTML($("legend-imp"), IMPS.map(([k, w]) => {
    const n = sentences.filter(s => impKey(s) === k).length;
    return `<button type="button" class="key" data-imp-focus="${k}" data-hint-key="imp:${k}" style="--k: var(--imp-${k})" aria-pressed="${st.imp === k}" aria-disabled="${!n}"><span class="w">${ic(`imp-${k}`, "ic mark")}${w}</span>${num(n)}</button>`;
  }).join(""));

  // 見出しのブロックがある記録は、見出しで目次を作る。段落の頭の文で作ると、箱や箇条書きの中の文まで段落として並んだ（ADR-0004）
  const heads = doc.sentences.filter(s => isBlock(s) && s.block?.kind === "heading");
  const paras = heads.length ? heads : sentences.filter(s => s.paragraph_start);
  const isMark = s => heads.length ? heads.includes(s) : s.paragraph_start;
  const selPara = st.sel && (() => { let cur = null; for (const s of doc.sentences) { if (isMark(s)) cur = s.sid; if (s.sid === st.sel) return cur; } })();
  // 目次は中身が変わったときだけ作り直し、今の段落の印は付け替える（作り直すと、目次の上を滑るカードの位置の元が消える）
  setHTML($("toc"), paras.map((s, i) => `<li><button type="button" data-goto="${s.sid}" data-hint="${esc(plainText(latest(s).text))}"><span class="no">${i + 1}</span><span class="t">${esc(plainText(latest(s).text))}</span></button></li>`).join(""));
  for (const b of $("toc").querySelectorAll("button[data-goto]")) {
    if (b.dataset.goto === selPara) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
  }
  renderDiffSide();
  const open = doc.comments.filter(c => c.status !== "resolved" && !c.file).length;
  $("n-open").textContent = open ? `未解決 ${open}` : "";
  document.querySelectorAll(".nbtn[data-panel]").forEach(b => b.setAttribute("aria-pressed", String(st.panel === b.dataset.panel)));
  document.querySelectorAll(".rail [data-rail]").forEach(b => { if (b.dataset.rail !== "toggle") b.setAttribute("aria-current", String(st.panel === b.dataset.rail)); });
  $("problems").hidden = !doc.problems.length; $("n-problems").textContent = doc.problems.length || "";
  $("problems").title = doc.problems.join("\n");
}

/** 文とブロックを記事の順に描き、入れ物の直後に続く文だけをその中へ入れる（ADR-0004） */
function renderText() {
  const doc = st.doc;
  if (DOC_VIEW[st.panel]) return renderDocView(st.panel);
  if (st.diff === "only" && (!st.sel || viewed(sentence(st.sel)) === latest(sentence(st.sel)))) return renderDiffOnly();
  if (!doc.sentences.length) {
    setHTML($("text"), `<p class="empty">この文章にはまだ文が無い。tsuzuri のスキルで一文ずつ執筆すると、ここに並ぶ。</p>`);
    return;
  }
  // 脚注は呼ぶ文の段落の途中に置かれるので、foot に貯めて段落を閉じたあとに出す（ADR-0004 の追記）。
  // 記録の並びは変えないので、↑↓ の移動は記録どおり「呼ぶ文 → 脚注 → 次の文」の順になる
  let html = "", open = false, container = null, foot = "", images = null;
  const put = str => { if (container?.foot) foot += str; else html += str; };
  const closePara = () => { if (open) { html += "</div>"; open = false; } html += foot; foot = ""; };
  for (const s of doc.sentences) {
    if (container && (isBlock(s) || latest(s).in !== container.sid)) { put(container.end); container = null; }
    if (isBlock(s)) {
      // 見出しは文と同じく mdInline を通す（太字・決まった形のタグ）。コードや表の中身は下で別に描く
      const b = viewed(s).block, text = esc(viewed(s).text), headText = mdInline(viewed(s).text);
      const attrs = `class="s blk blk-${esc(b.kind)}" id="s-${s.sid}" data-sid="${s.sid}" tabindex="0" role="button" aria-current="false" style="--k:var(--g-paper)"`;
      if (b.kind === "footnote") {
        foot += `<div class="blk-container blk-footnote"><span ${attrs}><span class="blk-label">${blockLabel(b)} ${esc(b.label)}</span></span>`;
        container = { sid: s.sid, kind: b.kind, end: "</div>", foot: true };
        continue;
      }
      closePara();
      if (["note", "list", "quote"].includes(b.kind)) {
        const tag = b.kind === "quote" ? "blockquote" : "div", list = b.kind === "list" ? (b.ordered ? "ol" : "ul") : null;
        const label = b.kind === "note" ? NOTE_LABEL[b.type] : blockLabel(b);
        // 入れ物の操作は見出し行へ分け、中の文の操作と読み上げが入れ子にならないようにする（ADR-0004）。
        html += `<${tag} class="blk-container blk-${b.kind}${b.kind === "note" ? ` blk-note-${esc(b.type)}` : ""}"><span ${attrs}><span class="blk-label">${label}</span></span>${list ? `<${list}>` : ""}`;
        container = { sid: s.sid, kind: b.kind, end: `${list ? `</${list}>` : ""}</${tag}>` };
      } else if (b.kind === "heading") {
        const level = [1, 2, 3, 4].includes(b.level) ? b.level : 2;
        // 文章の題（レベル1）は h2 に印を付けて描く。画面の h1 は文書名の欄が使っていて、その装飾が当たるため。
        const tagLevel = level === 1 ? 2 : level;
        const hAttrs = level === 1 ? attrs.replace('blk-heading"', 'blk-heading blk-h1"') : attrs;
        const hc = st.diff === "mark" && viewed(s) === latest(s) ? changeOf(s) : null;
        html += `<h${tagLevel} ${hAttrs}>${hc?.kind === "rewrite" ? charDiff(hc.before.text, hc.cur.text) : hc?.kind === "new" ? `<ins>${headText}</ins>` : headText}</h${tagLevel}>`;
      } else if (b.kind === "table" && mdTable(viewed(s).text)) {
        html += `<div ${attrs}>${mdTable(viewed(s).text)}</div>`;
      } else if (b.kind === "image" && (images = imageBlock(viewed(s).text))) {
        html += `<div ${attrs}><figure class="blk-img">${images}</figure></div>`;
      } else {
        html += `<div ${attrs}>${b.kind === "code" && b.lang ? `<span class="blk-label">${esc(b.lang)}</span>` : ""}<pre>${b.kind === "code" ? `<code>${text}</code>` : text}</pre></div>`;
      }
      continue;
    }
    if (!container && (s.paragraph_start || !open)) { closePara(); html += `<div class="para" id="p-${s.sid}">`; open = true; }
    // 人の文で1項目に2文以上あるとき、2文目から（cont）は前の文と同じ項目に続ける
    const cont = container?.kind === "list" && latest(s).cont;
    if (container?.kind === "list" && !cont) html += "<li>";
    const rk = roleKey(s), notes = notesOf(s);
    const chg = st.diff === "mark" ? changeOf(s) : null;
    const k = rk ? `var(--role-${rk})` : "var(--hl-human)";
    // 解決済みのコメントしか無い文は、印と線を無彩色にして「指摘はあったが片づいた」と示す。
    // ユーザーと AI の両方があるときは、印を2つ並べ、線を上下で2色に塗り分ける（前は先頭の1つしか描かず、AI の印が隠れていた）
    const done = !notes.length && (resolvedOnly(s) || aiWork(s).length);
    const hl = notes.length ? `var(--hl-${notes[0]})` : "transparent";
    const hlr = notes.length > 1 ? `linear-gradient(var(--hl-${notes[0]}) 50%, var(--hl-${notes[1]}) 50%)` : done ? "var(--hl-done)" : hl;
    // 文の頭に、左は役割の形、右はコメントの出どころの形を置く。印の線はその下に続く（形があるほうが見やすいため）
    const markL = rk ? ic(`role-${rk}`, "ic mark mk-l") : "";
    const subs = rk ? subRoleKeys(s) : [];
    const markSub = subs.map((sk, i) => ic(`role-${sk}`, "ic mark mk-sub").replace('class="ic mark mk-sub"', `class="ic mark mk-sub" style="--k:var(--role-${sk});--i:${i}"`)).join("");
    const markR = notes.length || done ? ic(`note-${notes[0] ?? (aiWork(s).length ? "ai" : "user")}`, "ic mark mk-r").replace('class="ic mark mk-r"', `class="ic mark mk-r${done ? " mk-done" : ""}" style="--k:${done ? "var(--hl-done)" : hl}"`) : "";
    const workMark = !notes.includes("ai") && aiWork(s).length && notes.length;
    const markR2 = workMark ? ic("note-ai", "ic mark mk-r2").replace('class="ic mark mk-r2"', 'class="ic mark mk-r2" style="--k:var(--hl-done)"') : notes[1] ? ic(`note-${notes[1]}`, "ic mark mk-r2").replace('class="ic mark mk-r2"', `class="ic mark mk-r2" style="--k:var(--hl-${notes[1]})"`) : "";
    put(`<span class="s${markL ? " has-l" : ""}${markR ? " has-r" : ""}${chg ? ` chg chg-${chg.kind}` : ""}" id="s-${s.sid}" data-sid="${s.sid}" data-rk="${rk || ""}" data-rsub="${subs.join(" ")}" data-notes="${notes.join(" ")}" data-imp="${impKey(s) || ""}" tabindex="0" role="button" aria-current="false" style="--k:${k};--hl:${hl};--hlr:${hlr};--nsub:${subs.length}">${markL}${markSub}${markR}${markR2}<span class="in">${inText(s)}</span></span>`);
    if (container?.kind === "list") {
      const next = doc.sentences[doc.sentences.indexOf(s) + 1];
      if (!(next && !isBlock(next) && latest(next).in === container.sid && latest(next).cont)) html += "</li>";
    }
  }
  if (container) put(container.end);
  closePara();
  // 中身が前と同じなら作り直さず、選んだ文の印だけ付け替える
  setHTML($("text"), html);
  for (const el of $("text").querySelectorAll('.s[aria-current="true"]')) el.setAttribute("aria-current", "false");
  if (st.sel) $(`s-${st.sel}`)?.setAttribute("aria-current", "true");
}

const whoTag = k => `<span class="who who-${k}">${ic(`note-${k}`, "ic mark")}${k === "ai" ? "AI" : "ユーザー"}</span>`;
/** ユーザーのコメント1件の行。文詳細と、要件定義書・設計書の右の欄で同じ形にする（解決・削除のボタンは同じ処理が受ける） */
const commentLi = c => `<li class="cm${c.status === "resolved" ? " resolved" : ""}" data-cid="${esc(c.id)}"><div class="meta">${whoTag("user")}${c.to ? `<span class="to">${esc(c.to)} へ</span>` : ""}<span>${fmtTime(c.created_at)}・${esc(c.ver)}</span>${c.addressed_by ? `<span class="addressed">${c.addressed_by === "retired" ? "文を外して対応" : `${esc(c.addressed_by)} で対応`}</span>` : ""}
      <span class="cm-acts"><button type="button" data-status="${esc(c.id)}:${c.status === "resolved" ? "open" : "resolved"}">${c.status === "resolved" ? "未解決に戻す" : "解決"}</button>
      <button type="button" class="del" data-del="${esc(c.id)}" aria-label="このコメントを削除" data-hint="削除">${ic("trash-2")}</button></span></div><p>${esc(c.text)}</p></li>`;
/** 要件定義書・設計書の項目へのコメント（ADR-0005）。item は要件定義書なら項目の番号、設計書なら段落の id */
const docComments = (view, item) => st.doc.comments.filter(c => c.doc === view && c.item === item && !c.file);
/** 文が1つも無い記録（要件定義書だけを入れた段階）は、要件定義書の画面から開く。本文の画面は「まだ文がない」だけになるため */
const firstPanel = () => !st.doc.sentences.length && st.doc.requirements.length ? "requirements" : "detail";

function renderDetail() {
  const el = $("detail");
  // 文詳細は文を選んでいるときだけ出す（手動の開閉は不要なので外した）。コメント一覧・要件定義書・設計書は選択がなくても出す
  st.closed = st.panel === "detail" && !st.sel;
  document.body.classList.toggle("closed", st.closed);
  if (st.panel === "comments") return showPanel(el, "comments", commentsPanelHTML());
  // 選んだ項目か段落が変わるたびに、右の欄も入れ替えの動きで差し替える
  if (st.panel === "requirements") return showPanel(el, `requirements:${st.docSel}`, requirementsPanelHTML());
  if (st.panel === "design") return showPanel(el, `design:${st.docSel}`, designPanelHTML());
  const s = st.sel && sentence(st.sel);
  if (!s) { el.innerHTML = ""; delete el.dataset.view; return; }
  const cur = latest(s), v = s.versions.find(x => x.ver === st.viewVer) || cur, isOld = v !== cur;
  const block = isBlock(s) ? v.block : null, title = block ? "ブロック詳細" : "文詳細";
  el.setAttribute("aria-label", title);
  const head = `<div class="bar" data-k="head"><h2>${ic("file-text")}${title}</h2><span class="where">${block ? blockLabel(block) : position(s.sid)}</span><span class="kb kb-at" aria-hidden="true">↑↓ で前後の${block ? "文・ブロック" : "文"}</span><span class="kb" aria-hidden="true">Esc で閉じる</span></div>`;
  const retired = st.doc.retired.some(r => r.sid === s.sid);
  const retiredText = retired ? `<section data-k="retired"><h3 class="k">${block ? "本文から外したブロック" : "本文から外した文"}</h3><div class="md">${block ? esc(v.text) : mdInline(v.text)}</div></section>` : "";
  const old = isOld ? `<div class="old" data-k="old">以前のバージョン（${esc(v.ver)}）を表示中<button type="button" data-ver="${esc(cur.ver)}">最新へ</button></div>` : "";
  const memo = `<section data-k="memo"><h3 class="k">${ic("lightbulb")}執筆意図</h3>${v.memo ? `<p class="memo${["inferred", "reported"].includes(v.memo_by) ? " inferred" : ""}">${v.memo_by === "inferred" ? `<span class="inferred-note">tsuzuri で執筆した文ではないため推測</span>` : v.memo_by === "reported" ? `<span class="inferred-note">書いた AI の申告</span>` : ""}${esc(v.memo)}</p>` : `<p class="none">${block ? "執筆意図は無い。" : "人が執筆した文で、執筆意図の推測はまだ無い。"}</p>`}
    ${v.deviation ? `<div class="dev"><h4 class="k">${ic("arrow-right-left")}変更理由</h4>${esc(v.deviation)}</div>` : ""}${intentDiff(s, v)}</section>`;
  const attrs = block ? [block.kind === "heading" && `段 ${block.level}`, block.kind === "code" && block.lang && `言語 ${block.lang}`,
    block.kind === "note" && NOTE_LABEL[block.type], block.kind === "list" && (block.ordered ? "番号あり" : "番号なし"),
    block.kind === "footnote" && `ラベル ${block.label}`].filter(Boolean) : [];
  const roles = block ? `<section data-k="kind"><h3 class="k">種類</h3><p class="memo">${esc([blockLabel(block), ...attrs].join("・"))}</p></section>`
    : `<section data-k="roles"><h3 class="k">${ic("tags")}文機能<span class="kb kb-at" aria-hidden="true">← → で要素へ</span></h3>${funcProse(v)}</section>`;
  const refs = refsHTML(v);
  // コメントは、ユーザーのものと AI のものを1つの欄に並べ、出どころのカードだけで分ける。解決できるのはユーザーのコメントだけ（アプリが書くのは comments/ だけ・ADR-0001）
  const cs = st.doc.comments.filter(c => c.sid === s.sid && !c.file);
  const openCs = cs.filter(c => c.status !== "resolved"), doneCs = cs.filter(c => c.status === "resolved"), ais = aiComments(s), work = aiWork(s);
  const who = whoTag, one = commentLi;
  const aiOne = a => `<li class="cm" data-cid="ai:${esc(a.head)}:${esc(a.ver)}"><div class="meta">${who("ai")}<span>${esc(a.head)}・${esc(a.ver)}</span></div><p>${esc(a.text)}</p></li>`;
  const count = openCs.length + ais.length;
  const comments = `<section data-k="comments"><h3 class="k">${ic("message-square")}コメント ${count ? `${count}件` : ""}</h3>
    ${count ? `<ul class="cms">${ais.map(aiOne).join("")}${openCs.map(one).join("")}</ul>` : ""}
    ${doneCs.length ? `<details class="more"><summary>${ic("chevron-right", "ic chev")}解決済み ${doneCs.length}件</summary><div class="body"><ul class="cms">${doneCs.map(one).join("")}</ul></div></details>` : ""}
    ${work.length ? `<details class="more"><summary>${ic("chevron-right", "ic chev")}作業の記録 ${work.length}件</summary><div class="body"><ul class="cms">${work.map(aiOne).join("")}</ul></div></details>` : ""}
    <form class="form" id="form" style="margin-top:12px"><label for="input"><span class="vh">コメント</span>${st.draftTo ? `<span class="to">${esc(st.draftTo)} へ</span>` : ""}</label>
      <textarea id="input" placeholder="この${block ? "ブロック" : "文"}へのコメント">${esc(st.drafts[s.sid] ?? "")}</textarea>
      <div class="acts"><span><kbd>Ctrl</kbd>+<kbd>↵</kbd></span><button type="submit" class="send">${ic("message-square")}コメント</button></div></form></section>`;
  const vers = `<details class="more" data-k="vers"><summary>${ic("chevron-right", "ic chev")}${ic("history")}バージョン履歴 ${s.versions.length}件</summary><div class="body"><ol class="vers">${[...s.versions].reverse().map(x =>
    `<li><button type="button" data-ver="${esc(x.ver)}" ${x === v ? 'aria-current="true"' : ""}><span>${esc(x.ver)}${x === cur ? " 最新" : ""}</span><span class="vt" title="${esc(verTitle(s, x))}">${esc(verTitle(s, x))}</span><span class="vm">${fmtTime(x.written_at)} ${x.source === "human" ? "自筆" : ""}</span></button></li>`).join("")}</ol></div></details>`;
  // 書いた文そのものは本文で選んだカードに見えているので、文詳細には出さない（二重表示になるため）
  showPanel(el, `s:${s.sid}`, head + old + retiredText + memo + roles + refs + comments + vers);
}

/** 文詳細の「対応する要件と段落」。その文の対応要件に当たる項目と、属する段落だけを、文が照らしたバージョンから切り出す
    （ADR-0003。どの文を選んでも要件定義が全部出るのは欠陥だった）。
    見つからない部分は全文に戻さずに出さない。全文は「全文で表示」から左のアイコンの画面へ移って読む */
function refsHTML(v) {
  const items = reqItems(st.texts[v.requirements]);
  const k = findItem(items, v.tags.place), item = k < 0 ? null : items[k];
  const para = v.design ? designParas(st.texts[v.design]).paras.find(p => p.id === v.para) : null;
  if (!item && !para) return "";
  const part = (icon, label, ver, title, body, open) => `<div class="ref"><div class="ref-h">${ic(icon)}<span class="ref-k">${label} ${esc(ver)}</span>
      <button type="button" class="ref-go" data-open="${esc(open)}">全文で表示${ic("chevron-right")}</button></div>
      <p class="ref-t">${esc(title)}</p>${body ? `<div class="md ref-b">${mdLite(body)}</div>` : ""}</div>`;
  return `<section data-k="refs"><h3 class="k">${ic("target")}対応する要件と段落</h3>
    ${item ? part("clipboard-list", "要件定義書", v.requirements, itemTitle(item), item.body, `requirements:${v.requirements}:${k}`) : ""}
    ${para ? part("design-doc", "設計書", v.design, `${paraNo(para.id)}段落目　${para.claim}`, para.body, `design:${v.design}:${para.id}`) : ""}</section>`;
}

/** 右の欄に中身を出す。別の文・別の画面（コメント一覧・要件定義書・設計書）へ移ったときは、古い中身が退場して新しい中身が登場する
    （motion.js の morphDetail）。同じ画面の描き直し（コメントを残した・バージョンを切り替えた）は、すぐ入れ替える */
function showPanel(el, view, html) {
  const prev = el.dataset.view;
  el.dataset.view = view;
  // 文から文へ移るときだけ頭を止めて字を替え、別の画面へ移るときは頭も一緒に入れ替える
  const sameKind = prev?.startsWith("s:") && view.startsWith("s:");
  if (prev && prev !== view && el.children.length && window.motion?.morphDetail) window.motion.morphDetail(el, html, revealRef, sameKind);
  else { el.innerHTML = html; revealRef(); }
}
/** 「全文で表示」で頼まれた項目か段落（st.reveal）まで欄をスクロールし、着いた所を一度だけ縁取る。
    入れ替えの動きが途中で欄を頭へ戻すので、新しい中身が入ったあとに呼ぶ */
function revealRef() {
  if (st.focusInput) { st.focusInput = false; $("input")?.focus({ preventScroll: true }); }
  const id = st.reveal; st.reveal = null;
  const el = $("detail"), target = id && $(id);
  if (!target) return;
  el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - 16;
  target.classList.add("flash"); setTimeout(() => target.classList.remove("flash"), 1600);
}

/** コメント一覧の中身。ユーザーの未解決のコメントと AI のコメントを、文の順に並べる。画面の切り替えは左のアイコンの列で行うので、閉じる×は置かない */
/** コメント一覧の行で、コメントの下に対象の文（項目）を別の面で囲んで出す。コメントと対象の文が同じ地で続くと見分けにくかったため */
const targetBox = text => text ? `<div class="qbox"><span class="q-label">対象</span><div class="q">${esc(text)}</div></div>` : "";
function commentsPanelHTML() {
  const cs = st.doc.comments.filter(c => !c.file);
  const open = cs.filter(c => c.status !== "resolved"), done = cs.filter(c => c.status === "resolved");
  const who = k => `<span class="who who-${k}">${ic(`note-${k}`, "ic mark")}${k === "ai" ? "AI" : "ユーザー"}</span>`;
  const item = c => `<li><button type="button" data-goto="${esc(c.sid)}"><div class="meta">${who("user")}${c.to ? `${esc(c.to)} へ・` : ""}${fmtTime(c.created_at)}・${position(c.sid)}${c.note ? `・${esc(c.note)}` : ""}</div><div>${esc(c.text)}</div>${targetBox(c.current_text)}</button></li>`;
  const aiItem = (s, a) => `<li><button type="button" data-goto="${s.sid}"><div class="meta">${who("ai")}${esc(a.head)}・${position(s.sid)}</div><div>${esc(a.text)}</div>${targetBox(latest(s).text)}</button></li>`;
  // 未解決だけ。AI のコメントは aiOpen の決まりで数える
  const onlyOpen = st.openOnly;
  const aiOf = s => onlyOpen ? aiOpen(s) : aiComments(s);
  // 切り替えの2行に出す件数（すべて・未解決）。どちらの行にも件数を出すのはサイドバーの切り替えと同じ
  const nOpen = open.length + st.doc.sentences.reduce((n, s) => n + aiOpen(s).length, 0);
  const nAll = open.length + st.doc.sentences.reduce((n, s) => n + aiComments(s).length, 0);
  // 文の順に並べる。同じ文の中では AI を先、ユーザーをあとにする（文詳細の並びと同じ）
  // 本文から外した文へのコメントは、その文を置き換えた文の直前に並べる（並びに無い文なので、文の順だけで回すと件数に入るのに一覧に出なかった）
  const rows = [], bodyIndex = new Map(st.doc.sentences.map((s, i) => [s.sid, i])), inBody = sid => bodyIndex.has(sid);
  // 置き換え先は into を最後までたどる（分けた文をさらに分けると、1段目の into は本文に無い）。
  // 行き着いた文のうち本文で一番前の文を返す（into の配列の順は、move のあとの本文の順と一致しない）
  const replacedBy = c => {
    const seen = new Set(), queue = [c.sid];
    let best;
    while (queue.length) {
      const sid = queue.shift();
      if (seen.has(sid)) continue;
      seen.add(sid);
      if (sid !== c.sid && inBody(sid) && (best === undefined || bodyIndex.get(sid) < bodyIndex.get(best))) best = sid;
      queue.push(...(st.doc.retired.find(r => r.sid === sid)?.into || []));
    }
    return best;
  };
  for (const s of st.doc.sentences) {
    for (const c of open.filter(c => !c.doc && replacedBy(c) === s.sid)) rows.push(item(c));
    for (const a of aiOf(s)) rows.push(aiItem(s, a));
    for (const c of open.filter(c => c.sid === s.sid)) rows.push(item(c));
  }
  for (const c of open.filter(c => !c.doc && !inBody(c.sid) && !replacedBy(c))) rows.push(item(c));
  // 要件定義書・設計書へのコメントは、文より前の段階の話なので頭に並べる（ADR-0005）
  const docRows = open.filter(c => c.doc).map(docItemRow);
  // 表示の切り替えは、サイドバーの「変更」と同じ部品（アイコン・名前・件数の行を並べ、押している行は白いカード）で置く
  // （他の部品と UI の文脈をそろえた。最初は見出しの右に濃紺の丸ボタンを置いていた）
  const view = (on, icon, w, n) => `<button type="button" class="key" data-open-only="${on ? 1 : 0}" aria-pressed="${onlyOpen === on}" aria-disabled="${!n}" style="--k: var(--navy)"><span class="w">${ic(icon, "ic mark")}${w}</span><span class="n"><b>${n}</b><i>件</i></span></button>`;
  return `<div class="bar" data-k="head"><h2>${ic("messages-square")}コメント一覧</h2></div>
    <div class="legend cm-view" role="group" aria-label="コメントの表示">${view(false, "messages-square", "すべて", nAll)}${view(true, "message-open", "未解決", nOpen)}</div>
    <section>${rows.length + docRows.length ? `<ul class="list">${docRows.join("")}${rows.join("")}</ul>` : `<p class="empty">${onlyOpen ? "未解決のコメントは無い。" : "コメントは無い。"}</p>`}</section>
    ${done.length && !onlyOpen ? `<details class="more"><summary>${ic("chevron-right", "ic chev")}解決済み ${done.length}件</summary><div class="body"><ul class="list">${done.map(c => c.doc ? docItemRow(c) : item(c)).join("")}</ul></div></details>` : ""}`;
}

/** コメント一覧の、要件定義書・設計書の項目へのコメントの行。押すとその画面の項目へ移る（ADR-0005） */
function docItemRow(c) {
  // doc と item はコメントのファイルの値をそのまま持つ。受け取った記録の comments/ が細工されていると、
  // 行き先の無いコメントとして確かめずに届くので、種類は2つに限り、item は字として出す
  const kind = DOC_VIEW[c.doc] ? c.doc : null, name = kind ? DOC_VIEW[kind][1] : "文書", item = String(c.item ?? "");
  const where = kind === "design" ? `${esc(paraNo(item))}段落目` : `${esc(item)}番の項目`;
  const ids = kind === "requirements" ? st.doc.requirements : (st.doc.designs ?? []);
  const k = kind ? docItems(kind, ids.at(-1)).items.findIndex(i => String(i.match) === item) : -1;
  const go = k < 0 ? "" : ` data-open="${kind}:${esc(ids.at(-1))}:${kind === "design" ? esc(item) : k}"`;
  return `<li><button type="button"${go}><div class="meta">${whoTag("user")}${name} ${esc(c.ver)}・${where}${c.addressed_by ? `・${esc(c.addressed_by)} で対応` : ""}${c.note ? `・${esc(c.note)}` : ""}</div><div>${esc(c.text)}</div>${targetBox((c.current_text || "").replace(/^##\s+/, ""))}</button></li>`;
}
/** 要件定義書・設計書の画面で選んだ項目（段落）へ、今見ているバージョンのコメントとして送る */
async function sendDocComment(form) {
  const d = docItems(st.panel), sel = d.items.find(i => i.key === st.docSel), text = $("input").value.trim();
  if (!sel || sel.match == null || !text) return;
  const btn = form.querySelector(".send"); btn.disabled = true;
  try {
    await post("/api/comments", { doc: st.panel, ver: d.id, item: String(sel.match), text });
    delete st.drafts[`${sel.key}@${d.id}`]; await loadDoc(); render(); toast("コメントを残した");
  } catch (err) { toast(err.message); btn.disabled = false; }
}

/** md を見出し・箇条書き・段落・太字・コードだけの HTML にする（要件の表示用）。先に全部をエスケープしてから印を置き換えるので、md の中の HTML は字のまま出る */
function mdLite(text) {
  const inline = t => esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const out = []; let list = null, para = [];
  const flush = () => {
    if (para.length) { out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; }
    if (list) { out.push(`<${list.tag}>${list.items.map(x => `<li>${inline(x)}</li>`).join("")}</${list.tag}>`); list = null; }
  };
  for (const line of String(text ?? "").split("\n")) {
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) { flush(); out.push(`<p class="md-h${m[1].length}">${inline(m[2])}</p>`); }
    else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) { if (para.length) flush(); if (!list || list.tag !== "ul") { flush(); list = { tag: "ul", items: [] }; } list.items.push(m[1]); }
    else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { if (para.length) flush(); if (!list || list.tag !== "ol") { flush(); list = { tag: "ol", items: [] }; } list.items.push(m[1]); }
    else if (!line.trim()) flush();
    else { if (list) flush(); para.push(line); }
  }
  flush();
  return out.join("");
}

/** 要件定義書を項目に分ける。`## <番号>. <項目名>` の見出しを区切りにし、次の見出しまでを本文とする（ADR-0003）。
    見出しの無い古い要件は「- 依頼: 本文」か「1. **依頼** — 本文」の行を1項目として読む（前の記録はそのまま読む） */
function reqItems(text) {
  const lines = String(text ?? "").split("\n"), items = [];
  for (const line of lines) {
    const h = /^##\s+(\d+)\.\s+(.+?)\s*$/.exec(line);
    if (h) items.push({ no: h[1], name: h[2], body: [] });
    else if (items.length) items.at(-1).body.push(line);
  }
  if (items.length) return items.map(i => ({ ...i, body: i.body.join("\n").trim() }));
  for (const line of lines) {
    const m = /^\s*(?:[-*]|\d+\.)\s*(?:\*\*)?([^:：*—]+?)(?:\*\*)?\s*(?:[:：]|—)\s*(.+)$/.exec(line);
    if (m) items.push({ no: null, name: m[1].trim(), body: m[2].trim() });
  }
  return items;
}
/** 対応要件の値（「8. 言いたいこと」「言いたいこと」）を、突き合わせ用に番号を外した名前にする */
const placeName = p => String(p ?? "").replace(/^\s*\d+\s*[.．]\s*/, "").trim();
/** 対応要件の値に当たる項目の位置。項目名で探し、無ければ番号で探す。見つからなければ -1 */
function findItem(items, place) {
  const byName = items.findIndex(i => i.name === placeName(place));
  if (byName >= 0) return byName;
  const no = /^\s*(\d+)\s*[.．]/.exec(String(place ?? ""))?.[1];
  return no ? items.findIndex(i => i.no === no) : -1;
}
const itemTitle = i => i.no ? `${i.no}. ${i.name}` : i.name;
const paraNo = id => id.replace(/^p/, "");

/** 設計書を、頭の「要件定義書: rNNN」と、`## p<番号> <主張>` ごとの段落に分ける（ADR-0003） */
function designParas(text) {
  const paras = []; let basedOn = null;
  for (const line of String(text ?? "").split("\n")) {
    const b = !paras.length && /^要件定義書:\s*(r\d+)\s*$/.exec(line.trim());
    if (b) { basedOn = b[1]; continue; }
    const h = /^##\s+(p\d+)\s+(.+?)\s*$/.exec(line);
    if (h) paras.push({ id: h[1], claim: h[2], body: [] });
    else if (paras.length) paras.at(-1).body.push(line);
  }
  return { basedOn, paras: paras.map(p => ({ ...p, body: p.body.join("\n").trim() })) };
}

const docRow = s => `<li><button type="button" data-goto="${s.sid}"><div class="meta">${position(s.sid)}${isBlock(s) ? "" : `・${esc(latest(s).tags.role.join("・"))}`}${
  st.panel === "design" && latest(s).design && latest(s).design !== docItems("design").id ? `<span class="stale">${esc(latest(s).design)} に照らした</span>` : ""}</div><div class="q">${esc(latest(s).text)}</div></button></li>`;
/** 全文の画面の頭。開いているバージョンが最新でなければ、最新のバージョンも添える */
function docHead(icon, title, ids, id) {
  const note = id && id !== ids.at(-1) ? `（最新は ${esc(ids.at(-1))}）` : "";
  return `<div class="bar" data-k="head"><h2>${ic(icon)}${title}</h2>${id ? `<span class="where">${esc(id)}${note}</span>` : ""}</div>`;
}

/**
 * 要件定義書か設計書を、真ん中で選べる塊（項目・段落）に分けて返す。key は選択と移動に使う `<画面>:<項目の位置か段落の id>`。
 * members はその塊を担う文とブロック。要件定義書は対応要件（place）で、設計書は段落（para）で突き合わせる
 */
function docItems(view, at = null) {
  const ids = view === "requirements" ? st.doc.requirements : (st.doc.designs ?? []);
  const id = at || st.docVer[view] || ids.at(-1);
  if (!id) return { id, ids, items: [], others: [] };
  if (view === "requirements") {
    const items = reqItems(st.texts[id]), by = new Map();
    for (const s of st.doc.sentences) {
      const k = findItem(items, latest(s).tags.place), key = k < 0 ? placeName(latest(s).tags.place) : k;
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(s);
    }
    // match: 前のバージョンと突き合わせるキー。番号のある項目は番号、無い古い形は項目名
    return { id, ids, items: items.map((i, k) => ({ key: `requirements:${k}`, match: i.no ?? i.name, title: itemTitle(i), body: i.body, members: by.get(k) ?? [] })),
      others: [...by.entries()].filter(([k]) => typeof k === "string").map(([k, ss]) => ({ title: k || "（空）", members: ss })) };
  }
  const { basedOn, paras } = designParas(st.texts[id]);
  // 前のバージョンの設計書に照らした文も、同じ段落の番号なら一緒に並べる（段落の番号を変えずに設計書を直すことが多い）。
  // 前のバージョンに照らした文は docRow が印を付けるので、どの設計書に照らしたかは見分けられる
  const known = new Set(paras.map(p => p.id));
  const outside = st.doc.sentences.filter(s => latest(s).design !== id && !known.has(latest(s).para));
  return { id, ids, basedOn, items: paras.map(p => ({ key: `design:${p.id}`, match: p.id, title: `${paraNo(p.id)}段落目　${p.claim}`, body: p.body,
    members: st.doc.sentences.filter(s => latest(s).design && latest(s).para === p.id) })),
    others: outside.length ? [{ title: "この設計書の段落に当たらない文", members: outside }] : [] };
}
const DOC_VIEW = { requirements: ["clipboard-list", "要件定義書"], design: ["design-doc", "設計書"] };
const memberLabel = ss => ss.some(isBlock) ? "箇所" : "文";

/**
 * 要件定義書・設計書を真ん中に Markdown で描く（本文の部分を切り替え、真ん中で Markdown の本体を読めるようにし、右側には選んだ項目に対応する一文を出す）。塊は本文の文と同じ .s にして、ホバーと選択のカード（motion.js）をそのまま使う
 */
function renderDocView(view) {
  const [icon, name] = DOC_VIEW[view], d = docItems(view);
  if (!d.id) return setHTML($("text"), `<p class="empty">${view === "requirements" ? "要件定義書はまだ無い。" : "この記録には設計書が無い。1段落で終わる文章と人の文では、設計書を作らないことがある。"}</p>`);
  const head = `<div class="doc-title">${ic(icon)}<span>${name} ${esc(d.id)}</span>${d.id !== d.ids.at(-1) ? `<span class="where">最新は ${esc(d.ids.at(-1))}</span>` : ""}
    ${d.basedOn ? `<span class="where">要件定義書 ${esc(d.basedOn)} に基づく</span>` : ""}</div>`;
  // 変更のハイライトとフィルターのときは、選んだ回の前のバージョンと項目ごとに比べる
  const dd = st.diff !== "off" ? docDiff(view) : null, unit = view === "requirements" ? "項目" : "段落";
  const written = st.doc.sentences.length > 0;
  const item = i => {
    const c = dd?.changes.get(i.key), h = dd ? docItemHTML(i, c, unit) : { tag: "", title: esc(i.title), body: i.body ? `<div class="md">${mdLite(i.body)}</div>` : "" };
    // 担う文の数は文を書き始めてから出す。書く前は全部の項目が「担う文なし」の警告になって、読む目を止めるため
    const open = i.match == null ? 0 : docComments(view, String(i.match)).filter(x => x.status !== "resolved").length;
    const count = written ? (i.members.length ? `${memberLabel(i.members)} ${i.members.length}` : "担う文なし") : "";
    return `<section class="s docitem${!written || i.members.length ? "" : " missing"}" id="s-${i.key.replace(":", "-")}" data-doc="${esc(i.key)}" tabindex="0" role="button"
      aria-current="${st.docSel === i.key}" style="--k:var(--g-paper)"><h2 class="docitem-h"><span class="t">${h.title}</span>${h.tag}${open ? `<span class="n cm-n">コメント ${open}</span>` : ""}<span class="n">${count}</span></h2>
      ${h.body}</section>`;
  };
  const removed = i => { const h = docItemHTML(i, { kind: "removed" }, unit); return `<section class="docitem gone"><h2 class="docitem-h"><span class="t">${h.title}</span>${h.tag}</h2>${h.body}</section>`; };
  const shown = st.diff === "only" ? d.items.filter(i => dd?.changes.has(i.key)) : d.items;
  const note = dd && !dd.base ? `<p class="empty">比べる前のバージョンが無い（${esc(d.id)} が最初のバージョン）。</p>`
    : st.diff === "only" && !shown.length && !dd.removed.length ? `<p class="empty">${esc(dd.base)} からの変更は無い。</p>` : "";
  setHTML($("text"), head + note + shown.map(item).join("") + (dd ? dd.removed.map(removed).join("") : ""));
}

/** 右の欄の要件定義書・設計書。真ん中で選んだ項目か段落を担う文を並べ、何も選んでいなければ全体の件数と、担う文の無い項目を出す */
function docPanelHTML(view) {
  const [icon, name] = DOC_VIEW[view], d = docItems(view);
  const head = docHead(icon, name, d.ids, d.id);
  if (!d.id) return head + `<p class="empty">${name}は無い。</p>`;
  const sel = d.items.find(i => i.key === st.docSel);
  const unit = view === "requirements" ? "項目" : "段落", written = st.doc.sentences.length > 0;
  if (sel) {
    // 項目（段落）へのコメント（ADR-0005）。要件と設計の段階でも、文と同じ形で読んで返せるようにする
    const cs = sel.match == null ? [] : docComments(view, String(sel.match));
    const openCs = cs.filter(c => c.status !== "resolved"), doneCs = cs.filter(c => c.status === "resolved");
    const comments = sel.match == null ? "" : `<section data-k="comments"><h3 class="k">${ic("message-square")}コメント ${openCs.length ? `${openCs.length}件` : ""}</h3>
      ${openCs.length ? `<ul class="cms">${openCs.map(commentLi).join("")}</ul>` : ""}
      ${doneCs.length ? `<details class="more"><summary>${ic("chevron-right", "ic chev")}解決済み ${doneCs.length}件</summary><div class="body"><ul class="cms">${doneCs.map(commentLi).join("")}</ul></div></details>` : ""}
      <form class="form" id="form" style="margin-top:12px"><label for="input"><span class="vh">コメント</span></label>
        <textarea id="input" placeholder="この${unit}へのコメント">${esc(st.drafts[`${sel.key}@${d.id}`] ?? "")}</textarea>
        <div class="acts"><span><kbd>Ctrl</kbd>+<kbd>↵</kbd></span><button type="submit" class="send">${ic("message-square")}コメント</button></div></form></section>`;
    const members = written ? `<section><h3 class="k">${ic("target")}担う文<span class="n">${sel.members.length ? `${memberLabel(sel.members)} ${sel.members.length}` : "なし"}</span></h3>
      ${sel.members.length ? `<ul class="list">${sel.members.map(docRow).join("")}</ul>` : `<p class="empty">この${unit}を担う文はまだ無い。</p>`}</section>` : "";
    return `${head}<section><h3 class="k">${ic("target")}${esc(sel.title)}</h3></section>${comments}${members}`;
  }
  // まだ文を書いていない段階では、担う文が無いのは当たり前なので、警告にせずコメントの書き方を案内する
  const missing = written ? d.items.filter(i => !i.members.length) : [];
  const summary = !d.items.length ? `${unit}を読み込めなかった。`
    : !written ? `まだ文が無い。真ん中で${unit}を選択すると、その${unit}へのコメントを記入できる。`
    : `${d.items.length}${unit}のうち、${missing.length ? `担う文の無い${unit}は ${missing.length}つ。` : `全部に担う文がある。`}真ん中で${unit}を選択すると、担う文とコメントがここに並ぶ。`;
  return `${head}<p class="cov-sum${missing.length ? " warn" : ""}">${summary}</p>
    ${missing.length ? `<section><h3 class="k">${ic("target")}担う文の無い${unit}</h3><ul class="list">${missing.map(i => `<li><button type="button" data-doc="${esc(i.key)}"><div>${esc(i.title)}</div></button></li>`).join("")}</ul></section>` : ""}
    ${d.others.map(o => `<section><h3 class="k">${ic("target")}${esc(o.title)}<span class="n">${memberLabel(o.members)} ${o.members.length}</span></h3><ul class="list">${o.members.map(docRow).join("")}</ul></section>`).join("")}`;
}
const requirementsPanelHTML = () => docPanelHTML("requirements");
const designPanelHTML = () => docPanelHTML("design");
/** 文書の画面で、真ん中の項目か段落を選ぶ（もう一度押すと外す） */
function selectDoc(key, { scroll = false } = {}) {
  st.docSel = st.docSel === key ? null : key;
  // 文を選んだときと同じく、項目を選んだらコメント欄へ入る（キーボードだけで操作を完結させるため）。
  // 空の欄では ↑↓ で前後の項目へ移れるので、キーだけで読んで返せる
  st.focusInput = !!st.docSel;
  render();
  if (scroll && st.docSel) $(`s-${key.replace(":", "-")}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
}
/** 文書の画面で、前後の項目か段落へ移る */
function stepDoc(dir) {
  const keys = docItems(st.panel).items.map(i => i.key);
  if (!keys.length) return;
  const i = keys.indexOf(st.docSel);
  st.docSel = null;
  selectDoc(keys[Math.max(0, Math.min(keys.length - 1, i < 0 ? (dir > 0 ? 0 : keys.length - 1) : i + dir))], { scroll: true });
}

function render() {
  const b = document.body.dataset;
  b.struct = st.struct ? "on" : "off"; b.note = st.note ? "on" : "off";
  // 胡桃の書斎と霧は、どちらか1つを塗る作り（data-paint）のまま。文章構造を優先する
  b.paint = st.struct ? "struct" : st.note ? "note" : "none";
  renderSide(); renderText(); renderDetail();
  window.motion?.afterRender();
}

// --- 操作 ---------------------------------------------------------------
// 選ぶと文詳細が伸びて出る・外すと縮んで引っ込む（motion.js）
/** 文を選ぶ。選んだらコメント欄へフォーカスし、キーボードだけで書いて送れるようにする。
    右の欄の中身が入れ替えの動きの途中なら、新しい中身が入ったとき（revealRef）にフォーカスする */
function select(sid, { scroll = false } = {}) {
  const wasClosed = st.panel === "detail" && !st.sel;
  st.sel = sid; st.viewVer = null; st.draftTo = null; st.panel = "detail"; st.focusInput = true;
  render();
  if (wasClosed) window.motion?.openDetail();
  if (scroll) $(`s-${sid}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  if (st.focusInput && !document.querySelector("#detail .morph-ghost")) { st.focusInput = false; $("input")?.focus({ preventScroll: true }); }
}
/** 文機能の要素（役割・重要度・接続などの項目）へフォーカスを移して巡る（dir は 1 か -1）。Enter でその要素をコメントの対象にする。
    Tab はブラウザの移動（次の入力欄・アドレスバー）に使われていて要素まで届かなかったので、←→ に割り当てた */
function stepClause(dir) {
  const cs = [...document.querySelectorAll("#detail .clause")];
  if (!cs.length) return;
  const i = cs.indexOf(document.activeElement);
  cs[i < 0 ? (dir > 0 ? 0 : cs.length - 1) : (i + dir + cs.length) % cs.length].focus();
}
/** 前後の文へ移る（dir は 1 か -1）。端では止まる */
function step(dir) {
  // 重要度のフィルターで外した文は飛ばす（外した文へ移ると、見えない文が選ばれて止まって見える）
  const shown = s => !(st.imp && st.impMode === "only") || !!$(`s-${s.sid}`)?.getClientRects().length;
  const list = st.doc.sentences.filter(s => s.sid === st.sel || shown(s)); if (!list.length) return;
  const i = st.sel ? list.findIndex(s => s.sid === st.sel) : -1;
  select(list[Math.max(0, Math.min(list.length - 1, i + dir))].sid, { scroll: true });
}
// 1〜4 のキーで開く右の欄の画面。左のアイコンの列の並びと同じ順
// 書く順（要件定義書 → 設計書 → 本文）に並べ、コメント一覧を最後に置く（要件だけの段階でも開いて返すようになったため）
const PANEL_KEYS = ["requirements", "design", "detail", "comments"];
function keyPanel(n) {
  st.docVer = { requirements: null, design: null };
  setPanel(PANEL_KEYS[n - 1]);
}
/** キーの案内を出し入れする（? キーと、アイコンの列の下のボタン）。ON のときだけ、操作できる所のすぐ側に小さなキーを添える。覚えたら OFF にして消せるよう、この画面を見る人の手元に覚えておく */
function toggleKeys(on = document.body.dataset.keys !== "on") {
  document.body.dataset.keys = on ? "on" : "off";
  $("kb-toggle").setAttribute("aria-pressed", String(on));
  try { localStorage.setItem("tsuzuri-keys", on ? "on" : "off"); } catch {}
}
// 欄の開閉はバネで縮めてから閉じる・開いてから伸ばす（motion.js）。すりガラス以外は即座に切り替わる
// 開閉のアイコンは押した瞬間に切り替える（欄の動きが終わるのを待たない）
function deselect(then) {
  const sid = st.sel;
  const finish = () => { st.sel = null; st.viewVer = null; st.draftTo = null; render(); if (sid) $(`s-${sid}`)?.focus({ preventScroll: true }); then?.(); };
  // 目次の今の段落のカードは、文詳細が閉じきるのを待たずに外した瞬間から消し始める（閉じきってからだと、消えるのが遅れて見えた）
  for (const b of $("toc").querySelectorAll('button[aria-current="true"]')) b.removeAttribute("aria-current");
  window.motion?.tocGlide();
  if (st.panel === "detail" && window.motion) window.motion.closeDetail(finish); else finish();
}
/** 右の欄の画面を替える（本文の文詳細・コメント一覧・要件定義書・設計書）。左のアイコンの列と道具の列のボタンが呼ぶ。
    閉じていた欄は伸びて出て、文を選んでいない本文へ戻るときは右へ畳んでから描き直す（前は畳む動き無しで一瞬で消えていた） */
function setPanel(next) {
  const wasClosed = st.closed, willClose = next === "detail" && !st.sel;
  // 真ん中が本文と文書（要件定義書・設計書）のあいだで入れ替わるときは、紙を頭から見せる。選んだ項目は画面を替えたら外す
  if (next !== st.panel) { st.docSel = null; if (DOC_VIEW[next] || DOC_VIEW[st.panel]) $("paper").scrollTop = 0; }
  // 欄の開閉と重なる切り替えは、アイコンの列の濃紺を欄と同じ進み具合で流す（liquid.js の flow）
  if (!wasClosed && willClose && window.motion) { window.liquid?.flow(next, "close"); return window.motion.closeDetail(() => { st.panel = next; render(); }); }
  st.panel = next; render();
  if (wasClosed && !st.closed) { window.liquid?.flow(next, "open"); window.motion?.openDetail(); }
}
/** 下に短い知らせを出す。action（{label, run}）を渡すと押せるボタンを添え、出している時間を延ばす（削除の「元に戻す」） */
function toast(msg, action = null, stay = false) {
  const t = $("toast");
  t.replaceChildren(document.createTextNode(msg));
  if (action) {
    const b = document.createElement("button"); b.type = "button"; b.className = "toast-act"; b.textContent = action.label;
    b.addEventListener("click", () => { t.classList.remove("on"); action.run(); }, { once: true });
    t.append(b);
  }
  t.classList.toggle("act", !!action); t.classList.add("on");
  clearTimeout(toast.t);
  if (!stay) toast.t = setTimeout(() => t.classList.remove("on"), action ? 6000 : 2200);
}
/** この画面が最後に書き込んだ時刻。書いた直後は呼んだ側が読み直すので、見張り（watchRecord）はその間は読み直さない */
let lastPostAt = -Infinity;
/** 表示中の文章を送信先に結び付け、別タブで切り替わったら読み直しを促す。 */
async function post(url, body) {
  lastPostAt = performance.now();
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ record: st.doc?.record, ...body }) });
  const data = await r.json();
  if (r.status === 409) throw new Error("別の文章が開かれている。画面を再読み込みすると最新の状態になる");
  if (!r.ok) throw new Error(data.error || "送れなかった");
  return data;
}
/**
 * 重要度の見方を本文に当てる。mark は body の data-imp で押した方以外を薄くし、only は data-show-imp で外す。
 * body の印に data-imp-only のようなボタンと同じ属性名を使うと、closest がどこを押しても body に当たった。
 * フィルターに入るときと出るときは、選んでいた文を外す（文の増減で並びが変わり、選択の白いカードが古い位置に残るため）
 */
/**
 * フィルターで本文の文が増減する前に、選んでいる文か本文の欄の一番上に見えている文と、その上端からの位置を覚える。
 * 切り替えると本文が短くなり、前のスクロール位置のままだと残った文より下を見ていて、利用者が上へ戻す必要があった
 */
function readingPlace() {
  const box = $("paper").getBoundingClientRect(), top = box.top;
  // 選んでいる文が見えていれば、それを目印にする（読んでいた所より、選んだ文の方が利用者の見ている場所に近い）
  const sel = st.sel && $(`s-${st.sel}`);
  if (sel?.getClientRects().length) {
    const r = sel.getBoundingClientRect();
    if (r.bottom > top && r.top < box.bottom) return { sid: st.sel, off: r.top - top };
  }
  for (const el of $("text").querySelectorAll(".s[data-sid]")) {
    if (!el.getClientRects().length) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom > top + 8) return { sid: el.dataset.sid, off: r.top - top };
  }
  return null;
}
/** 覚えた文を同じ高さへ戻す。その文が消えたら、文書の順で次に残っている文（無ければ前の文）を上に出す */
function keepPlace(place) {
  const paper = $("paper");
  const shown = sid => { const el = $(`s-${sid}`); return el && el.getClientRects().length ? el : null; };
  let el = place && shown(place.sid), off = place?.off ?? 0;
  if (place && !el) {
    const order = st.doc.sentences.map(s => s.sid), i = order.indexOf(place.sid);
    off = 16;
    for (let j = i + 1; j < order.length && !el; j++) el = shown(order[j]);
    for (let j = i - 1; j >= 0 && !el; j--) el = shown(order[j]);
  }
  if (!el) return paper.scrollTo({ top: 0, behavior: "instant" });
  paper.scrollTo({ top: paper.scrollTop + el.getBoundingClientRect().top - paper.getBoundingClientRect().top - off, behavior: "instant" });
}
function applyImp() {
  const only = !!(st.imp && st.impMode === "only"), wasOnly = !!document.body.dataset.showImp;
  const place = only !== wasOnly || only ? readingPlace() : null;
  if (st.imp && !only) document.body.dataset.imp = st.imp; else delete document.body.dataset.imp;
  if (only) document.body.dataset.showImp = st.imp; else delete document.body.dataset.showImp;
  document.querySelectorAll("[data-imp-focus]").forEach(b => b.setAttribute("aria-pressed", String(st.imp === b.dataset.impFocus)));
  document.querySelectorAll("[data-imp-mode]").forEach(b => b.setAttribute("aria-pressed", String(st.impMode === b.dataset.impMode)));
  // フィルターに入るときも出るときも本文の文が増減して並びが変わり、選んだ文に添う白いカードが古い位置に残る。
  // そのため、フィルターの有無が変わったら選択を外す（ハイライト同士の切り替えは並びが変わらないので外さない）
  if (only !== wasOnly && st.sel) return deselect(() => keepPlace(place));
  if (place) keepPlace(place);
}
/**
 * 変更の見方を替える。フィルター（only）は本文を変更した文だけの並びに替えるので、入るときと出るときは
 * 重要度のフィルターと同じく選択を外す（選んだ文に添う白いカードが古い位置に残るため）
 */
function setDiff(next) {
  const crossing = (next === "only") !== (st.diff === "only");
  const place = crossing ? readingPlace() : null;
  st.diff = next;
  if (crossing && st.sel) return deselect(() => keepPlace(place));
  render();
  if (place) keepPlace(place);
}
function jumpNext(test) {
  const list = st.doc.sentences, start = st.sel ? list.findIndex(s => s.sid === st.sel) : -1;
  for (let i = 1; i <= list.length; i++) { const s = list[(start + i) % list.length]; if (test(s)) return select(s.sid, { scroll: true }); }
}

document.addEventListener("click", async e => {
  const t = e.target;
  // 起点の回の一覧。見出しのボタンで開き、行で選んで閉じる。ページ送りは開いたまま
  if (t.closest("#round-btn")) {
    const open = !$("round-menu").classList.contains("on");
    if (open) { st.roundPage = Math.floor((Math.min(st.round, roundRows().length) - 1) / ROUND_PAGE); renderRoundList(); }
    return popMenu("round-menu", "round-btn", open);
  }
  const pick = t.closest("[data-pick-round]");
  if (pick) { st.round = +pick.dataset.pickRound; popMenu("round-menu", "round-btn", false); if (st.diff === "off") setDiff(st.diffMode); else render(); return $("round-btn")?.focus(); }
  const pg = t.closest("[data-round-page]");
  if (pg) { st.roundPage += +pg.dataset.roundPage; renderRoundList(); return $("round-list").querySelector("button")?.focus(); }
  if (!t.closest("#round-menu")) popMenu("round-menu", "round-btn", false);
  // 本文の見方と、起点の回（data-round は 1 でさかのぼる・-1 で新しい回へ）
  const dv = t.closest("[data-diff-row]");
  if (dv && dv.getAttribute("aria-disabled") !== "true") return setDiff(st.diff === "off" ? st.diffMode : "off");
  const dm = t.closest("[data-diff-mode]");
  if (dm) { st.diffMode = dm.dataset.diffMode; return setDiff(st.diff === "off" ? "off" : st.diffMode); }
  const rd = t.closest("[data-round]");
  if (rd && !rd.disabled) { st.round = Math.max(1, Math.min(roundMax(), st.round + +rd.dataset.round)); return render(); }
  // 文書の画面の項目か段落。真ん中で押したらその場で、右の欄の「担う文の無い項目」から押したら真ん中の塊まで送る
  const di = t.closest("[data-doc]");
  if (di) return selectDoc(di.dataset.doc, { scroll: !di.closest("#text") });
  const sb = t.closest(".s[data-sid]");
  if (sb) return sb.dataset.sid === st.sel ? deselect() : select(sb.dataset.sid);
  const jump = t.closest("[data-jump]");
  if (jump && jump.getAttribute("aria-disabled") !== "true") { const [kind, key] = jump.dataset.jump.split(":"); return jumpNext(s => !isBlock(s) && (kind === "role" ? roleKey(s) === key || subRoleKeys(s).includes(key) : notesOf(s).includes(key))); }
  // 重要度の行は切り替え。押した方の文だけ濃く残す。もう一度押すと戻す
  const imp = t.closest("[data-imp-focus]");
  if (imp && imp.getAttribute("aria-disabled") !== "true") {
    st.imp = st.imp === imp.dataset.impFocus ? null : imp.dataset.impFocus;
    return applyImp();
  }
  const mode = t.closest("[data-imp-mode]");
  if (mode) { st.impMode = mode.dataset.impMode; return applyImp(); }
  const view = t.closest("[data-open-only]");
  if (view) {
    st.openOnly = view.dataset.openOnly === "1";
    try { localStorage.setItem("tsuzuri-open-only", st.openOnly ? "on" : "off"); } catch {}
    return render();
  }
  const go = t.closest("[data-goto]");
  if (go) return select(go.dataset.goto, { scroll: true });
  // 文詳細の「全文で表示」。文が照らしたバージョンの全文を開き、切り出した項目か段落まで送る
  const open = t.closest("[data-open]");
  if (open) {
    const [view, id, key] = open.dataset.open.split(":");
    st.docVer = { requirements: null, design: null, [view]: id };
    // 画面を替えると選んだ項目が外れる（setPanel）ので、替えてから選ぶ。前は順が逆で、「全文で表示」で移った先の項目が選ばれていなかった
    setPanel(view);
    st.docSel = `${view}:${key}`; render();
    return $(`s-${view}-${key}`)?.scrollIntoView({ block: "center" });
  }
  // 左のアイコンから開く全文は、いつも最新のバージョン
  if (t.closest("#kb-toggle")) return toggleKeys();
  const rail = t.closest("[data-rail]");
  if (rail) { st.docVer = { requirements: null, design: null }; return setPanel(rail.dataset.rail); }
  const panel = t.closest("[data-panel]");
  if (panel) { st.docVer = { requirements: null, design: null }; return setPanel(st.panel === panel.dataset.panel ? "detail" : panel.dataset.panel); }
  const to = t.closest("[data-to]");
  if (to) { st.draftTo = st.draftTo === to.dataset.to ? null : to.dataset.to; const keep = $("input")?.value || ""; renderDetail(); $("input").value = keep; return $("input").focus(); }
  const ver = t.closest("[data-ver]");
  if (ver) { st.viewVer = ver.dataset.ver; return render(); }
  // 削除は確かめの窓を出さずにすぐ消し、6秒のあいだ「元に戻す」を出す。戻すときは同じ中身で書き直す（番号は新しくなる）
  const del = t.closest("[data-del]");
  if (del) {
    // 先に行を縮めて消してから描き直す
    const record = st.doc.record;
    await window.motion?.collapseOut(del.closest("li"));
    try {
      const gone = await post(`/api/comments/${encodeURIComponent(del.dataset.del)}/delete`, { record });
      await loadDoc(); render();
      toast("コメントを削除した", { label: "元に戻す", run: async () => {
        try {
          const back = await post("/api/comments", { record, ...(gone.doc ? { doc: gone.doc, ver: gone.ver, item: gone.item, text: gone.text }
            : { sid: gone.sid, ver: gone.ver, to: gone.to, text: gone.text }) });
          if (gone.status === "resolved") await post(`/api/comments/${encodeURIComponent(back.id)}/status`, { record, status: "resolved" });
          await loadDoc(); render(); toast("元に戻した");
        } catch (err) { toast(err.message); }
      } });
    } catch (err) { toast(err.message); }
    return;
  }
  const status = t.closest("[data-status]");
  if (status) {
    const record = st.doc.record;
    const [id, value] = status.dataset.status.split(":");
    await window.motion?.collapseOut(status.closest("li"));   // 解決・未解決で一覧を移るときも、元の場所では縮めて消す
    try { await post(`/api/comments/${encodeURIComponent(id)}/status`, { record, status: value }); await loadDoc(); render(); toast(value === "resolved" ? "解決にした" : "未解決に戻した"); }
    catch (err) { toast(err.message); }
  }
});

document.addEventListener("submit", async e => {
  e.preventDefault();
  if (e.target.id !== "form") return;   // コメントの送信だけを受ける
  if (DOC_VIEW[st.panel]) return sendDocComment(e.target);
  const input = $("input"), text = input.value.trim(), s = sentence(st.sel);
  if (!text || !s) return;
  const v = s.versions.find(x => x.ver === st.viewVer) || latest(s);
  const btn = e.target.querySelector(".send"); btn.disabled = true;
  try {
    await post("/api/comments", { sid: s.sid, ver: v.ver, to: st.draftTo, text });
    st.draftTo = null; delete st.drafts[s.sid]; await loadDoc(); render(); toast("コメントを残した");
  } catch (err) { toast(err.message); btn.disabled = false; }
});

// 書きかけのコメントを文ごとに残す。別の文へ移って戻っても消えない
document.addEventListener("input", e => {
  if (e.target.id !== "input") return;
  if (DOC_VIEW[st.panel] && st.docSel) st.drafts[`${st.docSel}@${docItems(st.panel).id}`] = e.target.value;
  else if (st.sel) st.drafts[st.sel] = e.target.value;
});

// キーボードだけで操作を完結させる。画面では ? で各所にキーを添える
document.addEventListener("keydown", e => {
  if (e.isComposing || e.keyCode === 229) return;   // 変換中のキーは IME に任せる（Enter で確定するたびに送ったり移ったりしない）
  const typing = e.target.matches("textarea, input");
  const arrow = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
  if (typing) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); return $("form")?.requestSubmit(); }
    // Esc の1回目はコメント欄から本文の文へ戻す。2回目（文の上）で選択を外す
    if (e.key === "Escape") {
      e.preventDefault(); e.target.blur();
      if (DOC_VIEW[st.panel]) return st.docSel && $(`s-${st.docSel.replace(":", "-")}`)?.focus({ preventScroll: true });
      return st.sel && $(`s-${st.sel}`)?.focus({ preventScroll: true });
    }
    // 空のコメント欄では ↑↓ で前後の文へ。書きかけのときは字の中のカーソル移動に残し、Alt+↑↓ で移る（書きかけは文ごとに残る）
    if (arrow && (e.altKey || !e.target.value)) { e.preventDefault(); return DOC_VIEW[st.panel] ? stepDoc(arrow) : step(arrow); }
    const side = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (side && st.sel && !e.target.value) { e.preventDefault(); return stepClause(side); }
    if (e.altKey && /^[1-4]$/.test(e.key)) { e.preventDefault(); return keyPanel(+e.key); }
    return;
  }
  if (e.ctrlKey || e.metaKey) return;
  if (e.key === "Escape") { document.body.classList.add("notip"); addEventListener("pointermove", () => document.body.classList.remove("notip"), { once: true }); }
  // 文書の画面では ↑↓ で項目か段落を移り、Enter で選び、Esc で選択を外す
  if (DOC_VIEW[st.panel]) {
    if (arrow) { e.preventDefault(); return stepDoc(arrow); }
    if (e.key === "Enter" && e.target.dataset?.doc) return selectDoc(e.target.dataset.doc);
    if (e.key === "Escape" && st.docSel) { st.docSel = null; return render(); }
  }
  if (e.key === "Escape" && st.sel) return deselect();
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".clause")) { e.preventDefault(); return e.target.click(); }
  if (e.key === "Enter" && e.target.dataset?.sid) return e.target.dataset.sid === st.sel ? deselect() : select(e.target.dataset.sid);
  if (arrow) { e.preventDefault(); return step(arrow); }
  const side = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
  if (side && st.sel) { e.preventDefault(); return stepClause(side); }
  if (/^[1-4]$/.test(e.key)) { e.preventDefault(); return keyPanel(+e.key); }
  if (e.key === "?") { e.preventDefault(); return toggleKeys(); }
  // d で本文・変更のハイライト・変更のフィルターを巡り、[ と ] で起点の回をさかのぼる・戻る
  if (e.key === "d") { e.preventDefault(); const next = { off: "mark", mark: "only", only: "off" }[st.diff]; if (next !== "off") st.diffMode = next; return setDiff(next); }
  if ((e.key === "[" || e.key === "]") && st.diff !== "off") { e.preventDefault(); st.round = Math.max(1, Math.min(roundMax(), st.round + (e.key === "[" ? 1 : -1))); return render(); }
});


// 紙の質感（字の下の canvas の層・ごく薄い粒）。紙の大きさが変わったら描き直す
function grain() {
  const c = $("grain"), r = c.getBoundingClientRect();
  if (!r.width || !r.height) return;
  c.width = Math.round(r.width); c.height = Math.round(r.height);
  const x = c.getContext("2d"), img = x.createImageData(c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 9; }
  x.putImageData(img, 0, 0);
}

// バネの曲線を CSS の linear() にして --spring に入れる。spring(280, 28)・質量1 は減衰比 約0.84 で、わずかに行き過ぎて戻る
// （design-library の animations/modal-family.md のモーションリファレンス ui-modal の値）
function springEasing(k = 280, c = 28, m = 1, steps = 60) {
  let x = 0, v = 0; const dt = 1 / 2400, pts = [];
  let t = 0, settle = 0;
  while (t < 2) { for (let i = 0; i < 8; i++) { const a = (-k * (x - 1) - c * v) / m; v += a * dt; x += v * dt; t += dt; } pts.push(x); if (Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.01) { settle = t; break; } }
  const n = pts.length; steps = Math.min(steps, n - 1); const pick = Array.from({ length: steps + 1 }, (_, i) => pts[Math.min(n - 1, Math.round(i * (n - 1) / steps))]);
  document.documentElement.style.setProperty("--spring", `linear(0, ${pick.slice(1).map(p => p.toFixed(4)).join(", ")})`);
}
springEasing();

// アプリとして入れた窓で、サーバーが止まったときに札を出す worker（sw.js）。入らない環境（http の別名など）では何もしない
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

(async () => {
  try {
    let keys = "off";
    try { keys = localStorage.getItem("tsuzuri-keys") || "off"; } catch {}
    toggleKeys(keys === "on");
    // アイコンと記録は並べて取る。オープニングまでの地だけの時間を縮めるため（順に取ると約0.1秒余計に待った）
    const doc = loadDoc();
    doc.catch(() => {});  // 失敗は下の await doc で受ける。アイコンを待つ間に失敗しても、扱われない拒否として出さない
    await loadIcons();
    new ResizeObserver(grain).observe($("paper"));
    await doc; st.panel = firstPanel(); render();
    await Opening.play();
  } catch (err) {
    // 記録を渡さずにサーバーを起動したときは、ライブラリから始める。オープニングが終わってから窓を開き、2つの登場を重ねない
    if (err.noRecord) { setHTML($("text"), `<p class="empty">ライブラリから文章を選択すると、ここに本文が表示される。</p>`); await Opening.play(); return openRecords(); }
    setHTML($("text"), `<p class="empty">文章を読み込めなかった。${esc(err.message)}</p>`);
    await Opening.play();
  }
})();

// --- 書き換わったら読み直す ------------------------------------------------
// Claude Code が裏で書き直したり yomiyasu の直しを積んだりしたとき、開いたままの画面を自分で新しくする
// サーバーは記録のフォルダの更新時刻だけを返すので、2秒おきに聞いても軽い。
// 窓が裏にある間は聞かず、表に戻ったときに1回聞く。コメントを書いている途中は描き直すと字と位置が飛ぶので、欄を離れるまで待つ
const WATCH_MS = 2000;
let watching = false;
async function watchRecord() {
  if (watching || !st.doc || document.hidden) return;
  if (document.activeElement?.matches?.("textarea, input")) return;
  watching = true;
  try {
    const r = await fetch("/api/stamp");
    if (!r.ok) return;
    const { path, stamp } = await r.json();
    if ((path === st.doc.record && stamp === st.doc.stamp) || performance.now() - lastPostAt < 3 * WATCH_MS) return;
    if (path !== st.doc.record && Object.values(st.drafts).some(Boolean)) return;
    if (path !== st.doc.record) {
      Object.assign(st, { sel: null, viewVer: null, docSel: null, drafts: {}, draftTo: null,
        docVer: { requirements: null, design: null } });
    }
    await loadDoc(); render();
    toast("更新されたため再読み込みした");
  } catch {
    // サーバーが止まっている間は何もしない。止まった札は service worker が出す
  } finally {
    watching = false;
  }
}
setInterval(watchRecord, WATCH_MS);

// --- アプリが更新されたら知らせる -------------------------------------------
// PWA の窓には再読み込みのボタンが無く、アプリのファイルが直っても開いている画面は古いまま動く。
// サーバーが返す画面のファイルの版が、開いたときと変わったら、押すと読み込み直すボタンを付けて知らせる（消えずに残す）。
// 記録の書き換えは watchRecord が自動で読み直すので、ここはアプリそのものの更新だけを見る
let appVersion = null, appNotified = false;
async function watchApp() {
  if (appNotified || document.hidden) return;
  try {
    const r = await fetch("/api/app");
    if (!r.ok) return;
    const { version } = await r.json();
    if (appVersion === null) { appVersion = version; return; }
    if (version === appVersion) return;
    appNotified = true;
    toast("アプリが更新された", { label: "更新", run: () => location.reload() }, true);
  } catch { /* サーバーが止まっている間は何もしない */ }
}
// 1秒ごと。/api/app は画面のファイルの一覧の更新時刻を読むだけで、手元で1回およそ13ミリ秒だった
watchApp();
setInterval(watchApp, 1000);
document.addEventListener("visibilitychange", watchApp);
window.addEventListener("focus", watchApp);
document.addEventListener("visibilitychange", watchRecord);

// --- ライブラリ -----------------------------------------------------------
// これまで tsuzuri で書いた文章を、アプリの中から選んで開く（AI 経由でしか開けないと不便なため）。
// 画面の名前は「ライブラリ」。文章・テンプレート・校正辞書・プロンプトと、使う人ごとに育つものを切り替えて見るので、
// 文章だけを指す「文章一覧」から改めた。中の「記録」は作る側の呼び名なので画面に出さない。
// 一覧は init と、この画面で開いた文章が足していく（tsuzuri.py の register_record）。並びは最近書いた順で、説明は付けない
// 部品は <dialog> の showModal: 開いている間は後ろを操作させず、Esc で閉じる（design-library の parts/modal.md）。
// 文章が1つも開いていないときは閉じさせない（閉じても何も出せる物が無いため）
let records = { current: null, rows: [] };
function fmtRecordTime(sec) {
  const d = new Date(sec * 1000), now = new Date();
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === now.toDateString() ? `今日 ${hm}` : `${d.getFullYear() === now.getFullYear() ? "" : d.getFullYear() + "/"}${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
// パスは長いので、見分けに効く末尾を残して頭を「…」で切る（右から左の向きで切る）。そのままだと先頭の / が右端へ回るので、
// 左から右の向きの印（U+200E）で挟んで字の並びを保つ。ホームは ~ に縮める
const shortPath = p => "‎" + p.replace(/^\/home\/[^/]+/, "~") + "‎";
// 検索は、全角半角と大文字小文字をそろえ、カタカナをひらがなに寄せて部分一致で見る（design-library の knowledge/layout/ja-incremental-search.md の3節）。
// 漢字の語を読みで当てる辞書は持たない（標準の範囲で作れず、件数も数十の想定のため）。空白で区切った語は全部含むものを残す
const fold = t => t.normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
/** 1つの欄の中で、最初に当たった語の前後を少しだけ切り出して印を付ける（題以外で当たったとき、どこで当たったかを見せる） */
function snippet(text, terms, width = 26) {
  const f = fold(text);
  const hit = terms.map(t => [f.indexOf(t), t.length]).filter(([i]) => i >= 0).sort((a, b) => a[0] - b[0])[0];
  if (!hit) return null;
  const [i, n] = hit, from = Math.max(0, i - width), to = Math.min(text.length, i + n + width);
  return `${from ? "…" : ""}${esc(text.slice(from, i))}<mark>${esc(text.slice(i, i + n))}</mark>${esc(text.slice(i + n, to))}${to < text.length ? "…" : ""}`;
}
/** 題の中の当たった語に印を付ける。NFKC で字数が変わる字（合字など）の多い題では、位置がずれないよう印を付けない */
function markTitle(title, terms) {
  const f = fold(title);
  if (f.length !== title.length || !terms.length) return esc(title);
  const on = new Array(title.length).fill(false);
  for (const t of terms) for (let i = f.indexOf(t); i >= 0; i = f.indexOf(t, i + 1)) for (let k = i; k < i + t.length; k++) on[k] = true;
  let out = "", open = false;
  for (let k = 0; k < title.length; k++) {
    if (on[k] !== open) { out += on[k] ? "<mark>" : "</mark>"; open = on[k]; }
    out += esc(title[k]);
  }
  return out + (open ? "</mark>" : "");
}
function recordRow(r, current, terms) {
  const here = r.path === current, title = r.title || r.name;
  if (!r.exists) {
    return `<li class="rec gone"><div class="rec-main"><span class="rec-t">${esc(r.name)}</span><span class="rec-p" title="${esc(r.path)}">${esc(shortPath(r.path))}</span>
      <span class="rec-m">開けない。文章が存在しないか、内容を読み込めない</span></div>
      <button type="button" class="rec-forget" data-rec-forget="${esc(r.path)}">一覧から外す</button></li>`;
  }
  // 題で当たらなかった語は、依頼・本文のどこで当たったかを1行で見せる。語が無いときは依頼を1行で見せる（何の文章かが分かるように）
  const inTitle = terms.length && terms.every(t => fold(title).includes(t));
  const sub = !terms.length || inTitle ? (r.request ? esc(r.request) : "") : (snippet(r.request || "", terms) ?? snippet(r.text || "", terms) ?? snippet(r.path, terms) ?? "");
  return `<li class="rec"><button type="button" class="rec-main" data-rec-open="${esc(r.path)}"${here ? ' aria-current="true"' : ""}>
    <span class="rec-t">${markTitle(title, terms)}${here ? `<span class="rec-now" title="表示中"><span class="ic">${icons.check || ""}</span><span class="vh">表示中</span></span>` : ""}</span>
    ${sub ? `<span class="rec-s">${sub}</span>` : ""}
    <span class="rec-m"><span>${fmtRecordTime(r.updated)}</span><span>${r.sentences}文</span>${r.open ? `<span class="rec-open">未解決のコメント ${r.open}</span>` : ""}<span class="rec-p" title="${esc(r.path)}">${esc(shortPath(r.path))}</span></span>
  </button></li>`;
}
// ライブラリの画面では、文章のほかに、テンプレート・校正辞書・プロンプトも見せる。どちらも使う人ごとに育っていく設定で、
// どの文章にも属さないので、文章ごとのアイコンの列ではなくこの画面に並べる。アプリは見せるだけで、足す・直すは AI かファイルで行う
// （アプリが書き込む先はコメントだけのまま）。切り替えはコメント一覧の「すべて・未解決」と同じ部品にする
const REC_VIEWS = [["records", "records", "文章", "タイトル・依頼・本文から検索"], ["templates", "template", "テンプレート", "名前・用途・内容から検索"],
  ["dictionary", "dictionary", "校正辞書", "探す形・直す先・補足から検索"], ["prompts", "note-ai", "プロンプト", "名前・使う場面・本文から検索"]];
// recTplPage は中身を開く前のページ。一覧へ戻ったときに同じページと行へ戻すため
let recTplPage = 0, recView = "records", recTpl = null, catalog = { templates: [], userDir: "", dict: [], userPath: "", prompts: [] };
function renderRecView() {
  const n = { records: records.rows.length, templates: catalog.templates.length, dictionary: catalog.dict.length, prompts: catalog.prompts.length };
  setHTML($("rec-view"), REC_VIEWS.map(([key, icon, word]) => `<button type="button" class="key" data-rec-view="${key}" aria-pressed="${recView === key}" style="--k: var(--navy)"><span class="w">${ic(icon, "ic mark")}${word}</span><span class="n"><b>${n[key]}</b><i>件</i></span></button>`).join(""));
  const [, , word, hint] = REC_VIEWS.find(([key]) => key === recView);
  $("rec-q").placeholder = hint;
  $("rec-q").setAttribute("aria-label", `${word}を検索`);
}
/** テンプレートの一覧か、選んだテンプレートの中身を描く。自分のテンプレートは標準の同じ名前のものを置き換える */
function renderTemplates(terms) {
  const note = $("rec-note");
  note.hidden = false;
  setHTML(note, `自分のテンプレートは <code>${esc(shortPath(catalog.userDir))}</code> に Markdown で配置する。ファイル名がテンプレートの名前になる。追加・修正するときは、AI に依頼するかファイルを直接編集する。`);
  const t = recTpl && catalog.templates.find(x => x.name === recTpl);
  if (t) {
    $("rec-none").hidden = true;
    setHTML($("rec-list"), `<li class="rec tpl-open"><div class="tpl-head"><button type="button" class="rec-back" data-tpl-back>${ic("chevron-left")}テンプレート一覧</button>
      <span class="rec-t">${esc(t.name)}<span class="rec-src">${t.source}</span></span><span class="rec-p" title="${esc(t.path)}">${esc(shortPath(t.path))}</span></div>
      ${t.error ? `<p class="rec-open">${esc(t.error)}</p>` : `<pre class="tpl-body">${esc(t.text)}</pre>`}</li>`);
    return;
  }
  const hay = x => fold([x.name, x.scene, x.text].join("\n"));
  const rows = terms.length ? catalog.templates.filter(x => terms.every(w => hay(x).includes(w))) : catalog.templates;
  setHTML($("rec-list"), rows.map(x => `<li class="rec"><button type="button" class="rec-main" data-tpl="${esc(x.name)}">
    <span class="rec-t">${markTitle(x.name, terms)}<span class="rec-src">${x.source}</span></span>
    ${x.scene ? `<span class="rec-s">${esc(x.scene)}</span>` : ""}
    <span class="rec-m">${x.error ? `<span class="rec-open">${esc(x.error)}</span>` : ""}${x.replaces ? "<span>標準の同じ名前のテンプレートの代わりに使用</span>" : ""}<span class="rec-p" title="${esc(x.path)}">${esc(shortPath(x.path))}</span></span></button></li>`).join(""));
  $("rec-none").hidden = rows.length > 0;
  if (!rows.length) setHTML($("rec-none"), `「${esc($("rec-q").value.trim())}」が入ったテンプレートは無い。<button type="button" id="rec-clear">検索を解除</button>`);
}
/** 校正辞書の行を、自分の辞書を先にして描く。壊れた行は誤りを添えて出す（語をそろえる段階で止まる行を見つけられるように） */
function renderDictionary(terms) {
  const note = $("rec-note"), mine = catalog.dict.some(r => r.source === "自分");
  note.hidden = false;
  setHTML(note, `自分の校正辞書は <code>${esc(shortPath(catalog.userPath))}</code>${mine ? "" : "（まだ無い）"}。1行に「探す形・直す先・補足」をタブ区切りで記入し、探す形は正規表現。修正するかどうかは AI が前後を読んで判断する。`);
  const hay = r => fold([r.pattern, r.to, r.note].join("\n"));
  const all = [...catalog.dict].sort((a, b) => (a.source === "自分" ? 0 : 1) - (b.source === "自分" ? 0 : 1));
  const rows = terms.length ? all.filter(r => terms.every(w => hay(r).includes(w))) : all;
  setHTML($("rec-list"), rows.map(r => `<li class="rec dict"><div class="rec-main"><span class="rec-t"><code>${esc(r.pattern)}</code><span class="dict-to">→ ${esc(r.to)}</span><span class="rec-src">${r.source}</span></span>
    ${r.note ? `<span class="rec-s">${esc(r.note)}</span>` : ""}${r.error ? `<span class="rec-m"><span class="rec-open">${esc(r.error)}</span><span class="rec-p">${esc(shortPath(r.where))}</span></span>` : ""}</div></li>`).join(""));
  $("rec-none").hidden = rows.length > 0;
  if (!rows.length) setHTML($("rec-none"), `「${esc($("rec-q").value.trim())}」が入った行は無い。<button type="button" id="rec-clear">検索を解除</button>`);
}
/** ほかのチャット AI に貼るプロンプトを、中身を読める形で並べ、行ごとにコピーできるようにする。
 * 貼る前に何を貼るかを確かめられるよう、ボタンだけでなく本文も出す。本文はスキルの参考資料から読む（アプリに写しを持たない） */
function renderPrompts(terms) {
  const note = $("rec-note");
  note.hidden = false;
  setHTML(note, "返ってきた答えと文章を AI に渡して「tsuzuri で読んで」と依頼すると、推測ではなく書いた AI の申告から執筆意図を記録する。");
  const hay = x => fold([x.name, x.scene, x.text].join("\n"));
  const rows = terms.length ? catalog.prompts.filter(x => terms.every(w => hay(x).includes(w))) : catalog.prompts;
  setHTML($("rec-list"), rows.map((x, i) => `<li class="rec tpl-open"><div class="tpl-head">
      <span class="rec-t">${markTitle(x.name, terms)}</span><span class="rec-s">${esc(x.scene)}</span>
      <button type="button" class="rec-back" data-prompt-copy="${i}">${ic("copy")}コピー</button></div>
      <pre class="tpl-body">${esc(x.text)}</pre></li>`).join(""));
  $("rec-none").hidden = rows.length > 0;
  if (!rows.length) setHTML($("rec-none"), `「${esc($("rec-q").value.trim())}」が入ったプロンプトは無い。<button type="button" id="rec-clear">検索を解除</button>`);
  renderPrompts.rows = rows;
}
/** 検索の欄の語で一覧を描き直す。0件なら、当たらなかった語と、検索を解除ボタンを出す（ja-incremental-search.md の5節） */
function renderRecords() {
  const q = $("rec-q").value, terms = fold(q).split(/\s+/).filter(Boolean);
  renderRecView();
  $("records").dataset.view = recView;
  if (recView !== "records") {
    ({ templates: renderTemplates, dictionary: renderDictionary, prompts: renderPrompts })[recView](terms);
    recPage = 0;
    if ($("records").open) paginateRecords(false);
    return;
  }
  $("rec-note").hidden = true;
  const hay = r => fold([r.title, r.name, r.path, r.request, r.text].filter(Boolean).join("\n"));
  const rows = terms.length ? records.rows.filter(r => terms.every(t => hay(r).includes(t))) : records.rows;
  setHTML($("rec-list"), rows.map(r => recordRow(r, records.current, terms)).join(""));
  const none = $("rec-none");
  none.hidden = rows.length > 0;
  if (!rows.length) {
    setHTML(none, records.rows.length ? `「${esc(q.trim())}」が入った文章は無い。<button type="button" id="rec-clear">検索を解除</button>` : "まだ文章が無い。tsuzuri で執筆すると、ここに並ぶ。");
  }
  // 絞り直したら1ページ目から。開いた直後は表示中の文章が載るページを開く
  recPage = 0;
  if ($("records").open) paginateRecords(!terms.length);
}
// ページ送り。一覧は窓に収まる分ずつ見せ、中ではスクロールさせない（中身が増えても収まるようにページングにする）。
// 作りは imozuru のサイドバーと同じで、1ページの件数を決めず、一覧の高さに収まるまで行の実際の高さを積んで区切る
// （行は依頼の1行の有無で高さが変わるので、件数で切ると最後の行がはみ出すか、底が空く）。
let recPage = 0, recPages = [[]], recTurnUntil = 0;
function paginateRecords(keepCurrent) {
  const list = $("rec-list"), items = [...list.children].filter(el => el.matches("li"));
  items.forEach(li => { li.hidden = false; });
  const room = list.clientHeight, gap = parseFloat(getComputedStyle(list).rowGap) || 0;
  // 開いた直後のダイアログは登場の動き（scale .96 から）の途中で、getBoundingClientRect は縮んだ大きさを返す。縮小の分を戻して測る
  // （戻さないと行を多めに積み、最後の行が一覧の底からはみ出した）
  const sc = list.getBoundingClientRect().height / (list.offsetHeight || 1) || 1;
  recPages = [[]];
  let h = 0;
  for (const li of items) {
    // 高さは端数まで測る。offsetHeight は整数に丸めるので、行が多いと合計が数 px 足りずにはみ出す
    const own = li.getBoundingClientRect().height / sc, x = own + (recPages.at(-1).length ? gap : 0);
    if (h + x > room && recPages.at(-1).length) { recPages.push([]); h = own; } else h += x;
    recPages.at(-1).push(li);
  }
  if (keepCurrent) { const i = recPages.findIndex(p => p.some(li => li.querySelector('[aria-current="true"]'))); if (i >= 0) recPage = i; }
  showRecordPage(recPage);
}
function showRecordPage(n) {
  const from = recPage;
  recPage = Math.max(0, Math.min(recPages.length - 1, n));
  recPages.forEach((p, i) => p.forEach(li => { li.hidden = i !== recPage; }));
  // ページを送った向きから行を流し込む。次のページは下から、前のページは上から、
  // 行ごとに少しずつ遅らせてバネで着く。前のページの行は待たずに消す（消える動きを待つと、続けて送ったときに遅れが積もる）
  const dir = Math.sign(recPage - from);
  if (dir && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const ease = getComputedStyle(document.body).getPropertyValue("--spring").trim() || "cubic-bezier(.2,.8,.2,1)";
    // 出だしを透明にすると、送った直後に一覧が丸ごと空になるコマが出た（motion-check で 4469ms）。薄く見えるところから始める
    recPages[recPage].forEach((li, i) => li.animate([{ transform: `translateY(${dir * 22}px)`, opacity: .35 }, { transform: "none", opacity: 1 }],
      { duration: 380, easing: ease, delay: (dir > 0 ? i : recPages[recPage].length - 1 - i) * 22, fill: "backwards" }));
    // 行が着くまでホバーの液体を止める。止めないと、まだ行の来ていない所に液体だけが浮いた
    recTurnUntil = performance.now() + 320;
  }
  // 1ページで収まるときも場所は取ったまま隠す。出し入れすると一覧の高さが変わり、区切った行がはみ出す
  const pager = $("rec-pager"), many = recPages.length > 1;
  pager.classList.toggle("one", !many);
  if (many) {
    if (document.activeElement !== $("rec-pg-n")) $("rec-pg-n").value = recPage + 1;
    $("rec-pg-t").textContent = recPages.length;
    pager.querySelector('[data-rec-page="-1"]').disabled = recPage <= 0;
    pager.querySelector('[data-rec-page="1"]').disabled = recPage >= recPages.length - 1;
  }
  recHover();
}
// 行から行へのホバーは、押すと開くメニューと同じ液体で流す。
// 一覧は描き直すたびに液体の層を頭へ戻す。層の大きさは CSS で一覧いっぱいにする。前は一覧の scrollHeight を層の高さに書いていて、
// 一覧を描くのがダイアログを開く前（一覧の高さ 0）だったため層が 0px のまま固まり、液体が見えなくなっていた
let recLayer = null, recHov = null;
function recHover() {
  const list = $("rec-list");
  if (!recHov && window.liquid?.pair) {
    recLayer = window.liquid.layer(list, "hov rec-goo");
    recHov = window.liquid.pair(recLayer, { head: { k: 560, c: 30 }, tail: { k: 360, c: 28 } });
    const row = e => e.target instanceof Element ? e.target.closest("button.rec-main") : null;
    list.addEventListener("pointerover", e => { const b = row(e); if (b && performance.now() >= recTurnUntil) recHov.to(b); });
    // ページを送った直後に止めた分は、行が着いたあとにマウスの下の行へ流す
    list.addEventListener("pointermove", e => { const b = row(e); if (b && performance.now() >= recTurnUntil && recHov.at !== b) { recHov.at = b; recHov.to(b); } });
    list.addEventListener("pointerleave", () => recHov.hide());
    list.addEventListener("focusin", e => { const b = row(e); if (b?.matches(":focus-visible")) recHov.to(b); });
  }
  if (!recHov) return;
  if (recLayer.parentElement !== list) list.prepend(recLayer);
  recHov.hide(true); recHov.at = null;
}
async function openRecords() {
  const dlg = $("records");
  try {
    const r = await fetch("/api/records"), body = await r.json();
    if (!r.ok) throw new Error(body.error);
    records = { current: body.current, rows: body.records };
    dlg.dataset.current = body.current || "";
    // テンプレートと校正辞書は開くたびに読み直す（AI やファイルの編集で増えたものをすぐ見せるため）。読めなくてもライブラリは出す
    // 片方の取得が落ちても（接続が切れる・JSON でない応答）、もう片方とライブラリは出すため、別々に受ける
    const load = async (url, what, apply) => {
      try {
        const r = await fetch(url), b = await r.json();
        if (!r.ok) throw new Error(b.error);
        apply(b);
      } catch (err) { toast(`${what}を読み込めなかった。${err.message}`); }
    };
    await Promise.all([
      load("/api/templates", "テンプレート", b => Object.assign(catalog, { templates: b.templates, userDir: b.user_dir })),
      load("/api/dictionary", "校正辞書", b => Object.assign(catalog, { dict: b.rows, userPath: b.user_path })),
      load("/api/prompts", "プロンプト", b => Object.assign(catalog, { prompts: b.prompts })),
    ]);
    $("records-close").hidden = !body.current;
    renderRecords();
  } catch (err) { toast(`ライブラリを読み込めなかった。${err.message}`); }
  if (!dlg.open) dlg.showModal();
  // 行の高さはダイアログが開いてからでないと測れないので、区切るのは開いたあと
  paginateRecords(true);
  // 探してから選ぶことが多いので、最初は検索の欄にフォーカスする。↓ で一覧へ移る
  $("rec-q").focus();
}
function closeRecords() {
  const dlg = $("records");
  if (!dlg.dataset.current || !dlg.open) return;
  dlg.classList.add("closing");
  setTimeout(() => { dlg.classList.remove("closing"); dlg.close(); $("open-records").focus({ preventScroll: true }); }, 140);
}
/** 選んだ文章を開き、画面の状態（選んだ文・開いている欄・差分の見方・書きかけのコメント）を初めからにする */
async function switchRecord(path) {
  try {
    const opened = await post("/api/records/open", { path });
    Object.assign(st, { sel: null, viewVer: null, draftTo: null, panel: "detail", docSel: null, docVer: { requirements: null, design: null },
      diff: "off", round: 1, roundPage: 0, drafts: {}, texts: {}, imp: null });
    delete document.body.dataset.imp;
    await loadDoc(); st.panel = firstPanel(); render();
    $("paper").scrollTop = 0;
    $("records").dataset.current = opened.path;
    closeRecords();
    toast(`「${opened.title || opened.name}」を開いた`);
  } catch (err) { toast(err.message); }
}
/** 人から受け取った .tsz をサーバーに渡して展開し、その文章を開く。ブラウザはファイルの場所を渡せないので中身を送る */
async function importShared(file) {
  if (!file) return;
  if (!file.name.endsWith(".tsz")) return toast("共有ファイル（.tsz）を選択してください");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // 大きいファイルで引数の上限を超えないよう、区切って base64 にする
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const opened = await post("/api/records/unpack", { name: file.name, data: btoa(bin) });
    await switchRecord(opened.path);
  } catch (err) { toast(err.message); }
}
$("rec-import-file").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; importShared(f); });
// ライブラリにファイルを落としても開く
$("records").addEventListener("dragover", e => { if ([...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
$("records").addEventListener("drop", e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); importShared(e.dataTransfer.files[0]); });
document.addEventListener("click", async e => {
  if (e.target.closest("#open-records")) return openRecords();
  if (e.target.closest("#rec-import")) return $("rec-import-file").click();
  const promptCopy = e.target.closest("[data-prompt-copy]");
  if (promptCopy) {
    const x = renderPrompts.rows?.[Number(promptCopy.dataset.promptCopy)];
    try { await navigator.clipboard.writeText(x.text); toast(`「${x.name}」をコピーした。チャット AI の会話に貼って送る`); }
    catch (err) { toast(`コピーできなかった。${err.message}`); }
    return;
  }
  if (e.target.closest("#records-close")) return closeRecords();
  const recPg = e.target.closest("[data-rec-page]");
  if (recPg) return showRecordPage(recPage + Number(recPg.dataset.recPage));
  if (e.target.closest("#rec-clear")) { $("rec-q").value = ""; renderRecords(); return $("rec-q").focus(); }
  const view = e.target.closest("[data-rec-view]");
  if (view) { recView = view.dataset.recView; recTpl = null; $("rec-q").value = ""; renderRecords(); return $("rec-q").focus(); }
  const tpl = e.target.closest("[data-tpl]");
  if (tpl) { recTplPage = recPage; recTpl = tpl.dataset.tpl; renderRecords(); return $("records").querySelector("[data-tpl-back]")?.focus(); }
  if (e.target.closest("[data-tpl-back]")) { const back = recTpl; recTpl = null; renderRecords(); showRecordPage(recTplPage); return $("records").querySelector(`[data-tpl="${CSS.escape(back)}"]`)?.focus(); }
  const pick = e.target.closest("[data-rec-open]");
  if (pick) return pick.getAttribute("aria-current") === "true" ? closeRecords() : switchRecord(pick.dataset.recOpen);
  const forget = e.target.closest("[data-rec-forget]");
  if (forget) {
    await window.motion?.collapseOut(forget.closest("li"));
    try { await post("/api/records/forget", { path: forget.dataset.recForget }); } catch (err) { toast(err.message); }
    return openRecords();
  }
  // 幕（dialog の外側）を押したら閉じる。dialog の内側の余白を押しても target は dialog になるので、押した位置で見分ける
  if (e.target === $("records")) {
    const b = $("records").getBoundingClientRect();
    if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) closeRecords();
  }
});
$("records").addEventListener("cancel", e => { e.preventDefault(); closeRecords(); });   // Esc も退場の動きを通す
// 打つたびに絞る。変換中のひらがなでも絞り、確定を待たない（最初の入力のあとすぐ結果を見せる・ja-incremental-search.md の4節）
// テンプレートの中身を開いているときに打ったら、一覧へ戻して絞る（中身の表示には絞り込む行が無い）
$("rec-q").addEventListener("input", () => { recTpl = null; renderRecords(); });
// ページ番号は打ち込んで Enter か、欄を離れたときに移る。範囲の外の数は端のページにする
$("rec-pg-n").addEventListener("change", e => { const n = parseInt(e.target.value, 10); showRecordPage(Number.isFinite(n) ? n - 1 : recPage); });
$("rec-pg-n").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } });
// マウスホイールでページを送る。一覧の中はスクロールしないので、ホイールはページ送りにだけ使う。
// タッチパッドは細かい量を何度も送ってくるので、量をためて 50 を超えたら1ページ送り、送ったあと 380ms は次を受けない（1回のひねりで何ページも飛ばない）
let recWheel = 0, recWheelLock = 0, recWheelIdle = 0;
$("rec-list").addEventListener("wheel", e => {
  if (recPages.length < 2) return;
  e.preventDefault();
  clearTimeout(recWheelIdle); recWheelIdle = setTimeout(() => { recWheel = 0; }, 200);
  if (performance.now() < recWheelLock) return;
  recWheel += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  if (Math.abs(recWheel) < 50) return;
  const step = Math.sign(recWheel); recWheel = 0;
  if (recPage + step < 0 || recPage + step >= recPages.length) return;
  recWheelLock = performance.now() + 380;
  showRecordPage(recPage + step);
}, { passive: false });
// 窓の大きさが変わったら、収まる行の数も変わるので区切り直す
addEventListener("resize", () => { if ($("records").open) paginateRecords(true); });
document.addEventListener("keydown", e => {
  const dlg = $("records");
  if (dlg.open) {
    const rows = [...dlg.querySelectorAll("button.rec-main, .rec-forget")].filter(b => !b.closest("li").hidden);
    // PgUp・PgDn でページを送る。番号の欄では打ち込みを優先する
    if ((e.key === "PageDown" || e.key === "PageUp") && e.target.id !== "rec-pg-n") {
      e.preventDefault(); e.stopImmediatePropagation();
      showRecordPage(recPage + (e.key === "PageDown" ? 1 : -1));
      if (e.target.closest("#rec-list")) [...dlg.querySelectorAll("button.rec-main, .rec-forget")].find(b => !b.closest("li").hidden)?.focus();
      return;
    }
    const dir = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (e.target.id === "rec-q") {
      // 変換を確定する Enter で文章を開かない（ja-incremental-search.md の2節。isComposing と 229 の両方で見る）
      if (e.isComposing || e.keyCode === 229) { e.stopImmediatePropagation(); return; }
      if (e.key === "ArrowDown" && rows.length) { e.preventDefault(); rows[0].focus(); }
      else if (e.key === "Enter" && rows[0]?.matches("[data-rec-open]")) { e.preventDefault(); rows[0].click(); }
      // Esc の1回目は検索を消し、2回目で閉じる
      else if (e.key === "Escape" && e.target.value) { e.preventDefault(); e.target.value = ""; renderRecords(); }
    } else if (dir && !e.target.matches("input") && !recTpl) {   // テンプレートの中身の表示中は、↑↓ で中身をスクロールさせる
      // 一覧の中は ↑↓ で行を移り、一番上で ↑ を押すと検索の欄へ戻る
      e.preventDefault();
      // ページの端で ↓↑ を押したら、隣のページの頭か末尾へ移る
      const i = rows.indexOf(document.activeElement);
      const all = () => [...dlg.querySelectorAll("button.rec-main, .rec-forget")].filter(b => !b.closest("li").hidden);
      if (dir > 0 && i === rows.length - 1 && recPage < recPages.length - 1) { showRecordPage(recPage + 1); all()[0]?.focus(); }
      else if (dir < 0 && i === 0 && recPage > 0) { showRecordPage(recPage - 1); all().at(-1)?.focus(); }
      else if (dir < 0 && i <= 0) $("rec-q").focus(); else rows[Math.min(rows.length - 1, i + dir)]?.focus();
    }
    // ほかのキー（1〜4・d など）は後ろの画面へ届かせない
    e.stopImmediatePropagation();
    return;
  }
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.target.matches("textarea, input")) return;
  // ライブラリは左の列の一番上なので、1〜4 の一つ上の 0 で開く
  if (e.key === "0") { e.preventDefault(); e.stopImmediatePropagation(); openRecords(); }
}, true);

// 本文コピー（頭の frontmatter を付けるか外すかを選べる）。中身はサーバーが export と同じ規則で作る（/api/markdown）。
// 「本文だけ」は頭の frontmatter を外す。題とタグを別の欄で入れる投稿画面の、本文の欄に貼る分。
// 方言は注記の箱の書き方だけを変える（各媒体の方言に汎用的に対応できるようにするため）。選んだ方言はこの画面を見る人の手元に覚える
let flavor = "gfm";
try { flavor = localStorage.getItem("tsuzuri-flavor") || "gfm"; } catch {}
const paintFlavor = () => document.querySelectorAll("[data-flavor]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.flavor === flavor)));
paintFlavor();
document.addEventListener("click", e => {
  const f = e.target.closest("[data-flavor]");
  if (!f) return;
  flavor = f.dataset.flavor; paintFlavor();
  try { localStorage.setItem("tsuzuri-flavor", flavor); } catch {}
});
// 登場と退場は説明カードと同じ型。ボタンの側から膨らんでバネで着き、
// 退場は短く加速しながら縮む。退場の動き（CSS の .14 秒）が終わってから隠す
const popGone = new WeakMap();
/** 押すと開く小さなメニュー（.pop）を開け閉めする。本文コピーと起点の回の一覧が使う。退場の動き（CSS の .14 秒）が終わってから隠す */
function popMenu(menuId, btnId, open) {
  const m = $(menuId), b = $(btnId);
  if (open === m.classList.contains("on")) return;
  b?.setAttribute("aria-expanded", String(open));
  clearTimeout(popGone.get(m));
  if (open) {
    m.hidden = false; m.classList.remove("on"); void m.offsetWidth; m.classList.add("on");
    (m.querySelector('[aria-checked="true"]') ?? m.querySelector("button"))?.focus({ preventScroll: true });
  } else {
    m.classList.remove("on");
    popGone.set(m, setTimeout(() => { if (!m.classList.contains("on")) m.hidden = true; }, 160));
  }
}
const copyMenu = open => popMenu("copy-menu", "copy", open);
document.addEventListener("click", async e => {
  if (e.target.closest("#copy")) return copyMenu(!$("copy-menu").classList.contains("on"));
  const item = e.target.closest("[data-copy]");
  if (!item) { if (!e.target.closest("#copy-menu")) copyMenu(false); return; }
  copyMenu(false);
  try {
    const r = await fetch(`/api/markdown?flavor=${encodeURIComponent(flavor)}`), body = await r.json();
    if (!r.ok) throw new Error(body.error);
    const text = item.dataset.copy === "body" ? body.markdown.replace(/^---\n[\s\S]*?\n---\n+/, "") : body.markdown;
    await navigator.clipboard.writeText(text);
    const name = { gfm: "GitHub", qiita: "Qiita", zenn: "Zenn" }[flavor];
    toast(`${item.dataset.copy === "body" ? "本文だけ" : "記事全部"}を ${name} の記法でコピーした`);
  } catch (err) { toast(`コピーできなかった。${err.message}`); }
});
document.addEventListener("keydown", e => {
  // 開いているメニューの中では、Esc で閉じてボタンへ戻り、↑↓ で項目を移る（本文の文へは移らない）
  const open = document.querySelector(".pop.on");
  if (!open) return;
  const btn = open.id === "copy-menu" ? "copy" : "round-btn";
  if (e.key === "Escape") { e.stopImmediatePropagation(); popMenu(open.id, btn, false); $(btn)?.focus(); return; }
  const dir = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
  if (dir && open.contains(document.activeElement)) {
    e.preventDefault(); e.stopImmediatePropagation();
    const items = [...open.querySelectorAll("button:not(:disabled)")], i = items.indexOf(document.activeElement);
    items[(i + dir + items.length) % items.length]?.focus();
  }
}, true);
