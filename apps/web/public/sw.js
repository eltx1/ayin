const VERSION = "ayin-pwa-v4";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_PAGE = "/offline.html";
const APP_SHELL = [OFFLINE_PAGE, "/icons/ayin-192.svg", "/icons/ayin-512.svg"];
// Entry bound across deployments; this is not a promise of unlimited offline builds
// or a byte quota. The neutral offline shell is always protected from eviction.
const MAX_BUILD_ASSETS = 128;
const SHELL_URLS = new Set(APP_SHELL.map((path) => new URL(path, self.location.origin).href));
let pendingCacheWrite = Promise.resolve();

function retainStaticAsset(request, response) {
  // Serialize trimming and writes so parallel chunk fetches cannot exceed the cap.
  // A storage failure must never turn a successful network fetch into a page error.
  pendingCacheWrite = pendingCacheWrite
    .then(async () => {
      const cache = await caches.open(STATIC_CACHE);
      const assets = (await cache.keys()).filter((key) => !SHELL_URLS.has(key.url));
      // Reserve one entry even for an apparent overwrite: Vary can distinguish
      // responses with the same URL, and concurrent misses can finish together.
      const keep = MAX_BUILD_ASSETS - 1;
      for (const key of assets.slice(0, Math.max(0, assets.length - keep))) {
        await cache.delete(key);
      }
      await cache.put(request, response);
    })
    .catch(() => undefined);
  return pendingCacheWrite;
}
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(async () => {
        // Migrate the known unsafe v2 worker immediately, without reloading any tab.
        // Future safe-version updates retain the explicit user-acceptance lifecycle.
        const keys = await caches.keys();
        if (keys.some((key) => key === "ayin-pwa-v2-static" || key === "ayin-pwa-v2-read"))
          await self.skipWaiting();
      }),
  );
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
      .then(async () => {
        if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
        await self.clients.claim();
      }),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
});
function mayStore(response) {
  return (
    response.status === 200 &&
    response.type === "basic" &&
    !response.redirected &&
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
      (async () => {
        try {
          return (await event.preloadResponse) ?? (await fetch(request));
        } catch {
          try {
            const cache = await caches.open(STATIC_CACHE);
            return (await cache.match(OFFLINE_PAGE)) ?? Response.error();
          } catch {
            return Response.error();
          }
        }
      })(),
    );
    return;
  }
  const staticAsset = url.pathname.startsWith("/_next/static/") || APP_SHELL.includes(url.pathname);
  if (
    !staticAsset ||
    url.search ||
    request.headers.has("authorization") ||
    request.headers.has("range") ||
    request.cache === "no-store" ||
    request.cache === "no-cache"
  )
    return;
  event.respondWith(
    (async () => {
      try {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
      } catch {
        // Cache access is an optimization, never a prerequisite for online assets.
      }
      const response = await fetch(request);
      // The three neutral shell entries are installed once, never multiplied by
      // runtime request-header variants.
      if (!SHELL_URLS.has(request.url) && mayStore(response))
        event.waitUntil(retainStaticAsset(request, response.clone()));
      return response;
    })(),
  );
});
