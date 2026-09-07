import { describe, expect, it } from "vitest";

import { MediaHlsSettingsService } from "./media-hls-settings.service.js";

const defaults: Record<string, unknown> = {
  mediaHlsEnabled: true,
  mediaHlsNewUploadsEnabled: false,
  mediaHlsBackfillEnabled: false,
  mediaHls360pEnabled: true,
  mediaHls480pEnabled: true,
  mediaHls720pEnabled: true,
  mediaHls1080pEnabled: true,
  mediaHls360pVideoBitrateKbps: 800,
  mediaHls480pVideoBitrateKbps: 1400,
  mediaHls720pVideoBitrateKbps: 2800,
  mediaHls1080pVideoBitrateKbps: 5000,
  mediaHls360pAudioBitrateKbps: 96,
  mediaHls480pAudioBitrateKbps: 128,
  mediaHls720pAudioBitrateKbps: 128,
  mediaHls1080pAudioBitrateKbps: 160,
  mediaHlsSegmentDurationSeconds: 6,
  mediaHlsMaxOutputHeight: 1080,
  mediaProcessingScratchMaxBytesPerJob: 10_000_000_000,
  mediaProcessingFfmpegThreadsPerJob: 1,
  mediaProcessingPreset: "veryfast",
};

function service(overrides: Record<string, unknown> = {}) {
  const values = { ...defaults, ...overrides };
  return new MediaHlsSettingsService({
    get: async (key: string) => values[key],
  } as never);
}

describe("MediaHlsSettingsService rollout controls", () => {
  it("keeps new-upload HLS independent and off by default", async () => {
    const resolved = await service().resolve({ generation: 1, stagingKey: "uploads/source.mp4" } as never);
    expect(resolved.enabled).toBe(false);
  });

  it("allows HLS for new uploads only when both generation and new-upload controls are enabled", async () => {
    const resolved = await service({ mediaHlsNewUploadsEnabled: true }).resolve({
      generation: 1,
      stagingKey: "uploads/source.mp4",
    } as never);
    expect(resolved.enabled).toBe(true);

    const killed = await service({
      mediaHlsEnabled: false,
      mediaHlsNewUploadsEnabled: true,
    }).resolve({ generation: 1, stagingKey: "uploads/source.mp4" } as never);
    expect(killed.enabled).toBe(false);
  });

  it("allows a claimed backfill independently from the new-upload switch", async () => {
    const resolved = await service({ mediaHlsBackfillEnabled: true }).resolve({
      generation: 4,
      stagingKey: "channels/c/videos/v/playback/g1.mp4#adaptive-backfill-g4",
    } as never);
    expect(resolved.enabled).toBe(true);
  });
});
