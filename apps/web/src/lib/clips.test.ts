import { describe, expect, it } from "vitest";

import {
  createClipsAutoplayGate,
  captureClipPlaybackPosition,
  isClipCursor,
  mergeClipItems,
  parseClipsPage,
  type ClipItem,
} from "./clips";

const id = "00000000-0000-4000-8000-000000000001";
const channelId = "00000000-0000-4000-8000-000000000002";
const item: ClipItem = {
  id,
  slug: "clip-one",
  title: "Clip one",
  description: null,
  durationMs: 20_000,
  channel: { id: channelId, handle: "creator", name: "Creator" },
  mediaAssets: [{ kind: "SOURCE_VIDEO", r2ObjectKey: "clips/one.mp4" }],
  _count: { reactions: 3 },
};

describe("Clips Viewer contracts", () => {
  it("accepts a bounded playable page and rejects malformed false-empty payloads", () => {
    expect(
      parseClipsPage({
        viewer: { isKids: false },
        enabled: true,
        items: [item],
        nextCursor: id,
        autoplayEnabled: true,
        adPolicy: { enabled: false, minimumOrganicClips: 6 },
      }),
    ).toMatchObject({ enabled: true, nextCursor: id, items: [{ id }] });

    for (const invalid of [
      null,
      {},
      { enabled: true, items: "none", nextCursor: null, autoplayEnabled: true, adPolicy: {} },
      {
        viewer: { isKids: false },
        enabled: true,
        items: [{ ...item, mediaAssets: [] }],
        nextCursor: null,
        autoplayEnabled: true,
        adPolicy: { enabled: false, minimumOrganicClips: 6 },
      },
      {
        viewer: { isKids: false },
        enabled: true,
        items: [item],
        nextCursor: "not-a-cursor",
        autoplayEnabled: true,
        adPolicy: { enabled: false, minimumOrganicClips: 6 },
      },
    ]) {
      expect(() => parseClipsPage(invalid)).toThrow("INVALID_CLIPS_RESPONSE");
    }
  });

  it("deduplicates continuation pages without reordering current clips", () => {
    const second = { ...item, id: "00000000-0000-4000-8000-000000000003", slug: "clip-two" };
    expect(mergeClipItems([item], [item, second]).map((entry) => entry.id)).toEqual([
      item.id,
      second.id,
    ]);
  });

  it("accepts only UUID cursors", () => {
    expect(isClipCursor(id)).toBe(true);
    expect(isClipCursor("clip-one")).toBe(false);
  });
});

describe("Clips autoplay after audience restoration", () => {
  it("preserves the deliberate active pause, then autoplays an offscreen Clip and a return visit", () => {
    const autoplay = createClipsAutoplayGate({
      activeId: "current",
      playback: { current: { paused: true }, offscreen: { paused: true } },
    });
    expect(autoplay("current", true, false)).toBe(false);
    // Repeated intersection notifications or a pagination observer rebuild
    // must not undo the currently restored viewer's deliberate pause.
    expect(autoplay("current", true, false)).toBe(false);
    expect(autoplay("offscreen", true, false)).toBe(true);
    expect(autoplay("current", true, false)).toBe(true);
    expect(autoplay("offscreen", true, false)).toBe(true);
  });

  it("does not infer a deliberate pause from inactive media or missing state", () => {
    const autoplay = createClipsAutoplayGate({
      activeId: "current",
      playback: { current: { paused: false }, offscreen: { paused: true } },
    });
    expect(autoplay("current", true, false)).toBe(true);
    expect(autoplay("offscreen", true, false)).toBe(true);
    expect(createClipsAutoplayGate()("new", true, false)).toBe(true);
  });

  it("still honors disabled autoplay and reduced motion after moving away", () => {
    const autoplay = createClipsAutoplayGate({
      activeId: "current",
      playback: { current: { paused: true }, offscreen: { paused: true } },
    });
    expect(autoplay("offscreen", false, false)).toBe(false);
    expect(autoplay("offscreen", true, true)).toBe(false);
    expect(autoplay("current", true, true)).toBe(false);
    expect(autoplay("current", true, false)).toBe(true);
  });
});

describe("Clips retention position provenance", () => {
  const media = {
    readyState: 4,
    currentTime: 0,
    paused: true,
    muted: false,
    volume: 0.4,
    playbackRate: 1.25,
  };
  it("keeps metadata-ready zero out of explicit restore while a progress read is pending", () => {
    expect(captureClipPlaybackPosition(media, false)).toEqual({
      positionMs: undefined,
      paused: true,
      muted: false,
      volume: 0.4,
      playbackRate: 1.25,
    });
  });
  it("retains an authoritative explicit zero and a verified saved position", () => {
    expect(captureClipPlaybackPosition(media, true).positionMs).toBe(0);
    expect(captureClipPlaybackPosition({ ...media, currentTime: 7.25 }, true).positionMs).toBe(
      7_250,
    );
  });
  it("requires media readiness even when the progress owner established a position", () => {
    expect(
      captureClipPlaybackPosition({ ...media, readyState: 0 }, true).positionMs,
    ).toBeUndefined();
  });
});

it("preserves a prior verified Clip position while replacement media awaits resume", () => {
  const media = {
    readyState: 4,
    currentTime: 0,
    paused: true,
    muted: true,
    volume: 1,
    playbackRate: 1,
  };
  expect(captureClipPlaybackPosition(media, false, 7_000).positionMs).toBe(7_000);
  expect(captureClipPlaybackPosition(media, true, 7_000).positionMs).toBe(0);
});
