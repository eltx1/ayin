import { describe, expect, it } from "vitest";

import { pageAdSlotDefinition } from "./ad-slot-catalog.js";
import { pageAdLayoutSlot, reservedAdHeight } from "./page-ad-layout.js";
import type { PageAdPlacementConfig } from "./page-ad-policy.js";

function config(key: string, demand: PageAdPlacementConfig["demand"]): PageAdPlacementConfig {
  const slot = pageAdSlotDefinition(key)!;
  return {
    routePatterns: slot.routePatterns,
    sizes: slot.sizes,
    responsive: slot.responsive,
    devices: slot.devices,
    audience: "ANY",
    categories: [],
    demand,
    fallback: "COLLAPSE",
  };
}

describe("reserved ad space", () => {
  it("holds the tallest mapped Ad Manager size per breakpoint", () => {
    const header = config("header_below", { source: "GAM_UNIT", adUnitPath: "/1/AYIN/header" });
    expect(pageAdLayoutSlot("header_below", header)).toMatchObject({ mobile: 100, desktop: 90 });
    const watch = config("watch_below_player", { source: "GAM_UNIT", adUnitPath: "/1/AYIN/w" });
    expect(pageAdLayoutSlot("watch_below_player", watch)).toMatchObject({
      mobile: 250,
      desktop: 90,
    });
  });

  it("uses a fixed code height, else the smallest expected banner", () => {
    const fixed = config("header_below", {
      source: "CODE",
      adUnitPath: null,
      code: "<div></div>",
      height: 60,
    });
    expect(reservedAdHeight(fixed, 360)).toBe(60);
    const auto = config("header_below", {
      source: "CODE",
      adUnitPath: null,
      code: "<div></div>",
      height: null,
    });
    expect(reservedAdHeight(auto, 360)).toBe(50);
  });

  it("reserves nothing on a device the slot does not serve", () => {
    const sidebar = config("desktop_sidebar", { source: "GAM_UNIT", adUnitPath: "/1/AYIN/side" });
    expect(pageAdLayoutSlot("desktop_sidebar", sidebar)).toMatchObject({
      mobile: 0,
      desktop: 600,
    });
  });

  it("only maps sizes that fit when a slot has no responsive mapping", () => {
    const detail = config("content_detail", { source: "GAM_UNIT", adUnitPath: "/1/AYIN/d" });
    expect(reservedAdHeight({ ...detail, responsive: [] }, 360)).toBe(250);
  });
});
