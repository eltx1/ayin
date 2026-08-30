const VERSION = "ayin-pwa-v2";
const STATIC_CACHE = `${VERSION}-static`;
const READ_CACHE = `${VERSION}-read`;
const APP_SHELL = ["/", "/manifest.webmanifest", "/icons/ayin-192.svg", "/icons/ayin-512.svg"];
const STATIC_DESTINATIONS = new Set(["font", "image", "script", "style"]);
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
function isMedia(url, request) {
  return (
    request.destination === "video" ||
    request.destination === "audio" ||
    url.pathname.startsWith("/watch/") ||
    url.pathname.startsWith("/media/") ||
    url.pathname.includes("upload") ||
    url.pathname.includes("playback")
  );
}
function safeApiRead(url, request) {
  return (
    request.method === "GET" &&
    url.pathname.startsWith("/api/") &&
    (/\/health$/.test(url.pathname) ||
      url.pathname.startsWith("/api/discovery/") ||
      url.pathname.startsWith("/api/public/"))
  );
}
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isMedia(url, request)) return;
  if (STATIC_DESTINATIONS.has(request.destination)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        const network = fetch(request).then(async (response) => {
          if (response.ok && response.type === "basic") await cache.put(request, response.clone());
          return response;
        });
        return hit ?? network;
      }),
    );
    return;
  }
  if (safeApiRead(url, request)) {
    event.respondWith(
      caches.open(READ_CACHE).then(async (cache) => {
        try {
          const response = await fetch(request);
          if (response.ok) await cache.put(request, response.clone());
          return response;
        } catch {
          return (await cache.match(request)) ?? Response.error();
        }
      }),
    );
  }
});
