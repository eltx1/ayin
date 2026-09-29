import { describe, expect, it } from "vitest";

import { navigationItems, type NavigationFlagState } from "./navigation";
import {
  buildViewerNavigation,
  fallbackProductNavigation,
  isProductNavigationItem,
  type ProductNavigationItem,
} from "./viewer-navigation";

const flags: NavigationFlagState = Object.fromEntries(
  navigationItems.flatMap((entry) => ("featureFlag" in entry ? [[entry.featureFlag, true]] : [])),
);
const item = (key: string, href: string): ProductNavigationItem => ({
  key,
  label: key,
  href,
  enabled: true,
  featureFlag: null,
});

describe("viewer information architecture", () => {
  it("starts with safe core navigation before feature flags load", () => {
    const model = buildViewerNavigation({});
    expect(model.primary.map((entry) => entry.href)).toEqual(["/", "/search"]);
    expect(model.browse).toEqual([]);
  });

  it("groups discovery without losing enabled content or creating competing Clips", () => {
    const model = buildViewerNavigation(flags);
    expect(model.primary).toHaveLength(5);
    expect(model.primary.map((entry) => entry.href)).toContain("/browse");
    expect(model.primary.map((entry) => entry.href)).not.toContain("/movies");
    expect(model.browse.map((entry) => entry.href)).toEqual([
      "/movies",
      "/series",
      "/creators",
      "/clips",
      "/kids",
    ]);
  });

  it("respects disabled controls, unknown flags and configured destination/order", () => {
    const custom = [
      ...fallbackProductNavigation.filter((entry) => entry.key !== "home").reverse(),
      item("community", "/community"),
      { ...item("off", "/hidden"), enabled: false },
      { ...item("new", "/new"), featureFlag: "unknown.flag" },
    ];
    const model = buildViewerNavigation({ ...flags, "navigation.movies": false }, custom);
    expect(model.primary[0]?.href).toBe("/browse");
    expect(model.primary[1]?.href).toBe("/search");
    expect(model.primary.some((entry) => entry.key === "home")).toBe(false);
    expect(model.browse.map((entry) => entry.href)).toContain("/community");
    expect(model.browse.map((entry) => entry.href)).not.toContain("/movies");
    expect(model.browse.some((entry) => ["off", "new"].includes(entry.key))).toBe(false);
  });

  it("normalizes aliases while preserving query and locale without duplicates", () => {
    const model = buildViewerNavigation(flags, [
      item("shorts", "/ar/shorts?from=menu"),
      item("copy", "/ar/clips?from=menu"),
    ]);
    expect(model.browse.map((entry) => entry.href)).toEqual(["/ar/clips?from=menu"]);
    expect(model.primary.map((entry) => entry.href)).toEqual(["/browse"]);
  });

  it("bounds primary choices, rejects unsafe URLs and avoids a self-only Browse loop", () => {
    const model = buildViewerNavigation(flags, [
      ...fallbackProductNavigation,
      item("home", "/second-home"),
      item("elsewhere", "//elsewhere.test/path"),
      item("backslash", "/\\elsewhere.test/path"),
      item("control", "/\nelsewhere.test/path"),
    ]);
    expect(model.primary).toHaveLength(5);
    expect(model.browse).toHaveLength(5);
    expect(buildViewerNavigation(flags, [item("hub", "/browse")])).toEqual({
      primary: [],
      browse: [],
    });
    expect(isProductNavigationItem(null)).toBe(false);
    expect(isProductNavigationItem({ key: "invalid" })).toBe(false);
    expect(isProductNavigationItem(item("home", "/"))).toBe(true);
  });
});
