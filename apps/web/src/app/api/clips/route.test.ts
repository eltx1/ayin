import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllGlobals());
describe("Legacy Clips proxy", () => {
  it.each(["", "?cursor=00000000-0000-4000-8000-000000000001"])(
    "never fetches anonymous media for a cookie session: %s",
    async (query) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const response = await GET(
        new NextRequest(`http://localhost/api/clips${query}`, {
          headers: { cookie: "ayin_session=current-kids" },
        }),
      );
      expect(response.status).toBe(410);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({
        error: { code: "CLIPS_DIRECT_READ_REQUIRED" },
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("preserves invalid cursor rejection", async () => {
    const response = await GET(new NextRequest("http://localhost/api/clips?cursor=invalid"));
    expect(response.status).toBe(400);
  });
});
