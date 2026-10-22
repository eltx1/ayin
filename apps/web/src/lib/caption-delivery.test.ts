import { describe, expect, it } from "vitest";

import { captionObjectKey, captionTrackPath } from "./caption-delivery";

const videoId = "11111111-1111-4111-8111-111111111111";
const assetId = "22222222-2222-4222-8222-222222222222";
const key = `captions/videos/${videoId}/${assetId}/track.vtt`;

describe("owned caption addresses", () => {
  it("maps the upload namespace to a same-origin track URL", () => {
    expect(captionObjectKey(videoId, assetId)).toBe(key);
    expect(captionTrackPath(key)).toBe(`/api/captions/${videoId}/${assetId}`);
  });

  it.each([
    "ar.vtt",
    `https://media.example/${key}`,
    `/${key}`,
    `${key}\n`,
    `${key}?url=https://example.com`,
    key.replace("track.vtt", "source.mp4"),
    key.replace(assetId, ".."),
    key.replace(assetId, "%2e%2e"),
    key.replace(assetId, `${assetId}/extra`),
    key.replace(videoId, "not-a-uuid"),
  ])("does not turn another asset or caller URL into a proxy target: %s", (value) => {
    expect(captionTrackPath(value)).toBeNull();
  });
});
