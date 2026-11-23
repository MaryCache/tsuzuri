/** 描画結果と送信内容を、ブラウザや追加依存なしで確認する。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const elements = new Map(), listeners = {};
const classList = { toggle() {}, add() {}, remove() {}, contains() { return false; } };
/** 描画に必要な要素だけを保持する。 */
function element(id) {
  if (!elements.has(id)) elements.set(id, { innerHTML: '', dataset: {}, children: [], classList,
    setAttribute() {}, querySelectorAll() { return []; }, addEventListener() {}, focus() {} });
  return elements.get(id);
}
const ctx = vm.createContext({
  document: { body: { dataset: {}, classList }, documentElement: { style: { setProperty() {} } },
    getElementById: element, querySelectorAll() { return []; }, querySelector() { return null; },
    addEventListener(type, run) { (listeners[type] ??= []).push(run); } },
  localStorage: { getItem() { return null; }, setItem() {} }, navigator: {}, window: { addEventListener() {} },
  addEventListener() {}, setInterval() {}, setTimeout() {}, clearTimeout() {},
  performance: { now() { return 10000; } }, fetch() { return new Promise(() => {}); },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8'), ctx);
const run = code => vm.runInContext(code, ctx);
// 文の中の HTML は、決まった形のタグ（色の span・斜体と太字・改行）だけを効かせ、ほかは字のまま出す
{
  const md = text => run(`mdInline(${JSON.stringify(text)})`);
  const lit = c => `<span style="color:oklch(from ${c} min(l, 0.72) c h / 1)">`;
  assert.equal(md('<span style="color:#EF5350">テト</span>'), `${lit('#EF5350')}テト</span>`);
  assert.equal(md('<span style="color:#6E86FF;white-space:nowrap"><i>ROSE</i></span>'), `${lit('#6E86FF')}<i>ROSE</i></span>`);
  assert.equal(md('<span style="color:transparent">隠し</span>'), `${lit('transparent')}隠し</span>`);
  // 開きと閉じの数を合わせる。閉じの無い開きは末尾で閉じ、開きの無い閉じは捨て、入れ子の順が違えば内側から閉じる
  assert.equal(md('<span style="white-space:nowrap">a<i>b'), '<span>a<i>b</i></span>');
  assert.equal(md('a</span></span>b</i>'), 'ab');
  assert.equal(md('<b>x<i>y</b>z</i>'), '<b>x<i>y</i></b>z');
  assert.match(md('<img src=x onerror=alert(1)>'), /^&lt;img/);
  assert.match(md('<span style="color:#fff;background:url(x)">y</span>'), /^&lt;span/);
  assert.match(md('<i onclick=x>z</i>'), /^&lt;i onclick/);
  assert.match(md('<span style="color:#fff" onmouseover="x">y</span>'), /^&lt;span/);
  // Obsidian の方言: 見出しへのリンクは表示名だけを出し、ハイライトは頭の色の絵文字で色を変える
  assert.equal(md('[[#真　==🔴テト==──嘘|真　重音テト]]と[[#Chorus]]'), '<span class="md-link">真　重音テト</span>と<span class="md-link">Chorus</span>');
  assert.equal(md('==🔴逆さまなったまま==　==普通=='), '<mark class="md-hl md-hl-red">🔴逆さまなったまま</mark>　<mark class="md-hl">普通</mark>');
  assert.equal(md('`a == b` と `c == d`'), '<code>a == b</code> と <code>c == d</code>');
  assert.equal(run(`plainText('真　==🔴テト==──嘘')`), '真　🔴テト──嘘');
  assert.equal(run(`plainText('<span style="color:#EF5350">**重音テト**</span>　跳ね返る')`), '重音テト　跳ね返る');
  assert.match(run(`mdTable('| 口 | 言 |\\n|--|--|\\n| <span style="color:#EF5350"><i>テト</i></span> | **Intro** |')`), /<span style="color:oklch\(from #EF5350[^"]*"><i>テト<\/i><\/span>.*<strong>Intro<\/strong>/);
  // 画像のブロック: 相対パスはサーバーから読み、<picture> は明るい画面の <img> を使い、外部の URL は読み込まない
  assert.equal(run(`imageBlock('![図1](fig/a.png "題")')`), '<img src="/api/image?src=fig%2Fa.png" alt="図1" loading="lazy">');
  const pic = run(`imageBlock('<picture>\\n<source media="(prefers-color-scheme: dark)" srcset="logo-white.svg">\\n<img alt="tsuzuri" src="logo.svg" width="420">\\n</picture>')`);
  assert.equal(pic, '<img src="/api/image?src=logo.svg" alt="tsuzuri" loading="lazy" style="width:min(100%, 420px)">');
  assert.match(run(`imageBlock('![x](https://example.com/a.png)')`), /^<p class="img-ext">外部の画像は読み込みません: <span>https:\/\/example.com\/a.png<\/span>/);
  const evil = run(`imageBlock('<img src="x.png" onerror="alert(1)" alt="<b>q</b>">')`);
  assert.equal(evil, '<img src="/api/image?src=x.png" alt="" loading="lazy">');   // 元の属性は写さず、src と alt だけを組み直す
  assert.doesNotMatch(run(`imageBlock('![<b>"x](a.png)')`), /<b>|"x/);
  assert.equal(run(`imageBlock('図はありません')`), null);
  assert.equal(run(`imageBlock('<img '.repeat(30000))`), null);   // 長すぎる本文は描かない
  const started = Date.now();
  assert.equal(run(`imageBlock('<img src=x.png '.repeat(1200))`), null);   // 閉じない <img が続いても、走査は文字数に比例する
  assert.ok(Date.now() - started < 1000);
  assert.equal(run(`imageBlock('![a](a.png)'.repeat(33))`), null);   // 画像が多すぎるブロックは描かない
}
run(`
  const tags = { role: ['解説'], importance: '核', relation: '順接', technique: [], place: '依頼' };
  const s = { sid: 's0001', kind: 'sentence', paragraph_start: true, versions: [
    { ver: 'v001', text: '古い本文。', tags, memo: '古い意図' },
    { ver: 'v002', text: '新しい本文。', tags, memo: '新しい意図' }
  ] };
  st.doc = { record: '/a.md.tsuzuri', document: 'C:\\\\原稿\\\\文章.md', sentences: [s], retired: [],
    retired_sentences: [], comments: [], reviews: [], requirements: [], designs: [], problems: [] };
  st.sel = s.sid; st.viewVer = 'v001'; st.diff = 'mark';
  render();
`);
assert.equal(element('doc-name').textContent, '文章.md');
assert.match(element('text').innerHTML, /古い本文。/);
assert.doesNotMatch(element('text').innerHTML, /新しい本文。/);
assert.match(element('detail').innerHTML, /古い意図/);
assert.doesNotMatch(element('detail').innerHTML, /新しい意図/);
run(`st.viewVer = 'v002'; render();`);
assert.match(element('text').innerHTML, /新しい本文。/);
run(`st.viewVer = 'v001'; st.diff = 'only'; render();`);
assert.match(element('text').innerHTML, /古い本文。/);
assert.doesNotMatch(element('text').innerHTML, /新しい本文。/);

const injected = 'x"><style>body{display:none}</style><button data-del="c9999">偽</button>';
ctx.injected = injected;
const li = run(`commentLi({ id: injected, ver: injected, text: injected, status: 'open' })`);
assert.doesNotMatch(li, /<style>|<button data-del="c9999">/);
assert.match(li, /data-del="x&quot;&gt;&lt;style&gt;/);
run(`s.versions[0].ver = injected; s.versions[1].ver = injected + '2'; st.viewVer = injected; renderDetail();`);
assert.doesNotMatch(element('detail').innerHTML, /<style>|<button data-del="c9999">/);
assert.match(element('detail').innerHTML, /data-ver="x&quot;&gt;&lt;style&gt;/);
run(`s.versions[0].ver = 'v001'; s.versions[1].ver = 'v002';`);

run(`
  st.doc.retired = [{ sid: s.sid, into: ['s0002'] }];
  st.doc.retired_sentences = [s]; st.doc.sentences = [];
  st.doc.comments = [{ id: 'c0001', sid: s.sid, ver: 'v001', text: '直して', status: 'resolved' }];
  st.viewVer = null; st.diff = 'off'; renderDetail();
`);
assert.match(element('detail').innerHTML, /本文から外した文/);
assert.match(element('detail').innerHTML, /新しい本文。/);
assert.match(element('detail').innerHTML, /未解決に戻す/);
assert.match(element('detail').innerHTML, /data-del="c0001"/);
assert.match(run('commentsPanelHTML()'), /data-goto="s0001"/);

run(`
  st.doc.sentences = [s]; st.doc.retired = []; st.doc.retired_sentences = []; st.doc.comments = [];
  const issue = { sid: s.sid, ver: 'v001', aspect: '指摘：役割', text: '直して' };
  const polish = { sid: s.sid, ver: 'v001', aspect: '推敲：yomiyasu', text: '語を直した' };
  st.doc.reviews = [issue, polish]; st.viewVer = null;
`);
assert.equal(run('aiOpen(s).length'), 1);
assert.equal(run('aiComments(s).length'), 1);
assert.equal(run('aiWork(s).length'), 1);
run(`s.versions.push({ ...s.versions[1], ver: 'v003' });`);
assert.equal(run('aiOpen(s).length'), 0);
run(`st.doc.reviews.push({ ...polish, ver: 'v002' });`);
assert.equal(run('aiOpen(s).length'), 1);
run(`st.openOnly = true;`);
assert.match(run('commentsPanelHTML()'), /直して/);
assert.doesNotMatch(run('commentsPanelHTML()'), /語を直した/);
run(`st.doc.reviews.push({ ...issue, aspect: '対応：役割' });`);
assert.equal(run('aiOpen(s).length'), 0);
run(`st.doc.reviews = [polish]; renderDetail(); renderText();`);
assert.match(element('detail').innerHTML, /<details class="more"><summary>.*作業の記録 1件/s);
assert.equal(run('notesOf(s).length'), 0);
assert.match(element('text').innerHTML, /mk-done/);
run(`st.doc.reviews = [];`);
assert.equal(run('aiOpen(s).length'), 0);

run('toggleKeys(true)');
assert.equal(ctx.document.body.dataset.keys, 'on');
run('toggleKeys(false)');
assert.equal(ctx.document.body.dataset.keys, 'off');
const sw = fs.readFileSync(path.join(__dirname, '../web/sw.js'), 'utf8');
assert.match(sw, /python3 app\/server.py/);
assert.doesNotMatch(sw, /systemctl|WSL/);

/** 画面が開いている文章と、履歴で選んだ版を送っているか確認する。 */
(async () => {
  run(`st.viewVer = 'v003'; st.diff = 'off';`);
  await listeners.click[0]({ target: { closest(selector) { return selector === '[data-ver]' ? { dataset: { ver: 'v001' } } : null; } } });
  assert.match(element('text').innerHTML, /古い本文。/);
  assert.doesNotMatch(element('text').innerHTML, /新しい本文。/);
  let sent;
  ctx.fetch = async (url, options) => { sent = { url, ...JSON.parse(options.body) }; return { ok: true, json: async () => ({}) }; };
  run(`st.viewVer = 'v001';`);
  element('input').value = 'コメント';
  element('form').querySelector = () => ({});
  run('loadDoc = async () => {}; render = () => {}; toast = () => {};');
  await listeners.submit[0]({ preventDefault() {}, target: { id: 'form', querySelector() { return {}; } } });
  assert.equal(sent.record, '/a.md.tsuzuri');
  assert.equal(sent.ver, 'v001');
  await run(`post('/api/comments/c0001/delete', { record: '/original.md.tsuzuri' })`);
  assert.equal(sent.record, '/original.md.tsuzuri');
  ctx.fetch = async () => ({ status: 409, ok: false, json: async () => ({ error: '画面を再読み込みしてください' }) });
  await assert.rejects(run(`post('/api/comments', {})`), /画面を再読み込みすると最新の状態になる/);
  run(`lastPostAt = -Infinity; st.doc.stamp = 'same'; loadDoc = async () => { loaded++; };`);
  ctx.loaded = 0;
  ctx.fetch = async () => ({ ok: true, json: async () => ({ path: '/a.md.tsuzuri', stamp: 'same' }) });
  await run('watchRecord()');
  assert.equal(ctx.loaded, 0);
  ctx.fetch = async () => ({ ok: true, json: async () => ({ path: '/a.md.tsuzuri', stamp: 'changed' }) });
  await run('watchRecord()');
  assert.equal(ctx.loaded, 1);
  ctx.fetch = async () => ({ ok: true, json: async () => ({ path: '/b.md.tsuzuri', stamp: 'same' }) });
  run(`st.drafts = { s0001: '書きかけ' };`);
  await run('watchRecord()');
  assert.equal(ctx.loaded, 1);
  assert.equal(run('st.drafts.s0001'), '書きかけ');
  run('st.drafts = {};');
  await run('watchRecord()');
  assert.equal(ctx.loaded, 2);
  assert.equal(run('st.sel'), null);
})().catch(error => { console.error(error); process.exitCode = 1; });
