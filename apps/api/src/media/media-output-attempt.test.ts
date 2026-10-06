import { expect, it } from "vitest";
import {
  canonicalFallbackObjectKey,
  hlsMasterObjectKey,
  hlsRenditionPlaylistObjectKey,
  hlsRenditionSegmentObjectKey,
} from "./media-architecture-v2.js";
import {
  capturedMediaClaim,
  outputAttemptAddresses,
  outputAttemptNamespace,
} from "./media-output-attempt.js";

const base = {
  channelId: "11111111-1111-4111-8111-111111111111",
  videoId: "22222222-2222-4222-8222-222222222222",
  generation: 1,
};
const firstId = "33333333-3333-4333-8333-333333333333";
const nextId = "44444444-4444-4444-8444-444444444444";
it("keeps the exact legacy generation and HLS key contract", () => {
  expect(canonicalFallbackObjectKey(base)).toBe(
    `channels/${base.channelId}/videos/${base.videoId}/playback/g1.mp4`,
  );
  expect(hlsMasterObjectKey(base)).toBe(
    `channels/${base.channelId}/videos/${base.videoId}/playback/g1/hls/master.m3u8`,
  );
  expect(
    capturedMediaClaim({ inputIntegrityVersion: 0, attempt: 4, currentOutputAttemptId: null }),
  ).toEqual({});
});
it("binds every required object to the immutable random attempt namespace", () => {
  const first = { ...base, outputAttemptId: firstId };
  const keys = outputAttemptAddresses(first);
  expect(keys).toEqual({
    prefix: `channels/${base.channelId}/videos/${base.videoId}/playback/g1/attempts/${firstId}/`,
    canonicalR2ObjectKey: `${keys.prefix}canonical.mp4`,
    hlsR2Prefix: `${keys.prefix}hls/`,
    thumbnailR2ObjectKey: `${keys.prefix}thumbnail.jpg`,
  });
  expect(hlsRenditionPlaylistObjectKey(first, "360p")).toBe(`${keys.hlsR2Prefix}360p/index.m3u8`);
  expect(hlsRenditionSegmentObjectKey(first, "360p", 1)).toBe(
    `${keys.hlsR2Prefix}360p/segment-000001.ts`,
  );
  const next = outputAttemptAddresses({ ...base, outputAttemptId: nextId });
  for (const field of Object.keys(keys) as (keyof typeof keys)[])
    expect(next[field]).not.toBe(keys[field]);
});
it("captures the original claim count and attempt rather than deriving a later claim", () => {
  const job = {
    inputIntegrityVersion: 1,
    attempt: 1,
    currentOutputAttemptId: firstId,
    videoId: base.videoId,
    generation: 1,
  };
  const captured = capturedMediaClaim(job);
  job.attempt = 2;
  job.currentOutputAttemptId = nextId;
  expect(captured).toEqual({ attempt: 1, outputAttemptId: firstId });
  expect(outputAttemptNamespace(job, base.channelId)).toEqual({ ...base, outputAttemptId: nextId });
});
it("fails closed for missing required attempt and non-UUID attempt paths", () => {
  expect(() =>
    capturedMediaClaim({ inputIntegrityVersion: 1, attempt: 1, currentOutputAttemptId: null }),
  ).toThrow(/captured output attempt/);
  expect(() => outputAttemptAddresses({ ...base, outputAttemptId: "../same-key" })).toThrow();
});
