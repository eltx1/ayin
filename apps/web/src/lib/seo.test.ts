import { describe, expect, it } from "vitest";

import { absoluteUrl, isoDuration, seoDescription, serializeJsonLd } from "./seo";

describe("SEO helpers", () => {
  it("builds absolute AYIN URLs without duplicate slashes", () => {
    expect(absoluteUrl("/watch/example")).toMatch(/^https?:\/\/[^/]+\/watch\/example$/);
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
