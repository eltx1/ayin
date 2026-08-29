import { describe, expect, it } from "vitest";

import { completionReached, resumablePositionMs, shouldPersistProgress } from "./player-progress";

describe("AYIN player watch-state helpers", () => {
  it("throttles routine progress writes but permits meaningful forced checkpoints", () => {
    expect(
      shouldPersistProgress({
        nowMs: 10_000,
        lastPersistedAtMs: 0,
        positionMs: 9_000,
        lastPersistedPositionMs: 0,
        intervalMs: 15_000,
      }),
    ).toBe(false);
    expect(
      shouldPersistProgress({
        nowMs: 16_000,
        lastPersistedAtMs: 0,
        positionMs: 15_000,
        lastPersistedPositionMs: 0,
        intervalMs: 15_000,
      }),
    ).toBe(true);
    expect(
      shouldPersistProgress({
        nowMs: 2_000,
        lastPersistedAtMs: 1_500,
        positionMs: 8_000,
        lastPersistedPositionMs: 6_000,
        intervalMs: 15_000,
        force: true,
      }),
    ).toBe(true);
  });

  it("resumes meaningful unfinished progress and restarts completed or near-finished videos", () => {
    expect(resumablePositionMs({ positionMs: 42_000, completedAt: null }, 120_000)).toBe(42_000);
    expect(resumablePositionMs({ positionMs: 1_500, completedAt: null }, 120_000)).toBe(0);
    expect(resumablePositionMs({ positionMs: 115_500, completedAt: null }, 120_000)).toBe(0);
    expect(
      resumablePositionMs({ positionMs: 42_000, completedAt: "2026-08-29T00:00:00Z" }, 120_000),
    ).toBe(0);
  });

  it("uses the configured threshold for completion", () => {
    expect(completionReached(89_000, 100_000, 90)).toBe(false);
    expect(completionReached(90_000, 100_000, 90)).toBe(true);
  });
});
