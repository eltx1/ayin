import { describe, expect, it } from "vitest";
import { canReadModeration, parseModerationPage } from "./admin-moderation";
const id = "00000000-0000-4000-8000-000000000001";
const row = () => ({
  id,
  reason: "OTHER",
  status: "OPEN",
  createdAt: "2026-10-01T00:00:00Z",
  details: "Details",
  reporterProfile: { id, name: "Reporter", slug: "reporter" },
  channel: null,
  video: null,
  comment: { id, body: "A".repeat(1000) + "END" },
  moderationCase: { id, status: "ACTIONED", summary: "Case summary" },
});
const page = () => ({ reports: [row()], pagination: { page: 1, take: 25, total: 1, pages: 1 } });
describe("moderation read boundary", () => {
  it("preserves full reported comments and optional case data", () => {
    const result = parseModerationPage(page(), 1, "");
    expect(result.reports[0]?.comment?.body).toHaveLength(1003);
    expect(result.reports[0]?.moderationCase?.summary).toBe("Case summary");
  });
  it("accepts empty later pages after live queue changes", () => {
    expect(
      parseModerationPage(
        { reports: [], pagination: { page: 2, take: 25, total: 0, pages: 1 } },
        2,
        "",
      ).reports,
    ).toEqual([]);
  });
  it("rejects foreign query pages, statuses and duplicate IDs", () => {
    expect(() => parseModerationPage(page(), 2, "")).toThrow();
    expect(() => parseModerationPage(page(), 1, "RESOLVED")).toThrow();
    expect(() =>
      parseModerationPage(
        {
          ...page(),
          reports: [row(), row()],
          pagination: { page: 1, take: 25, total: 2, pages: 1 },
        },
        1,
        "",
      ),
    ).toThrow();
  });
  it("rejects unknown status/reason, invalid dates and unsafe record shapes", () => {
    for (const patch of [
      { status: "UNKNOWN" },
      { reason: "UNKNOWN" },
      { createdAt: "bad" },
      { id: "foreign" },
      { reporterProfile: null },
      { comment: { id, body: 4 } },
    ])
      expect(() =>
        parseModerationPage({ ...page(), reports: [{ ...row(), ...patch }] }, 1, ""),
      ).toThrow();
  });
  it("rejects unbounded pages and inconsistent counts", () => {
    expect(() =>
      parseModerationPage(
        { reports: Array(26).fill(row()), pagination: { page: 1, take: 25, total: 26, pages: 2 } },
        1,
        "",
      ),
    ).toThrow();
    for (const patch of [
      { pages: 3 },
      { total: -1 },
      { take: 100 },
      { total: Number.MAX_SAFE_INTEGER + 1 },
    ])
      expect(() =>
        parseModerationPage({ ...page(), pagination: { ...page().pagination, ...patch } }, 1, ""),
      ).toThrow();
  });
  it("keeps finance and ads roles outside moderation scope", () => {
    expect(canReadModeration(["FINANCE_MANAGER", "AD_MANAGER"])).toBe(false);
    for (const role of ["SUPERADMIN", "ADMIN", "OPERATIONS", "CONTENT_MODERATOR"] as const)
      expect(canReadModeration([role])).toBe(true);
  });
});
