import { describe, expect, it } from "vitest";

import { parseDiscoveryHome } from "./discovery-contracts";

const item = {
  id: "video-one",
  type: "VIDEO",
  title: "A real title",
  href: "/watch/a-real-title",
  kicker: "A creator",
  meta: "12:06",
  artworkObjectKey: "thumbnails/one.jpg",
};
const row = {
  key: "auto-discover",
  title: "Recently added",
  source: "RECENTLY_ADDED",
  items: [item],
  nextCursor: null,
  availability: "AVAILABLE",
  emptyMessage: "No videos",
};
const spotlight = { ...item, description: null, durationMs: 726000, channelName: "Creator" };

describe("home response boundary", () => {
  it("accepts the Admin limit of 100 managed rows, rejecting an unbounded payload", () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({ ...row, key: `editorial-${index}` }));
    expect(parseDiscoveryHome({ rows }).rows).toHaveLength(100);
    expect(() => parseDiscoveryHome({ rows: [...rows, { ...row, key: "overflow" }] })).toThrow();
  });
  it("accepts a legacy response during deployment without inventing featured content", () => {
    expect(parseDiscoveryHome({ rows: [row] })).toEqual({
      mode: "MANAGED",
      status: "READY",
      spotlight: null,
      rows: [row],
    });
    expect(parseDiscoveryHome({ rows: [] }).status).toBe("EMPTY");
  });
  it("accepts a single real spotlight as a ready small catalogue", () => {
    expect(
      parseDiscoveryHome({ mode: "AUTO", status: "READY", spotlight, rows: [] }).spotlight,
    ).toEqual(spotlight);
  });
  it("retains intentional disabled managed state and does not create fallback cards", () => {
    expect(
      parseDiscoveryHome({ mode: "MANAGED", status: "DISABLED", spotlight: null, rows: [] }),
    ).toEqual({ mode: "MANAGED", status: "DISABLED", spotlight: null, rows: [] });
  });
  it.each([
    "https://evil.invalid/watch",
    "//evil.invalid/watch",
    "/\\evil.invalid",
    "/watch/\nunsafe",
  ])("rejects unsafe spotlight destinations: %s", (href) => {
    expect(() =>
      parseDiscoveryHome({ mode: "AUTO", spotlight: { ...spotlight, href }, rows: [] }),
    ).toThrow();
  });
  it.each([
    { mode: "invented", rows: [] },
    { mode: "AUTO", status: "DISABLED", rows: [] },
    { mode: "AUTO", status: "READY", rows: [] },
    { mode: "AUTO", status: "EMPTY", rows: [row] },
    { mode: "AUTO", status: ["EMPTY"], rows: [] },
    { mode: "MANAGED", status: { value: "EMPTY" }, rows: [] },
    { mode: "MANAGED", spotlight, rows: [] },
    { mode: "AUTO", spotlight: { ...spotlight, durationMs: -1 }, rows: [] },
    { mode: "AUTO", spotlight: { ...spotlight, type: "CHANNEL" }, rows: [] },
    { rows: [row, row] },
    { rows: [{ ...row, items: [{ ...item, title: {} }] }] },
  ])(
    "rejects contradictory or malformed data instead of displaying a blank successful home",
    (response) => {
      expect(() => parseDiscoveryHome(response)).toThrow();
    },
  );
  it("preserves explicit Kids destinations and informational policy", () => {
    const policy = { mode: "KIDS", contentEligibility: "Explicit" };
    const result = parseDiscoveryHome({
      rows: [{ ...row, items: [{ ...item, href: "/watch/kids?kids=1" }] }],
      policy,
    });
    expect(result.rows[0]?.items[0]?.href).toBe("/watch/kids?kids=1");
    expect(result.policy).toEqual(policy);
  });
});
