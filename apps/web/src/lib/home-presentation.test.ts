import { describe, expect, it } from "vitest";
import type { DiscoveryRowData } from "./discovery";
import { discoveryRowTitle, formatMediaDuration, homeSectionAnchor } from "./home-presentation";

const row: DiscoveryRowData = {
  key: "auto-movies",
  title: "Films",
  source: "MOVIES",
  items: [],
  nextCursor: null,
  availability: "EMPTY",
  emptyMessage: "",
};
describe("home presentation", () => {
  it("localizes automatic classifications while preserving editorial titles", () => {
    expect(discoveryRowTitle("ar", row, false, true)).toBe("أفلام");
    expect(discoveryRowTitle("en", row, false, true)).toBe("Films");
    expect(discoveryRowTitle("ar", { ...row, title: "An editorial title" })).toBe(
      "An editorial title",
    );
    expect(discoveryRowTitle("ar", { ...row, key: "cinema-month", title: "قصص من العالم" })).toBe(
      "قصص من العالم",
    );
  });
  it("makes safe distinct fragments for Unicode, whitespace and literal escapes", () => {
    const keys = ["أفلام", "two words", "%D8", "-D8", "6-1", "a"];
    const ids = keys.map(homeSectionAnchor);
    expect(new Set(ids).size).toBe(keys.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
      expect(decodeURIComponent(id)).toBe(id);
    }
  });
  it("shows actual runtime without rounding up or fabricating unknown duration", () => {
    expect(formatMediaDuration(807708)).toBe("13:27");
    expect(formatMediaDuration(726000)).toBe("12:06");
    expect(formatMediaDuration(3661000)).toBe("1:01:01");
    expect(formatMediaDuration(null)).toBeNull();
    expect(formatMediaDuration(0)).toBeNull();
  });
});
