// tsuzuri の service worker。アプリとして入れた窓で、サーバーが止まっているときに真っ白な画面ではなく札を出す。
// 画面のファイルは保存しない。保存すると、app.js を直したあとも古い画面が出続けるため。いつも手元のサーバーから取る。
// 札は本文に文字列で持つ（Cache API で後から取りに行くと、止まっている間は取れない）。

const STOPPED = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>tsuzuri</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#dde3ea;color:#222B42;font:15px/1.8 "BIZ UDPGothic",sans-serif}
main{max-width:30em;padding:24px}h1{font-size:18px;margin:0 0 8px}code{background:#fff8;padding:1px 6px;border-radius:6px}</style></head>
<body><main><h1>tsuzuri のサーバーが止まっています</h1>
<p>tsuzuri のフォルダで <code>python3 app/server.py</code> を実行すると、5秒以内にこの窓が自分で開き直します。</p></main>
<script>setInterval(() => fetch("/", { cache: "no-store" }).then((r) => r.ok && location.reload()).catch(() => {}), 5000);</script>
</body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  // 札で受けるのは画面そのものの読み込みだけ。API や画像の失敗は、画面の側がそれぞれ扱う
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(STOPPED, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } })),
  );
});
