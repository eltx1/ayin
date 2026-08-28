import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const serviceWorker = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

describe("AYIN PWA cache safety", () => {
  it("limits offline caching to static shell assets and bypasses media", () => {
    expect(serviceWorker).toContain('new Set(["font", "image", "script", "style"])');
    expect(serviceWorker).toContain('request.destination === "video"');
    expect(serviceWorker).toContain('request.destination === "audio"');
    expect(serviceWorker).toContain('url.pathname.startsWith("/watch/")');
    expect(serviceWorker).toContain('url.pathname.startsWith("/media/")');
    expect(serviceWorker).not.toContain('request.destination === "document"');
  });
});
