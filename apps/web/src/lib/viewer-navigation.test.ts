import { describe, expect, it } from "vitest";

import { navigationItems, type NavigationFlagState } from "./navigation";
import { buildViewerNavigation, fallbackProductNavigation } from "./viewer-navigation";

const flags: NavigationFlagState = Object.fromEntries(
  navigationItems.flatMap((item) => ("featureFlag" in item ? [[item.featureFlag, true]] : [])),
);

describe("viewer information architecture", () => {
  it("starts with safe core navigation before feature flags load", () => {
    const model = buildViewerNavigation({});
    expect(model.primary.map((item) => item.href)).toEqual(["/", "/search"]);
    expect(model.browse).toEqual([]);
  });

  it("groups discovery without losing enabled content or creating competing Clips", () => {
    const model = buildViewerNavigation(flags);
    expect(model.primary).toHaveLength(5);
    expect(model.primary.map((item) => item.href)).toContain("/browse");
    expect(model.primary.map((item) => item.href)).not.toContain("/movies");
    expect(model.browse.map((item) => item.href)).toEqual([
      "/movies",
      "/series",
      "/creators",
      "/clips",
      "/kids",
    ]);
  });

  it("respects disabled controls, unknown flags and configured destination/order", () => {
    const custom = [
      ...fallbackProductNavigation.filter((item) => item.key !== "home").reverse(),
      { key: "community", label: "Community", href: "/community", enabled: true, featureFlag: null },
      { key: "off", label: "Off", href: "/hidden", enabled: false, featureFlag: null },
      { key: "new", label: "New", href: "/new", enabled: true, featureFlag: "unknown.flag" },
    ];
    const model = buildViewerNavigation({ ...flags, "navigation.movies": false }, custom);
    expect(model.primary[0]?.href).toBe("/browse");
    expect(model.primary[1]?.href).toBe("/search");
    expect(model.primary.some((item) => item.key === "home")).toBe(false);
    expect(model.browse.map((item) => item.href)).toContain("/community");
    expect(model.browse.map((item) => item.href)).not.toContain("/movies");
    expect(model.browse.some((item) => ["off", "new"].includes(item.key))).toBe(false);
  });

  it("normalizes legacy aliases and preserves query/locale without duplicate destinations", () => {
    const model = buildViewerNavigation(flags, [
      { key: "shorts", label: "Clips", href: "/ar/shorts?from=menu", enabled: true, featureFlag: null },
      { key: "copy", label: "Copy", href: "/ar/clips?from=menu", enabled: true, featureFlag: null },
    ]);
    expect(model.browse.map((item) => item.href)).toEqual(["/ar/clips?from=menu"]);
    expect(model.primary.map((item) => item.href)).toEqual(["/browse"]);
  });
});
