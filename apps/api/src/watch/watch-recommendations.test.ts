import { describe, expect, it } from "vitest";
import { selectWatchRecommendations } from "./watch-recommendations.js";
const current = { id: "current", contentType: "MOVIE", channel: { id: "a" } };
const candidate = (id: string, channel = "a", contentType = "MOVIE") => ({
  id,
  contentType,
  channel: { id: channel },
});
describe("watch recommendations", () => {
  it("excludes the current video and duplicates and gives other creators space", () => {
    const result = selectWatchRecommendations(
      [
        current,
        candidate("1"),
        candidate("2"),
        candidate("3"),
        candidate("4", "b"),
        candidate("4", "b"),
      ],
      current,
    );
    expect(result.map((item) => item.id)).toEqual(["1", "2", "4", "3"]);
  });
  it("prefers the matching type, stays bounded and can fill a one-creator catalogue", () => {
    const items = [
      candidate("other", "b", "DOCUMENTARY"),
      ...Array.from({ length: 20 }, (_, i) => candidate(String(i))),
    ];
    const result = selectWatchRecommendations(items, current);
    expect(result).toHaveLength(12);
    expect(result[0]?.id).toBe("0");
    expect(result.map((item) => item.id)).toContain("other");
    expect(selectWatchRecommendations([], current)).toEqual([]);
  });
});
