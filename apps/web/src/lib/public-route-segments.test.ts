import { describe, expect, it } from "vitest";

import { decodePublicPlaylistRouteSegments } from "./public-route-segments";

describe("public playlist route segments", () => {
  const valid = { handle: "نور_أفلام.١", slug: "أفلام-كلاسيكية-12ab34cd" };

  it.each([
    valid,
    { handle: encodeURIComponent(valid.handle), slug: encodeURIComponent(valid.slug) },
    { handle: valid.handle, slug: encodeURIComponent(valid.slug) },
  ])("accepts decoded or once-encoded Unicode identifiers: %j", (segments) => {
    expect(decodePublicPlaylistRouteSegments(segments)).toEqual(valid);
  });

  it.each([
    { handle: "studio.one-two_3", slug: "uploads" },
    { handle: "映画", slug: "Été-٢٠٢٦" },
    { handle: "A", slug: "a" },
    { handle: "a".repeat(80), slug: "a".repeat(160) },
  ])("preserves valid identifiers without case or Unicode normalization: %j", (segments) => {
    expect(decodePublicPlaylistRouteSegments(segments)).toEqual(segments);
  });

  it.each([
    "",
    "%",
    "%2",
    "%GG",
    "%D8",
    "%C0%AF",
    "%ED%A0%80",
    "%25",
    "100%25",
    "%252F",
    "%2525",
    encodeURIComponent(encodeURIComponent(valid.slug)),
    "%2F",
    "%5c",
    "a/b",
    "a\\b",
    "%00",
    "%0D%0A",
    "a\nb",
    "a\u202eb",
    "a?kids=0",
    "a%23fragment",
    "//example.com",
    "https:%2F%2Fexample.com",
    "a b",
    "\ud800",
  ])("rejects malformed, nested or unsafe encoding in either segment: %j", (value) => {
    expect(decodePublicPlaylistRouteSegments({ ...valid, handle: value })).toBeNull();
    expect(decodePublicPlaylistRouteSegments({ ...valid, slug: value })).toBeNull();
  });

  it("enforces the distinct handle and stored playlist slug contracts", () => {
    for (const handle of ["a".repeat(81), ".studio", "studio_", "-studio"]) {
      expect(decodePublicPlaylistRouteSegments({ ...valid, handle })).toBeNull();
    }
    for (const slug of ["a".repeat(161), "a.b", "a_b", ".", ".."]) {
      expect(decodePublicPlaylistRouteSegments({ ...valid, slug })).toBeNull();
    }
  });
});
