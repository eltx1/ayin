import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAdminProductControls,
  mergeHomeRowFields,
  parseRegionTargets,
  type AdminHomeRow,
} from "./admin-product";
afterEach(() => vi.unstubAllGlobals());
describe("merchandising drafts and request contracts", () => {
  it("normalizes regional targets and enforces the backend shape and limit", () => {
    expect(parseRegionTargets("de, JP de\nBR")).toEqual(["DE", "JP", "BR"]);
    expect(parseRegionTargets("  ")).toEqual([]);
    expect(() => parseRegionTargets("DE, invalid")).toThrow("INVALID_REGIONS");
    expect(() =>
      parseRegionTargets(
        Array.from({ length: 65 }, (_, i) =>
          String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)),
        ).join(","),
      ),
    ).toThrow();
  });
  it("applies only confirmed fields without losing same-row or unrelated drafts", () => {
    const rows = [
      { id: "one", title: "Unsaved title", targetRegions: [], manualItems: [] },
      { id: "two", title: "Other draft" },
    ] as unknown as AdminHomeRow[];
    const result = mergeHomeRowFields(
      rows,
      "one",
      { title: "Persisted old title", targetRegions: ["DE"] },
      ["targetRegions"],
    );
    expect(result[0]).toEqual({ ...rows[0], targetRegions: ["DE"] });
    expect(result[1]).toBe(rows[1]);
    expect(rows[0]!.targetRegions).toEqual([]);
    expect(mergeHomeRowFields(rows, "one", {}, ["manualItems"])[0]!.manualItems).toEqual([]);
  });
  it("uses a single abortable private snapshot read without caching", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ rows: [], controls: {} })));
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    await getAdminProductControls(signal);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("/admin/product-controls"),
      expect.objectContaining({ credentials: "include", cache: "no-store", signal }),
    );
  });
});
