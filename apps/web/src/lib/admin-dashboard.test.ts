import { describe, expect, it } from "vitest";
import {
  dashboardCounterKeys,
  parseAdminSession,
  parseDashboardAnalytics,
  parseDashboardCounters,
  parseDashboardFinance,
  parseDashboardSearch,
} from "./admin-dashboard";
import { adminDashboardAr, adminDashboardEn } from "./i18n/resources/admin-dashboard";
const id = "00000000-0000-4000-8000-000000000001";
describe("Administrative dashboard presentation boundary", () => {
  it("rejects malformed or ambiguous staff roles instead of opening controls", () => {
    expect(parseAdminSession({ accountId: id, roles: ["AD_MANAGER"] }).roles).toEqual([
      "AD_MANAGER",
    ]);
    for (const value of [
      { accountId: id, roles: [] },
      { accountId: id, roles: ["UNKNOWN"] },
      { accountId: id, roles: ["ADMIN", "ADMIN"] },
      { accountId: "invalid", roles: ["ADMIN"] },
    ])
      expect(() => parseAdminSession(value)).toThrow();
  });
  it("keeps actual zero distinct from malformed, fractional or negative counters", () => {
    const counters = Object.fromEntries(dashboardCounterKeys.map((key) => [key, 0]));
    expect(parseDashboardCounters(counters).accounts).toBe(0);
    for (const value of [
      {},
      { ...counters, accounts: -1 },
      { ...counters, accounts: 1.5 },
      { ...counters, accounts: Infinity },
    ])
      expect(() => parseDashboardCounters(value)).toThrow();
  });
  it("keeps exact financial strings and actual provider mode rather than assuming manual-only", () => {
    const value = {
      pendingPayouts: 1,
      processingPayouts: 0,
      openDisputes: 0,
      pendingValue: [{ currency: "USD", amount: "1234567890123456.78" }],
      mode: "PROVIDER_AND_MANUAL_PAYOUT",
      externalProvidersConnected: true,
      externalProvider: { provider: "configured", connected: true, productionEnabled: true },
    };
    const result = parseDashboardFinance(value);
    expect(result.pendingValue[0]?.amount).toBe("1234567890123456.78");
    expect(result.mode).toBe("PROVIDER_AND_MANUAL_PAYOUT");
    for (const item of [
      { ...value, pendingValue: [{ currency: "USD", amount: "NaN" }] },
      { ...value, mode: "UNKNOWN" },
      { ...value, pendingPayouts: -1 },
    ])
      expect(() => parseDashboardFinance(item)).toThrow();
  });
  it("rejects cross-origin, wrong-kind, duplicate and stale-query search results", () => {
    const item = {
      id,
      kind: "VIDEO",
      label: "Video",
      detail: "Channel",
      href: "/admin/videos?query=video",
    };
    expect(parseDashboardSearch({ query: "video", items: [item] }, "video")[0]?.href).toBe(
      item.href,
    );
    for (const value of [
      { query: "other", items: [item] },
      { query: "video", items: [{ ...item, href: "https://evil.test/admin/videos" }] },
      { query: "video", items: [{ ...item, href: "/admin/users" }] },
      { query: "video", items: [item, item] },
      { query: "video", items: Array(21).fill(item) },
    ])
      expect(() => parseDashboardSearch(value, "video")).toThrow();
  });
  it("enforces cohort privacy and ratio/date boundaries without fabricating missing retention", () => {
    const value = {
      refresh: "rollup",
      dateRange: { from: "2026-09-01", to: "2026-10-01", timezone: "UTC" },
      lastRollupCheck: null,
      dauApprox: 0,
      mauApprox: 0,
      watchHours: 0,
      uploads: 0,
      tvStarts: 0,
      adEvents: 0,
      errors: 0,
      cohorts: {
        minimumCohortSize: 10,
        identityScope: "SIGNED_IN_PROFILE_PSEUDONYMS",
        audienceDaily: [],
        retention: [],
      },
    };
    expect(parseDashboardAnalytics(value).lastRollupCheck).toBeNull();
    for (const cohort of [
      { cohortDate: "2026-09-01", cohortSize: 9, d1: null, d7: null, d30: null },
      { cohortDate: "invalid", cohortSize: 10, d1: null, d7: null, d30: null },
      { cohortDate: "2026-09-01", cohortSize: 10, d1: { retentionRate: 2 }, d7: null, d30: null },
    ])
      expect(() =>
        parseDashboardAnalytics({ ...value, cohorts: { ...value.cohorts, retention: [cohort] } }),
      ).toThrow();
  });
  it("keeps Arabic and English control/recovery vocabularies aligned", () => {
    expect(Object.keys(adminDashboardAr).sort()).toEqual(Object.keys(adminDashboardEn).sort());
    expect(Object.values(adminDashboardAr).every(Boolean)).toBe(true);
  });
});
