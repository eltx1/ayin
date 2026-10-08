import {
  outputAttemptAddresses,
  outputAttemptNamespace,
  type MediaClaimIdentity,
} from "./media-output-attempt.js";
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { lockOwnedMediaJob } from "./media-processing-integrity-fence.js";
import { MediaProcessingStorageService } from "./media-processing-storage.service.js";

const execFileAsync = promisify(execFile);
const AUTO_THUMBNAIL_TIMEOUT_MS = 30_000;
const AUTO_THUMBNAIL_MAX_WIDTH = 1280;

export interface EnsureAutoThumbnailInput extends MediaClaimIdentity {
  jobId: string;
  workerId: string;
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
    const owned = async (tx: Parameters<typeof lockOwnedMediaJob>[0]) => {
      const job = await lockOwnedMediaJob(tx, input.jobId, input.workerId, {
        ...input,
        requireInput: true,
        requireOutput: true,
        lockThumbnails: true,
      });
      if (!job || job.videoId !== input.videoId)
        throw new Error("Automatic thumbnail lost its current media job/privacy authority.");
      return job;
    };
    const reservation = await this.database.client.$transaction(async (tx) => {
      const job = await owned(tx);
      const namespace = outputAttemptNamespace(job, job.video.channelId);
      const objectKey = namespace.outputAttemptId
        ? outputAttemptAddresses({ ...namespace, outputAttemptId: namespace.outputAttemptId })
            .thumbnailR2ObjectKey
        : autoThumbnailObjectKey(job.video.channelId, job.videoId);
      const losingKeys =
        job.inputIntegrityVersion === 1
          ? (
              await tx.mediaProcessingOutputAttempt.findMany({
                where: {
                  videoId: job.videoId,
                  id: { not: job.currentOutputAttemptId! },
                },
                select: { thumbnailR2ObjectKey: true },
              })
            ).map((row) => row.thumbnailR2ObjectKey)
          : [];
      const existing = await tx.mediaAsset.findFirst({
        where: {
          videoId: job.videoId,
          kind: "THUMBNAIL",
          removedAt: null,
          status: { in: ["PENDING", "UPLOADED", "VALIDATED"] },
          OR: [{ status: { not: "PENDING" } }, { r2ObjectKey: { notIn: losingKeys } }],
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, r2ObjectKey: true },
      });
      // Preserve an existing creator thumbnail or previously VALIDATED output.
      // A pending auto reservation is resumable by the current claim only.
      if (existing && (existing.r2ObjectKey !== objectKey || existing.status !== "PENDING"))
        return {
          existing: true as const,
          created: false as const,
          assetId: existing.id,
          objectKey: existing.r2ObjectKey,
          reason: "existing-thumbnail" as const,
        };
      const previous = await tx.mediaAsset.findUnique({ where: { r2ObjectKey: objectKey } });
      if (
        previous &&
        (previous.videoId !== job.videoId ||
          previous.channelId !== job.video.channelId ||
          previous.kind !== "THUMBNAIL")
      )
        throw new Error("The automatic thumbnail reservation identity changed.");
      if (previous?.removedAt || previous?.status === "REMOVED")
        throw new Error("The automatic thumbnail reservation was removed.");
      const asset = await tx.mediaAsset.upsert({
        where: { r2ObjectKey: objectKey },
        create: {
          videoId: job.videoId,
          channelId: job.video.channelId,
          kind: "THUMBNAIL",
          status: "PENDING",
          r2ObjectKey: objectKey,
          mimeType: "image/jpeg",
          sizeBytes: 0n,
        },
        update: { status: "PENDING" },
        select: { id: true },
      });
      // This durable non-eligible address precedes provider I/O, so privacy's
      // exact asset snapshot includes even an interrupted thumbnail upload.
      return {
        existing: false as const,
        assetId: asset.id,
        objectKey,
        losingKeys,
        requiredWrite: job.inputIntegrityVersion === 1,
      };
    });
    if (reservation.existing) return reservation;

    const thumbnailPath = `${input.canonicalPath}.thumbnail.jpg`;
    await this.extractFrame(input.canonicalPath, thumbnailPath, input.durationMs);
    const file = await stat(thumbnailPath);
    if (!file.isFile() || file.size <= 0)
      throw new Error("FFmpeg did not create a usable automatic thumbnail.");
    await this.database.client.$transaction(async (tx) => {
      await owned(tx);
      const changed = await tx.mediaAsset.updateMany({
        where: {
          id: reservation.assetId,
          videoId: input.videoId,
          r2ObjectKey: reservation.objectKey,
          status: "PENDING",
          removedAt: null,
        },
        data: { sizeBytes: BigInt(file.size) },
      });
      if (changed.count !== 1)
        throw new Error("The automatic thumbnail reservation changed before upload.");
    });
    await this.storage.uploadFile(
      reservation.objectKey,
      thumbnailPath,
      "image/jpeg",
      ...(reservation.requiredWrite
        ? [
            {
              jobId: input.jobId,
              workerId: input.workerId,
              attempt: input.attempt,
              outputAttemptId: input.outputAttemptId,
            },
          ]
        : []),
    );

    return this.database.client.$transaction(async (tx) => {
      await owned(tx);
      const competing = await tx.mediaAsset.findFirst({
        where: {
          videoId: input.videoId,
          kind: "THUMBNAIL",
          removedAt: null,
          status: { in: ["PENDING", "UPLOADED", "VALIDATED"] },
          r2ObjectKey: { not: reservation.objectKey },
          OR: [{ status: { not: "PENDING" } }, { r2ObjectKey: { notIn: reservation.losingKeys } }],
        },
        select: { id: true, r2ObjectKey: true },
      });
      if (competing) {
        await tx.mediaAsset.updateMany({
          where: { id: reservation.assetId, status: "PENDING", removedAt: null },
          data: { status: "REMOVED", removedAt: new Date() },
        });
        // Never issue a stale DELETE against a deterministic shared key. Retain
        // its tracked address for cleanup; removal is not provider settlement.
        return {
          created: false as const,
          assetId: competing.id,
          objectKey: competing.r2ObjectKey,
          reason: "creator-thumbnail-won-race" as const,
        };
      }
      // Current claim and database-clock lease are part of the eligibility
      // UPDATE itself, not only an earlier read that could have waited on locks.
      const changed = await tx.$executeRaw`UPDATE "MediaAsset" a
        SET status = 'VALIDATED', "mimeType" = 'image/jpeg', "sizeBytes" = ${BigInt(file.size)}, "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC')
        FROM "MediaProcessingJob" j
        WHERE a.id = ${reservation.assetId}::uuid AND a."videoId" = ${input.videoId}::uuid
          AND a."r2ObjectKey" = ${reservation.objectKey} AND a.status = 'PENDING' AND a."removedAt" IS NULL
          AND j.id = ${input.jobId}::uuid AND j."videoId" = a."videoId" AND j."leaseOwner" = ${input.workerId}
          AND j.status IN ('PROCESSING', 'UPLOADING', 'VERIFYING')
          AND j."leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
          AND ayin_media_job_has_custody(j)
          AND (j."inputIntegrityVersion" = 0 OR (j.attempt = ${input.attempt ?? null} AND j."currentOutputAttemptId" = ${input.outputAttemptId ?? null}::uuid AND j."inputVerifiedAt" IS NOT NULL AND j."inputVerifiedLeaseOwner" = j."leaseOwner" AND j."inputVerifiedAttempt" = j.attempt AND j."outputVerifiedAt" IS NOT NULL))`;
      if (changed !== 1)
        throw new Error("The automatic thumbnail reservation changed before its owned commit.");
      return {
        created: true as const,
        assetId: reservation.assetId,
        objectKey: reservation.objectKey,
        reason: "generated" as const,
      };
    });
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
