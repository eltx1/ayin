import { describe, expect, it } from "vitest";

import { isClipCursor, mergeClipItems, parseClipsPage } from "./clips";

const id = "00000000-0000-4000-8000-000000000001";
const channelId = "00000000-0000-4000-8000-000000000002";
const item = {
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
        enabled: true,
        items: [{ ...item, mediaAssets: [] }],
        nextCursor: null,
        autoplayEnabled: true,
        adPolicy: { enabled: false, minimumOrganicClips: 6 },
      },
      {
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
