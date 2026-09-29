import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

function request(path: string, headers: Record<string, string> = {}, method = "GET") {
  return new NextRequest(`https://ayin.stream${path}`, { method, headers });
}

describe("locale preference side effects", () => {
  it("persists explicit document switches and does not cache their redirects", () => {
    const response = proxy(
      request("/ar/browse?lang=en&keep=1", {
        cookie: "ayin_locale=ar",
        "sec-fetch-dest": "document",
      }),
    );
    expect(response.cookies.get("ayin_locale")?.value).toBe("en");
    expect(response.headers.get("location")).toBe("https://ayin.stream/browse?keep=1");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each([
    { rsc: "1" },
    { "next-router-prefetch": "1" },
    { purpose: "prefetch" },
    { "sec-purpose": "prefetch;prerender" },
  ])("renders a prefixed request without mutating cookies for %j", (headers) => {
    const response = proxy(request("/ar/browse", { ...headers, cookie: "ayin_locale=en" }));
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://ayin.stream/browse");
    expect(response.headers.get("x-middleware-request-x-ayin-locale")).toBe("ar");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each(["HEAD", "POST"])("never persists a new preference on %s", (method) => {
    const response = proxy(request("/ar/browse", { cookie: "ayin_locale=en" }, method));
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("keeps deliberate prefixed document navigation and aliases working", () => {
    const document = proxy(request("/ar/movies", { "sec-fetch-dest": "document" }));
    expect(document.cookies.get("ayin_locale")?.value).toBe("ar");
    const alias = proxy(request("/ar/shorts?source=old", { "sec-fetch-dest": "document" }));
    expect(alias.status).toBe(308);
    expect(alias.headers.get("location")).toBe("https://ayin.stream/ar/clips?source=old");
    expect(alias.cookies.get("ayin_locale")?.value).toBe("ar");
    const prefetch = proxy(request("/ar/shorts?source=old", { rsc: "1" }));
    expect(prefetch.status).toBe(308);
    expect(prefetch.headers.get("set-cookie")).toBeNull();
  });
});
