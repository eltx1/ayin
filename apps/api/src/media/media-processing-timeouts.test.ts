import { describe, expect, it } from "vitest";

import { resolveMediaProcessingTimeouts } from "./media-processing-timeouts.js";

describe("media processing timeouts", () => {
  it("uses bounded production-safe defaults", () => {
    expect(resolveMediaProcessingTimeouts({})).toEqual({
      ffprobeMs: 120_000,
      ffmpegMs: 21_600_000,
    });
  });

  it("accepts explicit timeout overrides inside the supported ranges", () => {
    expect(
      resolveMediaProcessingTimeouts({
        MEDIA_PROCESSING_FFPROBE_TIMEOUT_SECONDS: "45",
        MEDIA_PROCESSING_FFMPEG_TIMEOUT_SECONDS: "3600",
      }),
    ).toEqual({ ffprobeMs: 45_000, ffmpegMs: 3_600_000 });
  });

  it("rejects malformed or unsafe timeout overrides", () => {
    expect(() =>
      resolveMediaProcessingTimeouts({ MEDIA_PROCESSING_FFPROBE_TIMEOUT_SECONDS: "0" }),
    ).toThrow(/MEDIA_PROCESSING_FFPROBE_TIMEOUT_SECONDS/);
    expect(() =>
      resolveMediaProcessingTimeouts({ MEDIA_PROCESSING_FFMPEG_TIMEOUT_SECONDS: "forever" }),
    ).toThrow(/MEDIA_PROCESSING_FFMPEG_TIMEOUT_SECONDS/);
    expect(() =>
      resolveMediaProcessingTimeouts({ MEDIA_PROCESSING_FFMPEG_TIMEOUT_SECONDS: "86401" }),
    ).toThrow(/MEDIA_PROCESSING_FFMPEG_TIMEOUT_SECONDS/);
  });
});
