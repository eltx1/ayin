import { describe, expect, it } from "vitest";

import { getSitemapShardCount, getSitemapShardSize, xmlEscape } from "./sitemap";

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
});
