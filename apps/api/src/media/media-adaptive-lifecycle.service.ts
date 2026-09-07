import type { MediaProcessingJob } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import {
  canMarkAdaptiveGenerationReady,
  hlsMasterObjectKey,
  hlsRenditionPlaylistObjectKey,
  hlsRenditionSegmentPrefix,
  MEDIA_ARCHITECTURE_VERSION,
  MEDIA_AUDIO_CODEC,
  MEDIA_HLS_PROFILE,
  MEDIA_PIXEL_FORMAT,
  MEDIA_VIDEO_CODEC,
  type MediaPlaybackGenerationStatus,
  type MediaPlaybackOutputStatus,
  type MediaRenditionIdentity,
  type PlannedMediaRendition,
} from "./media-architecture-v2.js";

export interface AdaptiveRenditionState extends PlannedMediaRendition {
  id: string;
  playlistR2ObjectKey: string;
  segmentR2Prefix: string;
  status: MediaPlaybackOutputStatus;
}

export interface AdaptiveGenerationState {
  id: string;
  videoId: string;
  channelId: string;
  generation: number;
  status: MediaPlaybackGenerationStatus;
  fallbackR2ObjectKey: string;
  fallbackStatus: MediaPlaybackOutputStatus;
  hlsMasterR2ObjectKey: string;
  hlsMasterStatus: MediaPlaybackOutputStatus;
  renditions: readonly AdaptiveRenditionState[];
}

@Injectable()
export class MediaAdaptiveLifecycleService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async loadOrCreate(
    job: MediaProcessingJob,
    plannedRenditions: readonly PlannedMediaRendition[],
  ): Promise<AdaptiveGenerationState> {
    return this.database.client.$transaction(async (tx) => {
      const video = await tx.video.findUnique({
        where: { id: job.videoId },
        select: { id: true, channelId: true },
      });
      if (!video) throw new Error("Adaptive processing video no longer exists.");
      const namespace = {
        channelId: video.channelId,
        videoId: video.id,
        generation: job.generation,
      };
      const expectedMasterKey = hlsMasterObjectKey(namespace);
      const sourceAsset = job.inputR2ObjectKey
        ? await tx.mediaAsset.findUnique({
            where: { r2ObjectKey: job.inputR2ObjectKey },
            select: { id: true },
          })
        : null;

      let generation = await tx.mediaPlaybackGeneration.findUnique({
        where: { videoId_generation: { videoId: job.videoId, generation: job.generation } },
        include: { renditions: true },
      });

      if (!generation) {
        generation = await tx.mediaPlaybackGeneration.create({
          data: {
            videoId: job.videoId,
            sourceMediaAssetId: sourceAsset?.id ?? null,
            processingJobId: job.id,
            generation: job.generation,
            processingVersion: MEDIA_ARCHITECTURE_VERSION,
            fallbackR2ObjectKey: job.outputR2ObjectKey,
            hlsMasterR2ObjectKey: expectedMasterKey,
            renditions: {
              create: plannedRenditions.map((rendition) => ({
                identity: rendition.identity,
                width: rendition.width,
                height: rendition.height,
                videoBitrateKbps: rendition.videoBitrateKbps,
                audioBitrateKbps: rendition.audioBitrateKbps,
                videoCodec: MEDIA_VIDEO_CODEC,
                audioCodec: MEDIA_AUDIO_CODEC,
                pixelFormat: MEDIA_PIXEL_FORMAT,
                protocol: MEDIA_HLS_PROFILE.protocol,
                container: MEDIA_HLS_PROFILE.container,
                playlistR2ObjectKey: hlsRenditionPlaylistObjectKey(namespace, rendition.identity),
                segmentR2Prefix: hlsRenditionSegmentPrefix(namespace, rendition.identity),
              })),
            },
          },
          include: { renditions: true },
        });
      } else {
        if (generation.processingVersion !== MEDIA_ARCHITECTURE_VERSION) {
          throw new Error("Adaptive generation processing version does not match Task 40.");
        }
        if (generation.processingJobId && generation.processingJobId !== job.id) {
          throw new Error("Adaptive generation is already owned by a different processing job.");
        }
        if (
          generation.fallbackR2ObjectKey !== job.outputR2ObjectKey ||
          generation.hlsMasterR2ObjectKey !== expectedMasterKey
        ) {
          throw new Error("Adaptive generation deterministic object keys do not match the job.");
        }
        await tx.mediaPlaybackGeneration.update({
          where: { id: generation.id },
          data: {
            processingJobId: job.id,
            sourceMediaAssetId: generation.sourceMediaAssetId ?? sourceAsset?.id ?? null,
          },
        });
        if (generation.renditions.length === 0 && plannedRenditions.length > 0) {
          await tx.mediaPlaybackRendition.createMany({
            data: plannedRenditions.map((rendition) => ({
              playbackGenerationId: generation!.id,
              identity: rendition.identity,
              width: rendition.width,
              height: rendition.height,
              videoBitrateKbps: rendition.videoBitrateKbps,
              audioBitrateKbps: rendition.audioBitrateKbps,
              videoCodec: MEDIA_VIDEO_CODEC,
              audioCodec: MEDIA_AUDIO_CODEC,
              pixelFormat: MEDIA_PIXEL_FORMAT,
              protocol: MEDIA_HLS_PROFILE.protocol,
              container: MEDIA_HLS_PROFILE.container,
              playlistR2ObjectKey: hlsRenditionPlaylistObjectKey(namespace, rendition.identity),
              segmentR2Prefix: hlsRenditionSegmentPrefix(namespace, rendition.identity),
            })),
          });
        }
        generation = await tx.mediaPlaybackGeneration.findUniqueOrThrow({
          where: { id: generation.id },
          include: { renditions: true },
        });
      }

      return toGenerationState(generation, video.channelId);
    });
  }

  async reopen(generationId: string): Promise<void> {
    await this.database.client.mediaPlaybackGeneration.update({
      where: { id: generationId },
      data: {
        status: "BUILDING",
        readyAt: null,
        failedAt: null,
        hlsMasterStatus: "PLANNED",
      },
    });
  }

  async markFallbackReady(generationId: string): Promise<void> {
    await this.database.client.mediaPlaybackGeneration.update({
      where: { id: generationId },
      data: { fallbackStatus: "READY" },
    });
  }

  async setRenditionStatus(renditionId: string, status: MediaPlaybackOutputStatus): Promise<void> {
    await this.database.client.mediaPlaybackRendition.update({
      where: { id: renditionId },
      data: {
        status,
        readyAt: status === "READY" ? new Date() : null,
        failedAt: status === "FAILED" ? new Date() : null,
      },
    });
  }

  async setMasterStatus(generationId: string, status: MediaPlaybackOutputStatus): Promise<void> {
    await this.database.client.mediaPlaybackGeneration.update({
      where: { id: generationId },
      data: { hlsMasterStatus: status },
    });
  }

  async markFailed(generationId: string, renditionId?: string): Promise<void> {
    await this.database.client.$transaction(async (tx) => {
      if (renditionId) {
        await tx.mediaPlaybackRendition.update({
          where: { id: renditionId },
          data: { status: "FAILED", failedAt: new Date(), readyAt: null },
        });
      }
      await tx.mediaPlaybackGeneration.update({
        where: { id: generationId },
        data: {
          status: "FAILED",
          failedAt: new Date(),
          readyAt: null,
          hlsMasterStatus: "PLANNED",
        },
      });
    });
  }

  async markReadyIfComplete(generationId: string): Promise<AdaptiveGenerationState | null> {
    return this.database.client.$transaction(async (tx) => {
      const generation = await tx.mediaPlaybackGeneration.findUnique({
        where: { id: generationId },
        include: { renditions: true },
      });
      if (!generation) return null;
      if (
        !canMarkAdaptiveGenerationReady({
          fallbackStatus: generation.fallbackStatus,
          hlsMasterStatus: generation.hlsMasterStatus,
          renditions: generation.renditions,
        })
      ) {
        return null;
      }
      const updated = await tx.mediaPlaybackGeneration.update({
        where: { id: generation.id },
        data: { status: "READY", readyAt: new Date(), failedAt: null },
        include: { renditions: true },
      });
      const video = await tx.video.findUniqueOrThrow({
        where: { id: generation.videoId },
        select: { channelId: true },
      });
      return toGenerationState(updated, video.channelId);
    });
  }
}

function toGenerationState(
  generation: {
    id: string;
    videoId: string;
    generation: number;
    status: MediaPlaybackGenerationStatus;
    fallbackR2ObjectKey: string;
    fallbackStatus: MediaPlaybackOutputStatus;
    hlsMasterR2ObjectKey: string;
    hlsMasterStatus: MediaPlaybackOutputStatus;
    renditions: Array<{
      id: string;
      identity: string;
      width: number;
      height: number;
      videoBitrateKbps: number;
      audioBitrateKbps: number;
      playlistR2ObjectKey: string;
      segmentR2Prefix: string;
      status: MediaPlaybackOutputStatus;
    }>;
  },
  channelId: string,
): AdaptiveGenerationState {
  const renditions = generation.renditions
    .map((rendition) => ({
      id: rendition.id,
      identity: rendition.identity as MediaRenditionIdentity,
      width: rendition.width,
      height: rendition.height,
      videoBitrateKbps: rendition.videoBitrateKbps,
      audioBitrateKbps: rendition.audioBitrateKbps,
      videoCodec: MEDIA_VIDEO_CODEC,
      audioCodec: MEDIA_AUDIO_CODEC,
      pixelFormat: MEDIA_PIXEL_FORMAT,
      protocol: MEDIA_HLS_PROFILE.protocol,
      container: MEDIA_HLS_PROFILE.container,
      playlistR2ObjectKey: rendition.playlistR2ObjectKey,
      segmentR2Prefix: rendition.segmentR2Prefix,
      status: rendition.status,
    }))
    .sort((left, right) => left.height - right.height);
  return {
    id: generation.id,
    videoId: generation.videoId,
    channelId,
    generation: generation.generation,
    status: generation.status,
    fallbackR2ObjectKey: generation.fallbackR2ObjectKey,
    fallbackStatus: generation.fallbackStatus,
    hlsMasterR2ObjectKey: generation.hlsMasterR2ObjectKey,
    hlsMasterStatus: generation.hlsMasterStatus,
    renditions,
  };
}
