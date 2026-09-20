import { describe, expect, it } from "vitest";

import {
  createLiveAttemptGuard,
  liveEdgeSnapshot,
  liveReconnectDelayMs,
  moveToLiveEdge,
  usefulLiveLatencyLabel,
} from "./live-playback";

function ranges(...values: Array<[number, number]>): TimeRanges {
  return {
    length: values.length,
    start(index: number) {
      const value = values[index];
      if (!value) throw new DOMException("Index out of range");
      return value[0];
    },
    end(index: number) {
      const value = values[index];
      if (!value) throw new DOMException("Index out of range");
      return value[1];
    },
  };
}

describe("live playback policy", () => {
  it("invalidates superseded async connection attempts", () => {
    const guard = createLiveAttemptGuard();
    const first = guard.begin();
    expect(guard.isCurrent(first)).toBe(true);

    guard.invalidate();
    expect(guard.isCurrent(first)).toBe(false);

    const second = guard.begin();
    expect(guard.isCurrent(second)).toBe(true);
    expect(guard.isCurrent(first)).toBe(false);
  });

  it("uses bounded exponential reconnect delays and then stops automatically", () => {
    expect(Array.from({ length: 7 }, (_, attempt) => liveReconnectDelayMs(attempt))).toEqual([
      1_000,
      2_000,
      4_000,
      8_000,
      15_000,
      30_000,
      null,
    ]);
    expect(liveReconnectDelayMs(-1)).toBeNull();
  });

  it("measures live-edge drift without inventing VOD duration semantics", () => {
    const video = { currentTime: 118, seekable: ranges([60, 120]) };
    const snapshot = liveEdgeSnapshot(video as never);
    expect(snapshot).toMatchObject({
      seekableStartSeconds: 60,
      seekableEndSeconds: 120,
      behindLiveSeconds: 2,
      atLiveEdge: true,
    });
    expect(usefulLiveLatencyLabel(snapshot)).toBeNull();

    video.currentTime = 110;
    const behind = liveEdgeSnapshot(video as never);
    expect(behind.atLiveEdge).toBe(false);
    expect(usefulLiveLatencyLabel(behind)).toBe("≈ 10s behind live");
  });

  it("resume-to-live jumps to the latest seekable edge", () => {
    const video = { currentTime: 80, seekable: ranges([60, 120]) };
    expect(moveToLiveEdge(video as never)).toBe(true);
    expect(video.currentTime).toBeCloseTo(119.85, 2);
  });

  it("handles a not-yet-seekable live manifest safely", () => {
    const video = { currentTime: 0, seekable: ranges() };
    expect(liveEdgeSnapshot(video as never)).toEqual({
      seekableStartSeconds: null,
      seekableEndSeconds: null,
      behindLiveSeconds: null,
      atLiveEdge: true,
    });
    expect(moveToLiveEdge(video as never)).toBe(false);
  });
});
