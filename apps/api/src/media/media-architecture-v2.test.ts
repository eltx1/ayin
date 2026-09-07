import { describe, expect, it } from "vitest";

import {
  canMarkAdaptiveGenerationReady,
  canonicalFallbackObjectKey,
  hlsMasterObjectKey,
  hlsRenditionPlaylistObjectKey,
  hlsRenditionSegmentObjectKey,
  hlsRenditionSegmentPrefix,
  MEDIA_ARCHITECTURE_VERSION,
  MEDIA_FALLBACK_PROFILE,
  MEDIA_HLS_PROFILE,
  planAdaptiveRenditions,
} from "./media-architecture-v2.js";

const namespace = {
  channelId: "11111111-1111-4111-8111-111111111111",
  videoId: "22222222-2222-4222-8222-222222222222",
  generation: 3,
};

describe("AYIN media architecture V2 contracts", () => {
  it("pins the initial codecs, containers and processing contract version", () => {
    expect(MEDIA_ARCHITECTURE_VERSION).toBe(2);
    expect(MEDIA_FALLBACK_PROFILE).toEqual({
      protocol: "PROGRESSIVE",
      container: "MP4",
      videoCodec: "H264",
      audioCodec: "AAC",
      pixelFormat: "yuv420p",
    });
    expect(MEDIA_HLS_PROFILE).toEqual({
      protocol: "HLS",
      container: "MPEG_TS",
      videoCodec: "H264",
      audioCodec: "AAC",
      pixelFormat: "yuv420p",
    });
  });

  it("creates only renditions justified by the normalized source height", () => {
    expect(planAdaptiveRenditions({ width: 640, height: 359 })).toEqual([]);
    expect(planAdaptiveRenditions({ width: 640, height: 360 }).map((item) => item.identity)).toEqual([
      "360p",
    ]);
    expect(planAdaptiveRenditions({ width: 854, height: 480 }).map((item) => item.identity)).toEqual([
      "360p",
      "480p",
    ]);
    expect(
      planAdaptiveRenditions({ width: 1_280, height: 720 }).map((item) => item.identity),
    ).toEqual(["360p", "480p", "720p"]);
    expect(
      planAdaptiveRenditions({ width: 1_920, height: 1_080 }).map((item) => item.identity),
    ).toEqual(["360p", "480p", "720p", "1080p"]);
  });

  it("never plans production output above 1080p even for a 4K source", () => {
    const renditions = planAdaptiveRenditions({ width: 3_840, height: 2_160 });
    expect(renditions.map((item) => item.identity)).toEqual([
      "360p",
      "480p",
      "720p",
      "1080p",
    ]);
    expect(Math.max(...renditions.map((item) => item.height))).toBe(1_080);
  });

  it("preserves aspect ratio with even dimensions without upscaling", () => {
    const renditions = planAdaptiveRenditions({ width: 1_919, height: 1_080 });
    for (const rendition of renditions) {
      expect(rendition.height).toBeLessThanOrEqual(1_080);
      expect(rendition.width).toBeLessThanOrEqual(1_919);
      expect(rendition.width % 2).toBe(0);
    }
    expect(renditions.at(-1)).toMatchObject({ identity: "1080p", width: 1_918, height: 1_080 });
  });

  it("uses the existing generation MP4 key and deterministic HLS namespaces", () => {
    expect(canonicalFallbackObjectKey(namespace)).toBe(
      "channels/11111111-1111-4111-8111-111111111111/videos/22222222-2222-4222-8222-222222222222/playback/g3.mp4",
    );
    expect(hlsMasterObjectKey(namespace)).toBe(
      "channels/11111111-1111-4111-8111-111111111111/videos/22222222-2222-4222-8222-222222222222/playback/g3/hls/master.m3u8",
    );
    expect(hlsRenditionPlaylistObjectKey(namespace, "720p")).toBe(
      "channels/11111111-1111-4111-8111-111111111111/videos/22222222-2222-4222-8222-222222222222/playback/g3/hls/720p/index.m3u8",
    );
    expect(hlsRenditionSegmentPrefix(namespace, "720p")).toBe(
      "channels/11111111-1111-4111-8111-111111111111/videos/22222222-2222-4222-8222-222222222222/playback/g3/hls/720p/segment-",
    );
    expect(hlsRenditionSegmentObjectKey(namespace, "720p", 42)).toBe(
      "channels/11111111-1111-4111-8111-111111111111/videos/22222222-2222-4222-8222-222222222222/playback/g3/hls/720p/segment-000042.ts",
    );
  });

  it("rejects unsafe namespace inputs and invalid segment/generation identities", () => {
    expect(() => canonicalFallbackObjectKey({ ...namespace, generation: 0 })).toThrow(
      /positive integer/,
    );
    expect(() => canonicalFallbackObjectKey({ ...namespace, channelId: "bad/channel" })).toThrow(
      /namespace segment/,
    );
    expect(() => hlsRenditionSegmentObjectKey(namespace, "360p", -1)).toThrow(
      /segment sequence/,
    );
    expect(() => planAdaptiveRenditions({ width: 0, height: 720 })).toThrow(/positive integers/);
  });

  it("allows adaptive READY only when fallback, master and every planned rendition are READY", () => {
    const fullyReady = {
      fallbackStatus: "READY" as const,
      hlsMasterStatus: "READY" as const,
      renditions: [{ status: "READY" as const }, { status: "READY" as const }],
    };
    expect(canMarkAdaptiveGenerationReady(fullyReady)).toBe(true);
    expect(canMarkAdaptiveGenerationReady({ ...fullyReady, renditions: [] })).toBe(false);
    expect(
      canMarkAdaptiveGenerationReady({ ...fullyReady, fallbackStatus: "VERIFYING" }),
    ).toBe(false);
    expect(
      canMarkAdaptiveGenerationReady({ ...fullyReady, hlsMasterStatus: "UPLOADING" }),
    ).toBe(false);
    expect(
      canMarkAdaptiveGenerationReady({
        ...fullyReady,
        renditions: [{ status: "READY" }, { status: "FAILED" }],
      }),
    ).toBe(false);
  });
});
