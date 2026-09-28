import { describe, expect, it } from "vitest";
import { directoryPage, parseDirectoryQuery } from "./catalog-directory-query.js";

describe("public directory boundaries", () => {
  it("rejects malformed cursors, oversized pages and unknown parameters", () => {
    expect(parseDirectoryQuery({})).toEqual({ limit: 24 });
    expect(
      parseDirectoryQuery({ limit: "2", cursor: "00000000-0000-4000-8000-000000000001" }).limit,
    ).toBe(2);
    for (const query of [
      { limit: 0 },
      { limit: 25 },
      { limit: "1.5" },
      { cursor: "bad" },
      { offset: 1 },
      { locale: "" },
    ]) {
      expect(() => parseDirectoryQuery(query)).toThrow();
    }
  });
  it("keeps the lookahead out of results and permits complete traversal", () => {
    const rows = [{ id: "one" }, { id: "two" }, { id: "three" }];
    expect(directoryPage(rows, 2)).toEqual({ items: rows.slice(0, 2), nextCursor: "two" });
    expect(directoryPage(rows.slice(2), 2)).toEqual({ items: rows.slice(2), nextCursor: null });
    expect(directoryPage([], 2)).toEqual({ items: [], nextCursor: null });
  });
});
