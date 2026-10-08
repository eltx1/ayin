import { randomUUID } from "node:crypto";

import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { MEDIA_RENDITION_LADDER } from "./media-architecture-v2.js";
import { HLS_PLAYLIST_CONTENT_TYPE, HLS_SEGMENT_CONTENT_TYPE } from "./media-hls-manifest.js";
import { outputAttemptAddresses, type MediaClaimIdentity } from "./media-output-attempt.js";
import { lockOwnedMediaJob } from "./media-processing-integrity-fence.js";
import { cleanupRetentionDeadline } from "./media-upload-cleanup.js";
import { MEDIA_STORAGE_CONFIG } from "./media-storage.adapter.js";
import type { MediaStorageConfig } from "./media-storage.config.js";
import {
  assertChannelMediaOwners,
  lockChannelMediaAccounts,
  observeChannelMediaOwners,
} from "./media-privacy-account-fence.js";
import {
  assertUploadDebtByteCapacity,
  DEFAULT_UPLOAD_DEBT_BYTE_LIMITS,
  lockUploadAccountAdmission,
  lockUploadAdmission,
} from "./media-upload-admission.js";

export const MEDIA_OUTPUT_WRITE_PROTOCOL_VERSION = 2;

export interface MediaOutputWriteContext extends MediaClaimIdentity {
  jobId: string;
  workerId: string;
}

export interface MediaOutputWriteDispatch {
  id: string;
  outputAttemptId: string;
  processingJobId: string;
  claimToken: string;
  attempt: number;
  objectKey: string;
  expectedSizeBytes: bigint;
  contentType: string;
}

/** Call only while holding the existing custody/generation/job lock prefix.
 * Retirement is monotonic; it never declares an in-flight PUT settled. */
export async function freezeOutputAttempts(
  tx: Prisma.TransactionClient,
  processingJobIds: readonly string[],
  frozenAt = new Date(),
  preserveAttemptIds: readonly string[] = [],
) {
  if (!processingJobIds.length) return;
  await tx.mediaProcessingOutputAttempt.updateMany({
    where: {
      processingJobId: { in: [...processingJobIds] },
      protocolVersion: 2,
      writesFrozenAt: null,
    },
    data: { writesFrozenAt: frozenAt },
  });
  const attempts = await tx.mediaProcessingOutputAttempt.findMany({
    where: {
      processingJobId: { in: [...processingJobIds] },
      protocolVersion: 2,
      ...(preserveAttemptIds.length ? { id: { notIn: [...preserveAttemptIds] } } : {}),
    },
    orderBy: { id: "asc" },
  });
  if (attempts.length)
    await tx.privacyMediaDeletionJob.createMany({
      data: attempts.map((attempt) => ({
        operationKey: `output-attempt:${attempt.id}`,
        scope: "PROCESSING_OUTPUT" as const,
        kind: "OUTPUT_SETTLEMENT" as const,
        channelId: attempt.channelId,
        processingJobId: attempt.processingJobId,
        outputAttemptId: attempt.id,
        target: attempt.canonicalR2ObjectKey,
        outputAddresses: { version: 3, attemptIds: [attempt.id] },
        cleanupContractVersion: MEDIA_OUTPUT_WRITE_PROTOCOL_VERSION,
        retainUntil: cleanupRetentionDeadline(frozenAt),
      })),
      skipDuplicates: true,
    });
}

/** A write-ahead journal, not a retry queue. One key gets exactly one dispatch.
 * Its receipt can record an old worker's outcome but grants no publication or
 * deletion authority. Missing acknowledgements remain physical-cleanup debt. */
@Injectable()
export class MediaOutputWriteJournalService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MEDIA_STORAGE_CONFIG) private readonly config?: MediaStorageConfig,
  ) {}

  async dispatch(
    input: MediaOutputWriteContext & {
      objectKey: string;
      expectedSizeBytes: number;
      contentType: string;
    },
  ): Promise<MediaOutputWriteDispatch | null> {
    if (
      !input.outputAttemptId ||
      !Number.isSafeInteger(input.attempt) ||
      input.attempt! < 1 ||
      !Number.isSafeInteger(input.expectedSizeBytes) ||
      input.expectedSizeBytes < 1
    )
      throw new Error("The output write requires an exact claim and positive safe byte count.");
    const outputAttemptId = input.outputAttemptId;

    // The promise resolves only after COMMIT. No provider I/O occurs in this
    // transaction, and no ambiguous transaction outcome authorizes a PUT.
    return this.database.client.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '3000ms'`;
      const observed = await tx.mediaProcessingJob.findUnique({
        where: { id: input.jobId },
        select: { outputProtocolVersion: true, video: { select: { channelId: true } } },
      });
      if (!observed) throw new Error("The output write job no longer exists.");
      const channelId = observed.video.channelId;
      const owners = await observeChannelMediaOwners(tx, channelId);
      if (owners.length) await lockChannelMediaAccounts(tx, owners[0]!, owners);
      await assertChannelMediaOwners(tx, channelId, owners);
      // Admission locks precede generation/asset/job locks, as in source grants.
      if (observed.outputProtocolVersion !== 1) {
        await lockUploadAccountAdmission(tx, owners);
        await lockUploadAdmission(tx, channelId);
        for (const owner of owners.length ? owners : ["00000000-0000-0000-0000-000000000000"])
          await assertUploadDebtByteCapacity(
            tx,
            owner,
            channelId,
            BigInt(input.expectedSizeBytes),
            {
              account:
                this.config?.recoveryDebtAccountBytes ?? DEFAULT_UPLOAD_DEBT_BYTE_LIMITS.account,
              channel:
                this.config?.recoveryDebtChannelBytes ?? DEFAULT_UPLOAD_DEBT_BYTE_LIMITS.channel,
            },
          );
      }
      const job = await lockOwnedMediaJob(tx, input.jobId, input.workerId, {
        attempt: input.attempt,
        outputAttemptId: input.outputAttemptId,
        requireInput: true,
        requireOutput: !input.objectKey.endsWith("/canonical.mp4"),
        lockThumbnails: input.objectKey.endsWith("/thumbnail.jpg"),
      });
      if (!job || job.inputIntegrityVersion !== 1)
        throw new Error("The output write lost its current lease, claim or privacy authority.");
      await tx.$queryRaw`SELECT id FROM "MediaProcessingOutputAttempt" WHERE id = ${input.outputAttemptId}::uuid FOR UPDATE /* ayin-output-write-attempt-lock */`;
      const attempt = await tx.mediaProcessingOutputAttempt.findUnique({
        where: { id: outputAttemptId },
      });
      if (
        !attempt ||
        attempt.protocolVersion !== job.outputProtocolVersion ||
        attempt.writesFrozenAt ||
        attempt.processingJobId !== job.id ||
        attempt.claimToken !== input.workerId ||
        attempt.attempt !== input.attempt ||
        job.currentOutputAttemptId !== attempt.id ||
        job.attempt !== attempt.attempt
      )
        throw new Error("The output write attempt is retired, untracked or no longer owned.");
      const addresses = outputAttemptAddresses({
        channelId: job.video.channelId,
        videoId: job.videoId,
        generation: job.generation,
        outputAttemptId: attempt.id,
      });
      if (
        attempt.prefix !== addresses.prefix ||
        attempt.canonicalR2ObjectKey !== addresses.canonicalR2ObjectKey ||
        attempt.hlsR2Prefix !== addresses.hlsR2Prefix ||
        attempt.thumbnailR2ObjectKey !== addresses.thumbnailR2ObjectKey ||
        !isOwnedOutputWrite(addresses, input.objectKey, input.contentType)
      )
        throw new Error("The output write key or content type is outside its exact owned attempt.");

      // The attempt lock may have waited. Recheck the lease against the database
      // clock immediately before persisting the dispatch, in addition to the
      // insert trigger's authority check.
      const current = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "MediaProcessingJob" WHERE id = ${job.id}::uuid
          AND "leaseOwner" = ${input.workerId} AND attempt = ${input.attempt}
          AND "currentOutputAttemptId" = ${attempt.id}::uuid
          AND status IN ('PROCESSING', 'UPLOADING', 'VERIFYING')
          AND "leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')`;
      if (current.length !== 1) throw new Error("The output write lease expired before dispatch.");
      // Historical jobs retain the original lane. This is available only after
      // verifying the exact persisted V1 job and current V1 attempt; callers
      // cannot bypass the V2 ledger through a supplied flag or a namespace.
      if (job.outputProtocolVersion === 1) return null;
      const receipt: MediaOutputWriteDispatch = {
        id: randomUUID(),
        outputAttemptId: attempt.id,
        processingJobId: job.id,
        claimToken: input.workerId,
        attempt: attempt.attempt,
        objectKey: input.objectKey,
        expectedSizeBytes: BigInt(input.expectedSizeBytes),
        contentType: input.contentType,
      };
      // Never upsert: even UNKNOWN or abandoned DISPATCHED rows forbid retry.
      await tx.mediaProcessingOutputWrite.create({
        data: { ...receipt, status: "DISPATCHED" },
      });
      return receipt;
    });
  }

  async acknowledge(receipt: MediaOutputWriteDispatch): Promise<void> {
    // Delayed successes from retired/losing workers still resolve this exact
    // request's evidence. Do not reacquire an active ownership/publication fence.
    const changed = await this.database.client.mediaProcessingOutputWrite.updateMany({
      where: { ...receipt, status: { in: ["DISPATCHED", "UNKNOWN"] } },
      data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date() },
    });
    if (changed.count !== 1)
      throw new Error("The exact output dispatch acknowledgement could not be recorded.");
  }

  async markUnknown(receipt: MediaOutputWriteDispatch): Promise<void> {
    await this.database.client.mediaProcessingOutputWrite.updateMany({
      where: { ...receipt, status: "DISPATCHED" },
      data: { status: "UNKNOWN", outcomeUnknownAt: new Date() },
    });
  }
}

function isOwnedOutputWrite(
  addresses: ReturnType<typeof outputAttemptAddresses>,
  key: string,
  contentType: string,
): boolean {
  if (key === addresses.canonicalR2ObjectKey) return contentType === "video/mp4";
  if (key === addresses.thumbnailR2ObjectKey) return contentType === "image/jpeg";
  if (key === `${addresses.hlsR2Prefix}master.m3u8`)
    return contentType === HLS_PLAYLIST_CONTENT_TYPE;
  for (const rendition of MEDIA_RENDITION_LADDER) {
    const prefix = `${addresses.hlsR2Prefix}${rendition.identity}/`;
    if (key === `${prefix}index.m3u8`) return contentType === HLS_PLAYLIST_CONTENT_TYPE;
    if (key.startsWith(prefix) && /^segment-[0-9]{6}\.ts$/.test(key.slice(prefix.length)))
      return contentType === HLS_SEGMENT_CONTENT_TYPE;
  }
  return false;
}
