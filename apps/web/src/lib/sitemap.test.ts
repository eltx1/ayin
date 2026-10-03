import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getSitemapCounts,
  getSitemapShard,
  getSitemapShardCount,
  getSitemapShardSize,
  parseSitemapShard,
  xmlEscape,
  xmlResponse,
} from "./sitemap";

afterEach(() => vi.unstubAllGlobals());

describe("SEO sitemap helpers", () => {
  it("keeps video sitemap shards intentionally small", () => {
    expect(getSitemapShardSize("videos")).toBeLessThanOrEqual(2_000);
    expect(getSitemapShardSize("videos")).toBeLessThan(getSitemapShardSize("channels"));
  });

  it("does not advertise empty sitemap shards", () => {
    expect(getSitemapShardCount("videos", 0)).toBe(0);
    expect(getSitemapShardCount("videos", 1)).toBe(1);
    expect(getSitemapShardCount("videos", 2_001)).toBe(2);
  });

  it("escapes XML-sensitive characters", () => {
    expect(xmlEscape(`A&B <video> \"clip\" 'test'`)).toBe(
      "A&amp;B &lt;video&gt; &quot;clip&quot; &apos;test&apos;",
    );
  });
  it("accepts only canonical safe shard filenames", () => {
    expect(parseSitemapShard("0.xml")).toBe(0);
    expect(parseSitemapShard("42.xml")).toBe(42);
    for (const name of [
      "0junk.xml",
      "01.xml",
      "-0.xml",
      "0.5.xml",
      "1e2.xml",
      " 0.xml",
      "9007199254740992.xml",
      "0.xml.extra",
    ])
      expect(parseSitemapShard(name)).toBeNull();
  });
  it("reads actual safe counts without cached or internal projection", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ videos: 2, channels: 1, playlists: 0, internal: "excluded" }),
      );
    vi.stubGlobal("fetch", fetcher);
    expect(await getSitemapCounts()).toEqual({ videos: 2, channels: 1, playlists: 0 });
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
    for (const value of [
      { videos: -1, channels: 0, playlists: 0 },
      { videos: 0, channels: "1", playlists: 0 },
      { videos: 0, channels: 0, playlists: 0.5 },
      null,
    ]) {
      fetcher.mockResolvedValueOnce(Response.json(value));
      await expect(getSitemapCounts()).rejects.toThrow("Invalid sitemap counts");
    }
  });
  it("fetches a current shard and rejects unsupported offsets before any request", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ items: [] }));
    vi.stubGlobal("fetch", fetcher);
    await expect(getSitemapShard("videos", 0)).resolves.toContain("<urlset");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
    for (const shard of [-1, 0.5, 500001, Number.MAX_SAFE_INTEGER])
      await expect(getSitemapShard("videos", shard)).rejects.toThrow("Invalid sitemap shard");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps policy-dependent XML uncached and only explicit static XML publicly cacheable", () => {
    expect(xmlResponse("<urlset/>").headers.get("cache-control")).toBe("no-store");
    expect(xmlResponse("<urlset/>", true).headers.get("cache-control")).toContain("public");
  });
});
