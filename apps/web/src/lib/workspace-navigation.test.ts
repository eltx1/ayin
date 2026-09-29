import { describe, expect, it } from "vitest";

import { navigationAr, navigationEn } from "./i18n/resources/navigation";
import { hasTranslation } from "./i18n/translator";
import {
  adminNavigation,
  isNavigationCurrent,
  studioNavigation,
  visibleAdminNavigation,
  workspaceLocation,
} from "./workspace-navigation";

const destinations = (groups: typeof adminNavigation) =>
  groups.flatMap((group) => group.items.map((item) => item.href));

describe("workspace information architecture", () => {
  it("keeps all existing Admin and Studio destinations exactly once", () => {
    const inventories = [
      { groups: adminNavigation, count: 19 },
      { groups: studioNavigation, count: 12 },
    ];
    for (const { groups, count } of inventories) {
      const hrefs = destinations(groups);
      expect(hrefs).toHaveLength(count);
      expect(new Set(hrefs).size).toBe(count);
      for (const group of groups) {
        expect(hasTranslation("ar", group.label)).toBe(true);
        for (const item of group.items) expect(hasTranslation("ar", item.label)).toBe(true);
      }
    }
    expect(destinations(studioNavigation)).toContain("/studio/content");
    expect(destinations(adminNavigation)).toContain("/admin/video-ads");
  });

  it("preserves role visibility and excludes empty groups without mutating the source", () => {
    expect(visibleAdminNavigation([])).toEqual([]);
    expect(destinations(visibleAdminNavigation(["SUPERADMIN"]))).toHaveLength(19);
    expect(destinations(visibleAdminNavigation(["ADMIN"]))).toHaveLength(19);
    expect(destinations(visibleAdminNavigation(["FINANCE_MANAGER"]))).toEqual([
      "/admin",
      "/admin/revenue",
      "/admin/operations",
    ]);
    expect(destinations(visibleAdminNavigation(["AD_MANAGER"]))).toEqual([
      "/admin",
      "/admin/advertising",
      "/admin/video-ads",
      "/admin/operations",
    ]);
    const moderator = destinations(visibleAdminNavigation(["CONTENT_MODERATOR"]));
    expect(moderator).toContain("/admin/videos");
    expect(moderator).not.toContain("/admin/movies");
    expect(moderator).not.toContain("/admin/revenue");
    const operations = destinations(visibleAdminNavigation(["OPERATIONS"]));
    expect(operations).toContain("/admin/users");
    expect(operations).not.toContain("/admin/advertising");
    expect(operations).not.toContain("/admin/revenue");
    expect(destinations(adminNavigation)).toHaveLength(19);
  });

  it("matches locale and nested paths without prefix collisions or active-root noise", () => {
    expect(isNavigationCurrent("/ar/studio/content", "/studio")).toBe(false);
    expect(isNavigationCurrent("/ar/studio/content/", "/studio/content")).toBe(true);
    expect(isNavigationCurrent("/admin/videos-other", "/admin/videos")).toBe(false);
    expect(isNavigationCurrent("/admin/revenue/payouts/example", "/admin/revenue")).toBe(true);
    expect(isNavigationCurrent("/ar/studio", "/ar/studio")).toBe(true);
    expect(isNavigationCurrent(null, "/studio")).toBe(false);
    expect(isNavigationCurrent("/", "//elsewhere.test")).toBe(false);
    const location = workspaceLocation("/ar/admin/revenue/payouts/example", adminNavigation);
    expect(location?.group.id).toBe("monetization");
    expect(location?.item.href).toBe("/admin/revenue");
    expect(location?.detail).toBe(true);
    expect(workspaceLocation("/admin/users", visibleAdminNavigation(["AD_MANAGER"]))).toBeNull();
  });

  it("has complete English and Arabic navigation resources", () => {
    expect(Object.keys(navigationAr).sort()).toEqual(Object.keys(navigationEn).sort());
    for (const value of Object.values(navigationAr)) expect(value.trim()).not.toBe("");
  });
});
