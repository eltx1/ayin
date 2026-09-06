import { describe, expect, it } from "vitest";

import { absoluteUrl, isoDuration, seoDescription, serializeJsonLd } from "./seo";

describe("SEO helpers", () => {
  it("builds canonical AYIN URLs while preserving already absolute URLs", () => {
    expect(absoluteUrl("/watch/example")).toMatch(/^https?:\/\/[^/]+\/watch\/example$/);
    expect(absoluteUrl("https://media.example/video.mp4")).toBe(
      "https://media.example/video.mp4",
    );
  });

  it("derives concise descriptions without asking creators for extra SEO fields", () => {
    expect(seoDescription(null, "  Watch   this   video on AYIN. ")).toBe(
      "Watch this video on AYIN.",
    );
    expect(seoDescription("x".repeat(200), "fallback", 20)).toHaveLength(20);
  });

  it("formats video duration for VideoObject structured data", () => {
    expect(isoDuration(3_661_000)).toBe("PT1H1M1S");
    expect(isoDuration(61_000)).toBe("PT1M1S");
    expect(isoDuration(null)).toBeUndefined();
  });

  it("escapes less-than signs before embedding JSON-LD in HTML", () => {
    expect(serializeJsonLd({ title: "<script>" })).toContain("\\u003cscript>");
  });
});
