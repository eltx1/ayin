import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
function harness() {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const entries = new Map<string, Response>();
  const key = (request: string | Request) => (typeof request === "string" ? request : request.url);
  const cache = {
    addAll: vi.fn(async (paths: string[]) =>
      paths.forEach((path) => entries.set(path, new Response("offline"))),
    ),
    match: vi.fn(async (request: string | Request) => entries.get(key(request))),
    put: vi.fn(async (request: string | Request, response: Response) => {
      entries.set(key(request), response);
    }),
  };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => [
      "ayin-pwa-v2-static",
      "ayin-pwa-v2-read",
      "ayin-pwa-v3-static",
      "other-app",
    ]),
    delete: vi.fn(async (name: string) => Boolean(name)),
  };
  const fetch = vi.fn(async () => {
    const response = new Response("network");
    Object.defineProperty(response, "type", { value: "basic" });
    return response;
  });
  const self = {
    location: { origin: "https://ayin.stream" },
    addEventListener: (name: string, listener: (event: Record<string, unknown>) => void) =>
      listeners.set(name, listener),
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  };
  runInNewContext(source, { self, caches, fetch, URL, Response });
  async function dispatch(name: string, fields: Record<string, unknown> = {}) {
    let response: Promise<Response> | undefined;
    let pending: Promise<unknown> | undefined;
    listeners.get(name)?.({
      ...fields,
      respondWith: (value: Promise<Response>) => {
        response = value;
      },
      waitUntil: (value: Promise<unknown>) => {
        pending = value;
      },
    });
    await pending;
    return response;
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
  return { cache, caches, fetch, self, dispatch, request };
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
  it("purges old AYIN caches without deleting another application's cache", async () => {
    const h = harness();
    await h.dispatch("activate");
    expect(h.caches.delete.mock.calls.map(([name]) => name)).toEqual([
      "ayin-pwa-v2-static",
      "ayin-pwa-v2-read",
    ]);
    expect(h.self.clients.claim).toHaveBeenCalledOnce();
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
});
