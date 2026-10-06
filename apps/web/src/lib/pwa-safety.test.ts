import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
function harness() {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const entries = new Map<string, Response>();
  const key = (request: string | Request) =>
    new URL(typeof request === "string" ? request : request.url, "https://ayin.stream").href;
  const cache = {
    addAll: vi.fn(async (paths: string[]) =>
      paths.forEach((path) => entries.set(key(path), new Response("offline"))),
    ),
    match: vi.fn(async (request: string | Request) => entries.get(key(request))),
    put: vi.fn(async (request: string | Request, response: Response) => {
      entries.set(key(request), response);
    }),
    keys: vi.fn(async () => [...entries.keys()].map((url) => new Request(url))),
    delete: vi.fn(async (request: string | Request) => entries.delete(key(request))),
  };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async (): Promise<string[]> => []),
    delete: vi.fn(async (name: string) => Boolean(name)),
  };
  const fetch = vi.fn(async () => {
    const response = new Response("network");
    Object.defineProperty(response, "type", { value: "basic" });
    return response;
  });
  const self = {
    location: { origin: "https://ayin.stream" },
    registration: { navigationPreload: { enable: vi.fn(async () => undefined) } },
    addEventListener: (name: string, listener: (event: Record<string, unknown>) => void) =>
      listeners.set(name, listener),
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  };
  runInNewContext(source, { self, caches, fetch, URL, Response });
  async function dispatch(name: string, fields: Record<string, unknown> = {}) {
    let response: Promise<Response> | undefined;
    const pending: Promise<unknown>[] = [];
    listeners.get(name)?.({
      ...fields,
      respondWith: (value: Promise<Response>) => {
        response = value;
      },
      waitUntil: (value: Promise<unknown>) => {
        pending.push(value);
      },
    });
    const result = await response;
    await Promise.all(pending);
    return result;
  }
  function request(path: string, overrides: Record<string, unknown> = {}) {
    return {
      url: `https://ayin.stream${path}`,
      method: "GET",
      mode: "cors",
      cache: "default",
      headers: new Headers(),
      ...overrides,
    };
  }
  return { cache, caches, entries, fetch, self, dispatch, request };
}

describe("AYIN service worker behavior", () => {
  it("installs only neutral assets and waits for explicit activation", async () => {
    const h = harness();
    await h.dispatch("install");
    expect(h.cache.addAll).toHaveBeenCalledWith([
      "/offline.html",
      "/icons/ayin-192.svg",
      "/icons/ayin-512.svg",
    ]);
    expect(h.self.skipWaiting).not.toHaveBeenCalled();
    await h.dispatch("message", { data: { type: "SKIP_WAITING" } });
    expect(h.self.skipWaiting).toHaveBeenCalledOnce();
  });
  it("immediately migrates the known unsafe v2 worker without any page reload instruction", async () => {
    const h = harness();
    h.caches.keys.mockResolvedValue(["ayin-pwa-v2-read"]);
    await h.dispatch("install");
    expect(h.self.skipWaiting).toHaveBeenCalledOnce();
  });
  it("purges old AYIN caches without deleting another application's cache", async () => {
    const h = harness();
    h.caches.keys.mockResolvedValue([
      "ayin-pwa-v2-static",
      "ayin-pwa-v2-read",
      "ayin-pwa-v3-static",
      "ayin-pwa-v4-static",
      "other-app",
    ]);
    await h.dispatch("activate");
    expect(h.caches.delete.mock.calls.map(([name]) => name)).toEqual([
      "ayin-pwa-v2-static",
      "ayin-pwa-v2-read",
      "ayin-pwa-v3-static",
    ]);
    expect(h.self.clients.claim).toHaveBeenCalledOnce();
    expect(h.self.registration.navigationPreload.enable).toHaveBeenCalledOnce();
  });
  it.each([
    "/api/health",
    "/api/discovery/home",
    "/api/public/live/x",
    "/api/watch/x",
    "/media/x",
    "/private-avatar.png",
    "/_next/static/chunk.js?token=x",
  ])("bypasses %s", async (path) => {
    const h = harness();
    expect(await h.dispatch("fetch", { request: h.request(path) })).toBeUndefined();
    expect(h.cache.put).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("keeps successful and HTTP error documents online-only and uses neutral fallback on network failure", async () => {
    const h = harness();
    await h.dispatch("install");
    expect(
      await (
        await h.dispatch("fetch", { request: h.request("/creator", { mode: "navigate" }) })
      )?.text(),
    ).toBe("network");
    h.fetch.mockResolvedValueOnce(new Response("denied", { status: 403 }));
    expect(
      (await h.dispatch("fetch", { request: h.request("/watch/private", { mode: "navigate" }) }))
        ?.status,
    ).toBe(403);
    h.fetch.mockRejectedValueOnce(new TypeError("offline"));
    expect(
      await (
        await h.dispatch("fetch", { request: h.request("/ar/watch/x", { mode: "navigate" }) })
      )?.text(),
    ).toBe("offline");
    expect(h.cache.put).not.toHaveBeenCalled();
  });
  it("uses the browser navigation preload without replaying the document request", async () => {
    const h = harness();
    const preload = new Response("document", { status: 200 });
    expect(
      await h.dispatch("fetch", {
        request: h.request("/browse?lang=en", { mode: "navigate" }),
        preloadResponse: Promise.resolve(preload),
      }),
    ).toBe(preload);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.cache.put).not.toHaveBeenCalled();
  });
  it("caches a public build asset and serves it without a detached network request", async () => {
    const h = harness();
    const request = h.request("/_next/static/chunk.js");
    await h.dispatch("fetch", { request });
    await h.dispatch("fetch", { request });
    expect(h.cache.put).toHaveBeenCalledOnce();
    expect(h.fetch).toHaveBeenCalledOnce();
  });
  it.each(["private, max-age=300", "public, no-store", "no-cache"])(
    "respects %s response headers",
    async (value) => {
      const h = harness();
      const response = new Response("sensitive", { headers: { "cache-control": value } });
      Object.defineProperty(response, "type", { value: "basic" });
      h.fetch.mockResolvedValueOnce(response);
      await h.dispatch("fetch", { request: h.request("/_next/static/chunk.js") });
      expect(h.cache.put).not.toHaveBeenCalled();
    },
  );
  it.each(["no-store", "no-cache"])("bypasses a request with cache=%s", async (cache) => {
    const h = harness();
    expect(
      await h.dispatch("fetch", { request: h.request("/_next/static/chunk.js", { cache }) }),
    ).toBeUndefined();
  });
  it("bypasses authenticated requests even to allowed paths", async () => {
    const h = harness();
    expect(
      await h.dispatch("fetch", {
        request: h.request("/_next/static/chunk.js", {
          headers: new Headers({ authorization: "Bearer test" }),
        }),
      }),
    ).toBeUndefined();
  });
  it.each(["open", "match", "put", "keys", "delete"] as const)(
    "returns network assets despite a %s storage failure",
    async (operation) => {
      const h = harness();
      if (operation === "open") h.caches.open.mockRejectedValue(new Error("storage disabled"));
      else if (operation === "delete") {
        for (let i = 0; i < 128; i++) {
          await h.cache.put(
            h.request(`/_next/static/old-${i}.js`) as unknown as Request,
            new Response("old"),
          );
        }
        h.cache.delete.mockRejectedValue(new Error("storage disabled"));
      } else h.cache[operation].mockRejectedValue(new Error("storage disabled"));
      const response = await h.dispatch("fetch", {
        request: h.request("/_next/static/current.js"),
      });
      expect(response?.status).toBe(200);
      expect(await response?.text()).toBe("network");
    },
  );
  it("bounds concurrent assets across releases while retaining the neutral offline shell", async () => {
    const h = harness();
    await h.dispatch("install");
    await Promise.all(
      Array.from({ length: 150 }, (_, i) =>
        h.dispatch("fetch", {
          request: h.request(`/_next/static/build-${Math.floor(i / 50)}/${i}.js`),
        }),
      ),
    );
    const assets = [...h.entries.keys()].filter((url) => url.includes("/_next/static/"));
    expect(assets).toHaveLength(128);
    expect(assets[0]).toContain("/22.js");
    expect(assets.at(-1)).toContain("/149.js");
    expect(h.entries.has("https://ayin.stream/offline.html")).toBe(true);
    expect(h.entries.has("https://ayin.stream/icons/ayin-192.svg")).toBe(true);
    expect(h.entries.has("https://ayin.stream/icons/ayin-512.svg")).toBe(true);
    h.fetch.mockRejectedValueOnce(new TypeError("offline"));
    const offline = await h.dispatch("fetch", {
      request: h.request("/account", { mode: "navigate" }),
    });
    expect(await offline?.text()).toBe("offline");
  });
  it("recovers cache writes after a transient quota failure", async () => {
    const h = harness();
    h.cache.put.mockRejectedValueOnce(new Error("QuotaExceededError"));
    await h.dispatch("fetch", { request: h.request("/_next/static/first.js") });
    await h.dispatch("fetch", { request: h.request("/_next/static/second.js") });
    expect(h.entries.has("https://ayin.stream/_next/static/second.js")).toBe(true);
  });
  it("bypasses partial requests and refuses partial or redirected cache responses", async () => {
    const h = harness();
    expect(
      await h.dispatch("fetch", {
        request: h.request("/_next/static/x.js", { headers: new Headers({ range: "bytes=0-10" }) }),
      }),
    ).toBeUndefined();
    for (const [status, redirected] of [
      [206, false],
      [200, true],
    ] as const) {
      const response = new Response("network", { status });
      Object.defineProperties(response, {
        type: { value: "basic" },
        redirected: { value: redirected },
      });
      h.fetch.mockResolvedValueOnce(response);
      expect(await h.dispatch("fetch", { request: h.request("/_next/static/x.js") })).toBe(
        response,
      );
    }
    expect(h.cache.put).not.toHaveBeenCalled();
  });
});
