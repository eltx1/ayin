const VERSION = "ayin-pwa-v3";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_PAGE = "/offline.html";
const APP_SHELL = [OFFLINE_PAGE, "/icons/ayin-192.svg", "/icons/ayin-512.svg"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("ayin-pwa-") && key !== STATIC_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
});
function mayStore(response) {
  return (
    response.ok &&
    response.type === "basic" &&
    !/(?:^|,)\s*(?:no-store|private|no-cache)\b/i.test(response.headers.get("cache-control") ?? "")
  );
}
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Documents and policy-sensitive API reads never enter the worker cache.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(STATIC_CACHE);
        return (await cache.match(OFFLINE_PAGE)) ?? Response.error();
      }),
    );
    return;
  }
  const staticAsset = url.pathname.startsWith("/_next/static/") || APP_SHELL.includes(url.pathname);
  if (
    !staticAsset ||
    url.search ||
    request.headers.has("authorization") ||
    request.cache === "no-store" ||
    request.cache === "no-cache"
  )
    return;
  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (mayStore(response)) await cache.put(request, response.clone());
      return response;
    }),
  );
});
