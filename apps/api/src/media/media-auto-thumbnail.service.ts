import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { MediaProcessingStorageService } from "./media-processing-storage.service.js";

const execFileAsync = promisify(execFile);
const AUTO_THUMBNAIL_TIMEOUT_MS = 30_000;
const AUTO_THUMBNAIL_MAX_WIDTH = 1280;

export interface EnsureAutoThumbnailInput {
  videoId: string;
  canonicalPath: string;
  durationMs: number | null;
}

export function autoThumbnailObjectKey(channelId: string, videoId: string): string {
  return `channels/${channelId}/videos/${videoId}/seo/auto-thumbnail.jpg`;
}

export function autoThumbnailSeekSeconds(durationMs: number | null): number {
  if (!durationMs || durationMs <= 0) return 0;
  return Math.min(3, Math.max(0, durationMs / 10_000));
}

@Injectable()
export class MediaAutoThumbnailService {
  private readonly ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg";

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MediaProcessingStorageService) private readonly storage: MediaProcessingStorageService,
  ) {}

  async ensureForCanonical(input: EnsureAutoThumbnailInput) {
    const video = await this.database.client.video.findUnique({
      where: { id: input.videoId },
      select: {
        channelId: true,
        mediaAssets: {
          where: {
            kind: "THUMBNAIL",
            removedAt: null,
            status: { in: ["UPLOADED", "VALIDATED"] },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true, r2ObjectKey: true },
        },
      },
    });
    if (!video) throw new Error(`Video ${input.videoId} does not exist.`);

    const objectKey = autoThumbnailObjectKey(video.channelId, input.videoId);
    const existing = video.mediaAssets[0];
    if (existing) {
      return {
        created: false as const,
        assetId: existing.id,
        objectKey: existing.r2ObjectKey,
        reason: "existing-thumbnail" as const,
      };
    }

    const thumbnailPath = `${input.canonicalPath}.thumbnail.jpg`;
    await this.extractFrame(input.canonicalPath, thumbnailPath, input.durationMs);
    const file = await stat(thumbnailPath);
    if (!file.isFile() || file.size <= 0) {
      throw new Error("FFmpeg did not create a usable automatic thumbnail.");
    }

    await this.storage.uploadFile(objectKey, thumbnailPath, "image/jpeg");

    const competingThumbnail = await this.database.client.mediaAsset.findFirst({
      where: {
        videoId: input.videoId,
        kind: "THUMBNAIL",
        removedAt: null,
        status: { in: ["UPLOADED", "VALIDATED"] },
        r2ObjectKey: { not: objectKey },
      },
      select: { id: true, r2ObjectKey: true },
    });
    if (competingThumbnail) {
      await this.storage.deleteObject(objectKey).catch(() => undefined);
      return {
        created: false as const,
        assetId: competingThumbnail.id,
        objectKey: competingThumbnail.r2ObjectKey,
        reason: "creator-thumbnail-won-race" as const,
      };
    }

    const asset = await this.database.client.mediaAsset.upsert({
      where: { r2ObjectKey: objectKey },
      create: {
        videoId: input.videoId,
        channelId: video.channelId,
        kind: "THUMBNAIL",
        status: "VALIDATED",
        r2ObjectKey: objectKey,
        mimeType: "image/jpeg",
        sizeBytes: BigInt(file.size),
      },
      update: {
        videoId: input.videoId,
        channelId: video.channelId,
        kind: "THUMBNAIL",
        status: "VALIDATED",
        mimeType: "image/jpeg",
        sizeBytes: BigInt(file.size),
        removedAt: null,
      },
      select: { id: true, r2ObjectKey: true },
    });

    return {
      created: true as const,
      assetId: asset.id,
      objectKey: asset.r2ObjectKey,
      reason: "generated" as const,
    };
  }

  private async extractFrame(
    canonicalPath: string,
    thumbnailPath: string,
    durationMs: number | null,
  ): Promise<void> {
    const seekSeconds = autoThumbnailSeekSeconds(durationMs);
    try {
      await execFileAsync(
        this.ffmpegPath,
        [
          "-hide_banner",
          "-nostdin",
          "-loglevel",
          "error",
          "-y",
          "-ss",
          seekSeconds.toFixed(3),
          "-i",
          canonicalPath,
          "-map",
          "0:v:0",
          "-an",
          "-frames:v",
          "1",
          "-vf",
          `scale=min(${AUTO_THUMBNAIL_MAX_WIDTH}\\,iw):-2`,
          "-q:v",
          "3",
          "-update",
          "1",
          thumbnailPath,
        ],
        {
          timeout: AUTO_THUMBNAIL_TIMEOUT_MS,
          killSignal: "SIGKILL",
          maxBuffer: 1024 * 1024,
        },
      );
    } catch (error) {
      if (wasKilledByTimeout(error)) {
        throw new Error(
          `Automatic thumbnail generation timed out after ${AUTO_THUMBNAIL_TIMEOUT_MS / 1000} seconds.`,
        );
      }
      throw error;
    }
  }
}

function wasKilledByTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const processError = error as { killed?: boolean; signal?: string };
  return processError.killed === true || processError.signal === "SIGKILL";
}
