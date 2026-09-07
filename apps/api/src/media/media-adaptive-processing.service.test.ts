import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { planAdaptiveRenditions } from "./media-architecture-v2.js";
import type {
  AdaptiveGenerationState,
  AdaptiveRenditionState,
} from "./media-adaptive-lifecycle.service.js";
import { MediaAdaptiveProcessingService } from "./media-adaptive-processing.service.js";
import { buildHlsMasterManifest } from "./media-hls-manifest.js";

const createdDirectories: string[] = [];

async function canonicalFixture(): Promise<{ directory: string; canonicalPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), "ayin-task40-"));
  createdDirectories.push(directory);
  const canonicalPath = join(directory, "canonical.mp4");
  await writeFile(canonicalPath, Buffer.alloc(1024, 1));
  return { directory, canonicalPath };
}

afterEach(async () => {
  await Promise.all(
    createdDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }).catch(() => undefined)),
  );
});

const baseSettings = {
  enabled: true,
  allowedIdentities: ["360p"] as const,
  videoBitrateKbps: { "360p": 800, "480p": 1400, "720p": 2800, "1080p": 5000 },
  audioBitrateKbps: { "360p": 96, "480p": 128, "720p": 128, "1080p": 160 },
  segmentDurationSeconds: 6,
  maxOutputHeight: 1080,
  scratchMaxBytesPerJob: 1024 * 1024 * 1024,
  ffmpegThreadsPerJob: 1,
  ffmpegPreset: "medium",
};

function job() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    videoId: "22222222-2222-4222-8222-222222222222",
    generation: 1,
    inputR2ObjectKey: "channels/c/media/source.mp4",
    outputR2ObjectKey:
      "channels/33333333-3333-4333-8333-333333333333/videos/22222222-2222-4222-8222-222222222222/playback/g1.mp4",
  } as never;
}

function generation(
  status: AdaptiveGenerationState["status"] = "BUILDING",
): AdaptiveGenerationState {
  const plan = planAdaptiveRenditions({ width: 640, height: 360 })[0]!;
  const rendition: AdaptiveRenditionState = {
    id: "44444444-4444-4444-8444-444444444444",
    ...plan,
    playlistR2ObjectKey:
      "channels/33333333-3333-4333-8333-333333333333/videos/22222222-2222-4222-8222-222222222222/playback/g1/hls/360p/index.m3u8",
    segmentR2Prefix:
      "channels/33333333-3333-4333-8333-333333333333/videos/22222222-2222-4222-8222-222222222222/playback/g1/hls/360p/segment-",
    status: "PLANNED",
  };
  return {
    id: "55555555-5555-4555-8555-555555555555",
    videoId: "22222222-2222-4222-8222-222222222222",
    channelId: "33333333-3333-4333-8333-333333333333",
    generation: 1,
    status,
    fallbackR2ObjectKey:
      "channels/33333333-3333-4333-8333-333333333333/videos/22222222-2222-4222-8222-222222222222/playback/g1.mp4",
    fallbackStatus: "READY",
    hlsMasterR2ObjectKey:
      "channels/33333333-3333-4333-8333-333333333333/videos/22222222-2222-4222-8222-222222222222/playback/g1/hls/master.m3u8",
    hlsMasterStatus: "PLANNED",
    renditions: [rendition],
  };
}

function serviceFixture(overrides?: {
  enabled?: boolean;
  generation?: AdaptiveGenerationState;
  transcode?: ReturnType<typeof vi.fn>;
  headObject?: ReturnType<typeof vi.fn>;
  downloadText?: ReturnType<typeof vi.fn>;
}) {
  const state = overrides?.generation ?? generation();
  const settings = {
    resolve: vi.fn().mockResolvedValue({ ...baseSettings, enabled: overrides?.enabled ?? true }),
  };
  const adaptiveLifecycle = {
    loadOrCreate: vi.fn().mockResolvedValue(state),
    markFallbackReady: vi.fn().mockResolvedValue(undefined),
    reopen: vi.fn().mockResolvedValue(undefined),
    setRenditionStatus: vi.fn().mockResolvedValue(undefined),
    setMasterStatus: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    markReadyIfComplete: vi.fn().mockResolvedValue({ ...state, status: "READY" }),
  };
  const processingLifecycle = {
    setOwnedStage: vi.fn().mockResolvedValue(true),
  };
  const storage = {
    deleteObject: vi.fn().mockResolvedValue(undefined),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    headObject:
      overrides?.headObject ??
      vi.fn().mockResolvedValue({ sizeBytes: 100, contentType: "application/octet-stream" }),
    downloadText: overrides?.downloadText ?? vi.fn(),
  };
  const transcoder = {
    transcode: overrides?.transcode ?? vi.fn(),
  };
  return {
    state,
    settings,
    adaptiveLifecycle,
    processingLifecycle,
    storage,
    transcoder,
    service: new MediaAdaptiveProcessingService(
      settings as never,
      adaptiveLifecycle as never,
      processingLifecycle as never,
      storage as never,
      transcoder as never,
    ),
  };
}

const canonicalMetadata = {
  durationMs: 10_000,
  width: 640,
  height: 360,
  encodedWidth: 640,
  encodedHeight: 360,
  rotationDegrees: 0 as const,
  videoCodec: "h264",
  audioCodec: "aac",
  hasAudio: true,
};

describe("Task 40 adaptive processing", () => {
  it("does nothing when the production HLS feature gate is disabled", async () => {
    const fixture = serviceFixture({ enabled: false });
    const local = await canonicalFixture();
    await expect(
      fixture.service.process({
        job: job(),
        workerId: "worker-1",
        workDirectory: local.directory,
        canonicalPath: local.canonicalPath,
        canonicalMetadata,
      }),
    ).resolves.toBe(false);
    expect(fixture.adaptiveLifecycle.loadOrCreate).not.toHaveBeenCalled();
    expect(fixture.transcoder.transcode).not.toHaveBeenCalled();
  });

  it("fails invalid canonical metadata before creating adaptive state", async () => {
    const fixture = serviceFixture();
    const local = await canonicalFixture();
    await expect(
      fixture.service.process({
        job: job(),
        workerId: "worker-1",
        workDirectory: local.directory,
        canonicalPath: local.canonicalPath,
        canonicalMetadata: { ...canonicalMetadata, durationMs: null },
      }),
    ).rejects.toThrow(/dimensions and duration/);
    expect(fixture.adaptiveLifecycle.loadOrCreate).not.toHaveBeenCalled();
  });

  it("marks a failed rendition/generation and never deletes the MP4 fallback", async () => {
    const state = generation();
    const transcode = vi.fn().mockRejectedValue(new Error("FFmpeg HLS 360p failed"));
    const fixture = serviceFixture({ generation: state, transcode });
    const local = await canonicalFixture();

    await expect(
      fixture.service.process({
        job: job(),
        workerId: "worker-1",
        workDirectory: local.directory,
        canonicalPath: local.canonicalPath,
        canonicalMetadata,
      }),
    ).rejects.toThrow(/HLS 360p failed/);

    expect(fixture.adaptiveLifecycle.markFailed).toHaveBeenCalledWith(
      state.id,
      state.renditions[0]!.id,
    );
    expect(fixture.storage.deleteObject).toHaveBeenCalledWith(state.hlsMasterR2ObjectKey);
    expect(fixture.storage.deleteObject).not.toHaveBeenCalledWith(state.fallbackR2ObjectKey);
  });

  it("rejects a rendition whose uploaded R2 segment fails verification", async () => {
    const state = generation();
    const playlistText = [
      "#EXTM3U",
      "#EXTINF:6.0,",
      "segment-000001.ts",
      "#EXT-X-ENDLIST",
      "",
    ].join("\n");
    const transcode = vi.fn().mockResolvedValue({
      playlistPath: "/tmp/index.m3u8",
      playlistText,
      playlistSizeBytes: Buffer.byteLength(playlistText),
      segments: [{ sequence: 1, filePath: "/tmp/segment-000001.ts", sizeBytes: 50 }],
    });
    const headObject = vi.fn().mockResolvedValue({ sizeBytes: 0, contentType: "video/mp2t" });
    const fixture = serviceFixture({ generation: state, transcode, headObject });
    const local = await canonicalFixture();

    await expect(
      fixture.service.process({
        job: job(),
        workerId: "worker-1",
        workDirectory: local.directory,
        canonicalPath: local.canonicalPath,
        canonicalMetadata,
      }),
    ).rejects.toThrow(/failed size verification/);
    expect(fixture.adaptiveLifecycle.markFailed).toHaveBeenCalled();
    expect(
      fixture.storage.uploadFile.mock.calls.some(([key]) => key === state.hlsMasterR2ObjectKey),
    ).toBe(false);
  });

  it("reuses a verified READY rendition on retry without transcoding it again", async () => {
    const state = generation();
    state.renditions[0] = { ...state.renditions[0]!, status: "READY" };
    const playlistText = [
      "#EXTM3U",
      "#EXTINF:6.0,",
      "segment-000001.ts",
      "#EXT-X-ENDLIST",
      "",
    ].join("\n");
    const master = buildHlsMasterManifest(state.renditions, { hasAudio: true });
    const headObject = vi.fn().mockImplementation(async (key: string) => ({
      sizeBytes: key === state.hlsMasterR2ObjectKey ? Buffer.byteLength(master) : 100,
      contentType: key.endsWith(".ts")
        ? "video/mp2t"
        : key.endsWith(".m3u8")
          ? "application/vnd.apple.mpegurl"
          : "video/mp4",
    }));
    const downloadText = vi
      .fn()
      .mockImplementation(async (key: string) =>
        key === state.hlsMasterR2ObjectKey ? master : playlistText,
      );
    const transcode = vi.fn();
    const fixture = serviceFixture({ generation: state, headObject, downloadText, transcode });
    const local = await canonicalFixture();

    await expect(
      fixture.service.process({
        job: job(),
        workerId: "worker-1",
        workDirectory: local.directory,
        canonicalPath: local.canonicalPath,
        canonicalMetadata,
      }),
    ).resolves.toBe(true);

    expect(transcode).not.toHaveBeenCalled();
    expect(fixture.adaptiveLifecycle.setRenditionStatus).not.toHaveBeenCalledWith(
      state.renditions[0]!.id,
      "PROCESSING",
    );
    expect(fixture.adaptiveLifecycle.markReadyIfComplete).toHaveBeenCalledWith(state.id);
  });
});
