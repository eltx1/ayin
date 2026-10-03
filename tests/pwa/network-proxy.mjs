import http from "node:http";
import { readFile } from "node:fs/promises";

// Test-only loopback server. No fixture endpoints are added to the AYIN app.
const database = new URL(process.env.TEST_DATABASE_URL ?? "");
if (
  process.env.AYIN_E2E_PWA !== "1" ||
  !["localhost", "127.0.0.1"].includes(database.hostname) ||
  database.pathname !== "/ayin_e2e"
)
  throw Error("PWA proxy requires explicit isolated local E2E configuration");
const source = await readFile("apps/web/public/sw.js", "utf8");
let mode = "v3";
const modes = new Set(["v3", "v4", "late", "legacy"]);
const legacy = `
const VERSION = 'ayin-pwa-v2-fixture';
self.addEventListener('install', e => e.waitUntil(caches.open('ayin-pwa-v2-read').then(c => c.put('/account', new Response('isolated-legacy-private-sentinel'))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
`;
function worker() {
  if (mode === "legacy") return legacy;
  if (mode === "v3") return source;
  let result = source.replace(
    '"ayin-pwa-v3"',
    `"ayin-pwa-${mode === "v4" ? "v4-test" : "v5-late-test"}"`,
  );
  if (mode === "late")
    result = result.replace(
      "event.waitUntil(self.skipWaiting());",
      "event.waitUntil(new Promise(resolve => setTimeout(resolve, 15000)).then(() => self.skipWaiting()));",
    );
  return result;
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1:3100");
  if (url.pathname === "/__pwa_fixture/control") {
    const next = url.searchParams.get("mode");
    if (req.method !== "POST" || !modes.has(next)) {
      res.writeHead(400).end();
      return;
    }
    mode = next;
    res.writeHead(204, { "cache-control": "no-store" }).end();
    return;
  }
  if (url.pathname === "/sw.js" && req.method === "GET") {
    res
      .writeHead(200, {
        "content-type": "application/javascript",
        "cache-control": "no-store",
        "service-worker-allowed": "/",
      })
      .end(worker());
    return;
  }
  const upstream = http.request(
    { hostname: "127.0.0.1", port: 3102, method: req.method, path: req.url, headers: req.headers },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.on("aborted", () => upstream.destroy());
  res.on("close", () => upstream.destroy());
  req.pipe(upstream);
});
server.listen(3100, "127.0.0.1");
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close());
