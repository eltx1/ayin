import { describe, expect, it } from "vitest";

import {
  buildCreatorTvSchedule,
  type CreatorTvLibraryItem,
} from "./creator-tv.scheduler.js";

const MINUTE = 60_000;
const epochMs = Date.UTC(2026, 7, 29, 0, 0, 0);

function item(
  id: string,
  durationMs: number | null,
  options: { priority?: number; sortOrder?: number | null; publishedOffsetMs?: number } = {},
): CreatorTvLibraryItem<{ title: string }> {
  return {
    id,
    durationMs,
    priority: options.priority ?? 0,
    sortOrder: options.sortOrder ?? null,
    publishedAtMs: epochMs + (options.publishedOffsetMs ?? 0),
    payload: { title: id },
  };
}

function schedule(items: CreatorTvLibraryItem<{ title: string }>[], nowOffsetMs: number) {
  return buildCreatorTvSchedule({
    epochMs,
    nowMs: epochMs + nowOffsetMs,
    windowMs: 20 * MINUTE,
    fallbackDurationMs: 5 * MINUTE,
    rotationMode: "PRIORITY_ORDER_OLDEST",
    items,
  });
}

describe("Creator TV automatic scheduler V1", () => {
  it("returns an honest empty schedule for an empty channel", () => {
    const result = schedule([], 3 * MINUTE);
    expect(result.cycleDurationMs).toBe(0);
    expect(result.nowPlaying).toBeNull();
    expect(result.upNext).toBeNull();
    expect(result.guide).toEqual([]);
  });

  it("loops one video continuously and reports the join offset", () => {
    const result = schedule([item("solo", 4 * MINUTE)], 9 * MINUTE);
    expect(result.cycleDurationMs).toBe(4 * MINUTE);
    expect(result.nowPlaying?.item.id).toBe("solo");
    expect(result.nowPlaying?.startsAtMs).toBe(epochMs + 8 * MINUTE);
    expect(result.nowPlaying?.playbackOffsetMs).toBe(1 * MINUTE);
    expect(result.upNext?.item.id).toBe("solo");
    expect(result.upNext?.startsAtMs).toBe(epochMs + 12 * MINUTE);
  });

  it("keeps a deterministic multi-video rotation using priority and explicit order", () => {
    const result = schedule(
      [
        item("later", 2 * MINUTE, { priority: 1, sortOrder: 2 }),
        item("first", 3 * MINUTE, { priority: 2, sortOrder: 9 }),
        item("second", 4 * MINUTE, { priority: 1, sortOrder: 1 }),
      ],
      0,
    );
    expect(result.guide.slice(0, 4).map((program) => program.item.id)).toEqual([
      "first",
      "second",
      "later",
      "first",
    ]);
    expect(result.guide.slice(0, 3).map((program) => program.endsAtMs - program.startsAtMs)).toEqual([
      3 * MINUTE,
      4 * MINUTE,
      2 * MINUTE,
    ]);
  });

  it("supports an excluded video by scheduling only the eligible library supplied to it", () => {
    const all = [item("included", 2 * MINUTE), item("excluded", 2 * MINUTE)];
    const result = schedule(all.filter((entry) => entry.id !== "excluded"), 5 * MINUTE);
    expect(new Set(result.guide.map((program) => program.item.id))).toEqual(new Set(["included"]));
  });

  it("rolls over the end of a cycle to the first deterministic item", () => {
    const result = schedule([item("a", 2 * MINUTE), item("b", 3 * MINUTE)], 4 * MINUTE + 30_000);
    expect(result.nowPlaying?.item.id).toBe("b");
    expect(result.nowPlaying?.playbackOffsetMs).toBe(2 * MINUTE + 30_000);
    expect(result.upNext?.item.id).toBe("a");
    expect(result.upNext?.startsAtMs).toBe(epochMs + 5 * MINUTE);

    const exactBoundary = schedule([item("a", 2 * MINUTE), item("b", 3 * MINUTE)], 5 * MINUTE);
    expect(exactBoundary.nowPlaying?.item.id).toBe("a");
    expect(exactBoundary.nowPlaying?.playbackOffsetMs).toBe(0);
  });
});
