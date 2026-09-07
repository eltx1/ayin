import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { MediaProcessingJob } from "@ayin/db";
import { Inject, Injectable, Logger } from "@nestjs/common";

import {
  hlsRenditionSegmentObjectKey,
  planAdaptiveRenditions,
  type PlannedMediaRendition,
} from "./media-architecture-v2.js";
import {
  type AdaptiveGenerationState,
  type AdaptiveRenditionState,
  MediaAdaptiveLifecycleService,
} from "./media-adaptive-lifecycle.service.js";
import {
  buildHlsMasterManifest,
  HLS_PLAYLIST_CONTENT_TYPE,
  HLS_SEGMENT_CONTENT_TYPE,
  parseHlsMediaPlaylistSegments,
} from "./media-hls-manifest.js";
import { MediaHlsSettingsService } from "./media-hls-settings.service.js";
import { MediaHlsTranscoderService } from "./media-hls-transcoder.service.js";
import { MediaProcessingLifecycleService } from "./media-processing-lifecycle.service.js";
import { MediaProcessingStorageService } from "./media-processing-storage.service.js";
import type { MediaProbeMetadata } from "./media-probe.js";

@Injectable()
export class MediaAdaptiveProcessingService {
  private readonly logger = new Logger(MediaAdaptiveProcessingService.name);

  constructor(
    @Inject(MediaHlsSettingsService) private readonly settings: MediaHlsSettingsService,
    @Inject(MediaAdaptiveLifecycleService)
    private readonly adaptiveLifecycle: MediaAdaptiveLifecycleService,
    @Inject(MediaProcessingLifecycleService)
    private readonly processingLifecycle: MediaProcessingLifecycleService,
    @Inject(MediaProcessingStorageService) private readonly storage: MediaProcessingStorageService,
    @Inject(MediaHlsTranscoderService) private readonly transcoder: MediaHlsTranscoderService,
  ) {}

  async process(input: {
    job: MediaProcessingJob;
    workerId: string;
    workDirectory: string;
    canonicalPath: string;
    canonicalMetadata: MediaProbeMetadata;
  }): Promise<boolean> {
    const settings = await this.settings.resolve();
    if (!settings.enabled) return false;
    const { width, height, durationMs } = input.canonicalMetadata;
    if (!width || !height || !durationMs || durationMs <= 0) {
      throw new Error("HLS processing requires readable canonical dimensions and duration.");
    }

    const planned = planAdaptiveRenditions(
      { width, height },
      {
        allowedIdentities: settings.allowedIdentities,
        maxOutputHeight: settings.maxOutputHeight,
        videoBitrateKbps: settings.videoBitrateKbps,
        audioBitrateKbps: settings.audioBitrateKbps,
      },
    );
    if (planned.length === 0) {
      this.logger.log(
        `Video ${input.job.videoId} has no eligible HLS rendition; MP4 fallback remains.`,
      );
      return false;
    }

    let generation = await this.adaptiveLifecycle.loadOrCreate(input.job, planned);
    await this.adaptiveLifecycle.markFallbackReady(generation.id);
    generation = { ...generation, fallbackStatus: "READY" };

    if (generation.status === "READY" && (await this.verifyReadyGeneration(generation))) {
      this.logger.log(
        `Reused verified adaptive generation ${generation.videoId}/g${generation.generation}.`,
      );
      return true;
    }

    await this.adaptiveLifecycle.reopen(generation.id);
    await this.storage.deleteObject(generation.hlsMasterR2ObjectKey).catch(() => undefined);
    let activeRendition: AdaptiveRenditionState | undefined;

    try {
      for (const rendition of generation.renditions) {
        activeRendition = rendition;
        if (
          rendition.status === "READY" &&
          (await this.verifyRemoteRendition(generation, rendition))
        ) {
          continue;
        }
        await this.adaptiveLifecycle.setRenditionStatus(rendition.id, "PROCESSING");
        await this.requireOwnedStage(
          input.job.id,
          input.workerId,
          `HLS_${rendition.identity.toUpperCase()}_TRANSCODING`,
          95,
        );
        await assertScratchEstimateWithinLimit({
          canonicalPath: input.canonicalPath,
          durationMs,
          rendition,
          scratchMaxBytes: settings.scratchMaxBytesPerJob,
          hasAudio: input.canonicalMetadata.hasAudio,
        });

        const renditionDirectory = join(input.workDirectory, "hls", rendition.identity);
        try {
          const packaged = await this.transcoder.transcode({
            canonicalPath: input.canonicalPath,
            outputDirectory: renditionDirectory,
            rendition,
            threads: settings.ffmpegThreadsPerJob,
            preset: settings.ffmpegPreset,
            segmentDurationSeconds: settings.segmentDurationSeconds,
          });
          await assertScratchActualWithinLimit(
            input.canonicalPath,
            packaged.playlistSizeBytes +
              packaged.segments.reduce((total, item) => total + item.sizeBytes, 0),
            settings.scratchMaxBytesPerJob,
          );

          await this.adaptiveLifecycle.setRenditionStatus(rendition.id, "UPLOADING");
          await this.requireOwnedStage(
            input.job.id,
            input.workerId,
            `HLS_${rendition.identity.toUpperCase()}_UPLOADING`,
            96,
          );
          for (const segment of packaged.segments) {
            const key = hlsRenditionSegmentObjectKey(
              {
                channelId: generation.channelId,
                videoId: generation.videoId,
                generation: generation.generation,
              },
              rendition.identity,
              segment.sequence,
            );
            await this.storage.uploadFile(key, segment.filePath, HLS_SEGMENT_CONTENT_TYPE);
          }
          await this.storage.uploadFile(
            rendition.playlistR2ObjectKey,
            packaged.playlistPath,
            HLS_PLAYLIST_CONTENT_TYPE,
          );

          await this.adaptiveLifecycle.setRenditionStatus(rendition.id, "VERIFYING");
          await this.verifyPackagedRendition(generation, rendition, packaged);
          await this.adaptiveLifecycle.setRenditionStatus(rendition.id, "READY");
        } finally {
          await rm(renditionDirectory, { recursive: true, force: true }).catch(() => undefined);
        }
      }

      activeRendition = undefined;
      const manifestRenditions = generation.renditions.map(toPlannedRendition);
      const master = buildHlsMasterManifest(manifestRenditions, {
        hasAudio: input.canonicalMetadata.hasAudio,
      });
      const hlsRoot = join(input.workDirectory, "hls");
      await mkdir(hlsRoot, { recursive: true });
      const masterPath = join(hlsRoot, "master.m3u8");
      await writeFile(masterPath, master, { encoding: "utf8", flag: "w" });
      await this.adaptiveLifecycle.setMasterStatus(generation.id, "UPLOADING");
      await this.requireOwnedStage(input.job.id, input.workerId, "HLS_MASTER_UPLOADING", 98);
      await this.storage.uploadFile(
        generation.hlsMasterR2ObjectKey,
        masterPath,
        HLS_PLAYLIST_CONTENT_TYPE,
      );
      await this.adaptiveLifecycle.setMasterStatus(generation.id, "VERIFYING");
      await this.verifyObject(generation.hlsMasterR2ObjectKey, Buffer.byteLength(master, "utf8"), [
        HLS_PLAYLIST_CONTENT_TYPE,
        "application/x-mpegURL",
      ]);
      const downloadedMaster = await this.storage.downloadText(generation.hlsMasterR2ObjectKey);
      if (downloadedMaster !== master) {
        throw new Error("HLS master manifest failed byte verification.");
      }
      await this.adaptiveLifecycle.setMasterStatus(generation.id, "READY");
      const ready = await this.adaptiveLifecycle.markReadyIfComplete(generation.id);
      if (!ready) throw new Error("HLS generation could not satisfy the atomic READY invariant.");
      this.logger.log(
        `Adaptive generation ${generation.videoId}/g${generation.generation} reached READY.`,
      );
      return true;
    } catch (error) {
      await this.storage.deleteObject(generation.hlsMasterR2ObjectKey).catch(() => undefined);
      await this.adaptiveLifecycle
        .markFailed(generation.id, activeRendition?.id)
        .catch(() => undefined);
      throw error;
    }
  }

  private async verifyReadyGeneration(generation: AdaptiveGenerationState): Promise<boolean> {
    try {
      await this.verifyObject(generation.fallbackR2ObjectKey, null, ["video/mp4"]);
      for (const rendition of generation.renditions) {
        if (!(await this.verifyRemoteRendition(generation, rendition))) return false;
      }
      const plannedRenditions = generation.renditions.map(toPlannedRendition);
      const expectedMasters = [
        buildHlsMasterManifest(plannedRenditions, { hasAudio: true }),
        buildHlsMasterManifest(plannedRenditions, { hasAudio: false }),
      ];
      await this.verifyObject(generation.hlsMasterR2ObjectKey, null, [
        HLS_PLAYLIST_CONTENT_TYPE,
        "application/x-mpegURL",
      ]);
      const master = await this.storage.downloadText(generation.hlsMasterR2ObjectKey);
      return expectedMasters.includes(master);
    } catch {
      return false;
    }
  }

  private async verifyRemoteRendition(
    generation: AdaptiveGenerationState,
    rendition: AdaptiveRenditionState,
  ): Promise<boolean> {
    try {
      await this.verifyObject(rendition.playlistR2ObjectKey, null, [
        HLS_PLAYLIST_CONTENT_TYPE,
        "application/x-mpegURL",
      ]);
      const playlist = await this.storage.downloadText(rendition.playlistR2ObjectKey);
      const sequences = parseHlsMediaPlaylistSegments(playlist);
      for (const sequence of sequences) {
        const key = hlsRenditionSegmentObjectKey(
          {
            channelId: generation.channelId,
            videoId: generation.videoId,
            generation: generation.generation,
          },
          rendition.identity,
          sequence,
        );
        await this.verifyObject(key, null, [HLS_SEGMENT_CONTENT_TYPE]);
      }
      return true;
    } catch {
      return false;
    }
  }

  private async verifyPackagedRendition(
    generation: AdaptiveGenerationState,
    rendition: AdaptiveRenditionState,
    packaged: {
      playlistSizeBytes: number;
      playlistText: string;
      segments: readonly { sequence: number; sizeBytes: number }[];
    },
  ): Promise<void> {
    for (const segment of packaged.segments) {
      const key = hlsRenditionSegmentObjectKey(
        {
          channelId: generation.channelId,
          videoId: generation.videoId,
          generation: generation.generation,
        },
        rendition.identity,
        segment.sequence,
      );
      await this.verifyObject(key, segment.sizeBytes, [HLS_SEGMENT_CONTENT_TYPE]);
    }
    await this.verifyObject(rendition.playlistR2ObjectKey, packaged.playlistSizeBytes, [
      HLS_PLAYLIST_CONTENT_TYPE,
      "application/x-mpegURL",
    ]);
    const remotePlaylist = await this.storage.downloadText(rendition.playlistR2ObjectKey);
    if (remotePlaylist !== packaged.playlistText) {
      throw new Error(`HLS ${rendition.identity} playlist failed byte verification.`);
    }
  }

  private async verifyObject(
    key: string,
    expectedSizeBytes: number | null,
    expectedContentTypes: readonly string[],
  ): Promise<void> {
    const object = await this.storage.headObject(key);
    if (
      object.sizeBytes <= 0 ||
      (expectedSizeBytes !== null && object.sizeBytes !== expectedSizeBytes)
    ) {
      throw new Error(`HLS R2 object ${key} failed size verification.`);
    }
    const type = object.contentType?.split(";", 1)[0]?.trim().toLowerCase();
    const expected = expectedContentTypes.map((value) => value.toLowerCase());
    if (type !== "application/octet-stream" && (!type || !expected.includes(type))) {
      throw new Error(`HLS R2 object ${key} failed content-type verification.`);
    }
  }

  private async requireOwnedStage(
    jobId: string,
    workerId: string,
    stage: string,
    progressPercent: number,
  ): Promise<void> {
    const updated = await this.processingLifecycle.setOwnedStage({
      jobId,
      workerId,
      status: stage.includes("UPLOAD") ? "UPLOADING" : "PROCESSING",
      stage,
      progressPercent,
    });
    if (!updated) throw new Error("The media worker lost its lease during HLS processing.");
  }
}

function toPlannedRendition(rendition: AdaptiveRenditionState): PlannedMediaRendition {
  const {
    id: _id,
    playlistR2ObjectKey: _playlist,
    segmentR2Prefix: _prefix,
    status: _status,
    ...plan
  } = rendition;
  return plan;
}

async function assertScratchEstimateWithinLimit(input: {
  canonicalPath: string;
  durationMs: number;
  rendition: PlannedMediaRendition;
  scratchMaxBytes: number;
  hasAudio: boolean;
}): Promise<void> {
  const canonical = await stat(input.canonicalPath);
  const bitsPerSecond =
    (input.rendition.videoBitrateKbps + (input.hasAudio ? input.rendition.audioBitrateKbps : 0)) *
    1000;
  const estimatedRenditionBytes = Math.ceil((input.durationMs / 1000) * (bitsPerSecond / 8) * 1.35);
  if (canonical.size + estimatedRenditionBytes > input.scratchMaxBytes) {
    throw new Error(
      `HLS rendition ${input.rendition.identity} exceeds the configured per-job scratch budget.`,
    );
  }
}

async function assertScratchActualWithinLimit(
  canonicalPath: string,
  packagedBytes: number,
  scratchMaxBytes: number,
): Promise<void> {
  const canonical = await stat(canonicalPath);
  if (canonical.size + packagedBytes > scratchMaxBytes) {
    throw new Error("HLS output exceeded the configured per-job scratch budget.");
  }
}
