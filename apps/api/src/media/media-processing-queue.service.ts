import { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { DatabaseService } from "../database/database.service.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";
import {
  ADAPTIVE_BACKFILL_MARKER,
  ADAPTIVE_BACKFILL_HARD_BATCH_MAX,
} from "./media-adaptive-rollout.js";
import { outputAttemptAddresses } from "./media-output-attempt.js";
import { freezeOutputAttempts } from "./media-output-write-journal.js";
import {
  hlsMasterObjectKey,
  hlsRenditionPlaylistObjectKey,
  hlsRenditionSegmentPrefix,
  type MediaRenditionIdentity,
  type MediaGenerationNamespace,
} from "./media-architecture-v2.js";
import { publicMediaProcessingCounts } from "./media-processing-status.js";
import {
  declareCompatibleIntegrityWorker,
  lockQueuedIntegrityJob,
} from "./media-processing-integrity-fence.js";
import { hasNewerMediaGeneration } from "./media-generation-safety.js";

const ACTIVE_STATUSES = ["PROCESSING", "UPLOADING", "VERIFYING"] as const;
const QUEUE_ADVISORY_LOCK = 86192028;
const MAX_WORKER_ID_LENGTH = 160;

export interface MediaProcessingCapacity {
  enabled: boolean;
  concurrentJobs: number;
  retryLimit: number;
  leaseSeconds: number;
}

export interface MediaProcessingWorkerRegistration {
  workerId: string;
  hostName: string;
  processId: number;
  cpuCapacity: number;
  concurrencyLimit: number;
  activeJobCount: number;
  processingVersion: number;
  releaseSha: string;
  startedAt: Date;
}

@Injectable()
export class MediaProcessingQueueService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {}

  async capacity(): Promise<MediaProcessingCapacity> {
    const values = await this.settings.getMany([
      "mediaProcessingEnabled",
      "mediaProcessingConcurrentJobs",
      "mediaProcessingRetryLimit",
      "mediaProcessingLeaseSeconds",
    ]);
    return {
      enabled: values.get("mediaProcessingEnabled") as boolean,
      concurrentJobs: values.get("mediaProcessingConcurrentJobs") as number,
      retryLimit: values.get("mediaProcessingRetryLimit") as number,
      leaseSeconds: values.get("mediaProcessingLeaseSeconds") as number,
    };
  }

  async registerWorker(input: MediaProcessingWorkerRegistration): Promise<void> {
    this.assertWorkerId(input.workerId);
    const now = new Date();
    await this.database.client.mediaProcessingWorker.upsert({
      where: { id: input.workerId },
      update: {
        hostName: input.hostName,
        processId: input.processId,
        status: "RUNNING",
        cpuCapacity: input.cpuCapacity,
        concurrencyLimit: input.concurrencyLimit,
        activeJobCount: input.activeJobCount,
        processingVersion: input.processingVersion,
        releaseSha: input.releaseSha,
        startedAt: input.startedAt,
        heartbeatAt: now,
        drainingAt: null,
        stoppedAt: null,
      },
      create: {
        id: input.workerId,
        hostName: input.hostName,
        processId: input.processId,
        status: "RUNNING",
        cpuCapacity: input.cpuCapacity,
        concurrencyLimit: input.concurrencyLimit,
        activeJobCount: input.activeJobCount,
        processingVersion: input.processingVersion,
        releaseSha: input.releaseSha,
        startedAt: input.startedAt,
        heartbeatAt: now,
      },
    });
  }

  async heartbeatWorker(
    workerId: string,
    activeJobCount: number,
    status: "RUNNING" | "DRAINING" = "RUNNING",
  ): Promise<boolean> {
    this.assertWorkerId(workerId);
    const now = new Date();
    const updated = await this.database.client.mediaProcessingWorker.updateMany({
      where: { id: workerId, status: { not: "STOPPED" } },
      data: {
        status,
        activeJobCount: Math.max(0, Math.trunc(activeJobCount)),
        heartbeatAt: now,
        ...(status === "DRAINING" ? { drainingAt: now } : {}),
      },
    });
    return updated.count === 1;
  }

  async markWorkerStopped(workerId: string, activeJobCount: number): Promise<void> {
    this.assertWorkerId(workerId);
    const now = new Date();
    await this.database.client.mediaProcessingWorker.updateMany({
      where: { id: workerId },
      data: {
        status: "STOPPED",
        activeJobCount: Math.max(0, Math.trunc(activeJobCount)),
        heartbeatAt: now,
        stoppedAt: now,
      },
    });
  }

  async claimNext(workerId: string) {
    const stableWorkerId = workerId.trim();
    this.assertWorkerId(stableWorkerId);
    const leaseToken = `${stableWorkerId}:${randomUUID()}`;
    // Commit recovery's job-row locks before a required claim takes its ordered
    // Account/generation prefix. Holding a recovered row while waiting on its
    // privacy owner would invert privacy's Account -> job ordering.
    const enabled = await this.database.client.$transaction(async (tx) => {
      await this.lockQueue(tx);
      const values = await this.settings.getManyResolvedInTransaction(tx, [
        "mediaProcessingEnabled",
        "mediaProcessingRetryLimit",
        "mediaProcessingLeaseSeconds",
      ]);
      if (!(values.get("mediaProcessingEnabled") as boolean)) return false;
      const now = new Date();
      await this.recoverStaleInTransaction(
        tx,
        now,
        values.get("mediaProcessingRetryLimit") as number,
      );
      await this.markStaleWorkersInTransaction(
        tx,
        now,
        values.get("mediaProcessingLeaseSeconds") as number,
      );
      return true;
    });
    if (!enabled) return null;

    return this.database.client
      .$transaction(async (tx) => {
        await this.lockQueue(tx);
        const values = await this.settings.getManyResolvedInTransaction(tx, [
          "mediaProcessingEnabled",
          "mediaProcessingConcurrentJobs",
          "mediaProcessingRetryLimit",
          "mediaProcessingLeaseSeconds",
          "mediaHlsEnabled",
          "mediaHlsBackfillEnabled",
          "mediaHlsBackfillPaused",
        ]);
        const capacity: MediaProcessingCapacity = {
          enabled: values.get("mediaProcessingEnabled") as boolean,
          concurrentJobs: values.get("mediaProcessingConcurrentJobs") as number,
          retryLimit: values.get("mediaProcessingRetryLimit") as number,
          leaseSeconds: values.get("mediaProcessingLeaseSeconds") as number,
        };
        const canClaimBackfill =
          (values.get("mediaHlsEnabled") as boolean) &&
          (values.get("mediaHlsBackfillEnabled") as boolean) &&
          !(values.get("mediaHlsBackfillPaused") as boolean);
        if (!capacity.enabled) return null;

        const now = new Date();
        const activeCount = await tx.mediaProcessingJob.count({
          where: { status: { in: [...ACTIVE_STATUSES] } },
        });
        if (activeCount >= capacity.concurrentJobs) return null;

        // Eligibility is a read-only prefilter, followed by the same ordered
        // custody/source revalidation as owned callbacks. A closed/detached
        // required row cannot starve otherwise eligible legacy or required work.
        const candidates = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT j.id FROM "MediaProcessingJob" j
          WHERE ((j.status = 'QUEUED' AND j."inputIntegrityVersion" = 0)
            OR (j.status = 'INTEGRITY_QUEUED' AND j."inputIntegrityVersion" = 1 AND ayin_required_media_job_eligible(j)))
            AND j."queuedAt" <= ${now}
            AND (${canClaimBackfill} OR j."stagingKey" NOT LIKE ${`%${ADAPTIVE_BACKFILL_MARKER}%`})
          ORDER BY j.priority DESC, j."queuedAt" ASC, j."createdAt" ASC LIMIT 1
        `);
        const candidate = candidates[0]
          ? await tx.mediaProcessingJob.findUnique({ where: { id: candidates[0].id } })
          : null;
        if (!candidate) return null;

        await declareCompatibleIntegrityWorker(tx);
        let outputAttempt: { id: string; canonicalR2ObjectKey: string } | null = null;
        let attemptNamespace: MediaGenerationNamespace | null = null;
        if (candidate.inputIntegrityVersion === 1) {
          if (!(await lockQueuedIntegrityJob(tx, candidate.id, candidate.attempt))) return null;
          await freezeOutputAttempts(tx, [candidate.id]);
          const video = await tx.video.findUniqueOrThrow({
            where: { id: candidate.videoId },
            select: { channelId: true },
          });
          const id = randomUUID();
          const namespace = {
            channelId: video.channelId,
            videoId: candidate.videoId,
            generation: candidate.generation,
            outputAttemptId: id,
          };
          attemptNamespace = namespace;
          outputAttempt = await tx.mediaProcessingOutputAttempt.create({
            data: {
              id,
              protocolVersion: candidate.outputProtocolVersion,
              processingJobId: candidate.id,
              channelId: video.channelId,
              videoId: candidate.videoId,
              generation: candidate.generation,
              claimToken: leaseToken,
              attempt: candidate.attempt + 1,
              ...outputAttemptAddresses(namespace),
            },
          });
        }
        const claimedAt = new Date();
        const leaseExpiresAt = new Date(claimedAt.getTime() + capacity.leaseSeconds * 1000);
        const changed = await tx.mediaProcessingJob.updateMany({
          where: { id: candidate.id, status: candidate.status, leaseOwner: null },
          data: {
            status: "PROCESSING",
            ...(outputAttempt
              ? {
                  currentOutputAttemptId: outputAttempt.id,
                  outputR2ObjectKey: outputAttempt.canonicalR2ObjectKey,
                }
              : {}),
            stage: "CLAIMED",
            inputVerifiedAt: null,
            inputVerifiedLeaseOwner: null,
            inputVerifiedAttempt: null,
            outputIntegrityDigest: null,
            outputIntegritySizeBytes: null,
            outputVerifiedAt: null,
            attempt: { increment: 1 },
            leaseOwner: leaseToken,
            leaseWorkerId: stableWorkerId,
            leaseExpiresAt,
            heartbeatAt: claimedAt,
            startedAt: candidate.startedAt ?? claimedAt,
            errorCode: null,
            errorMessage: null,
          },
        });
        if (changed.count !== 1) {
          if (outputAttempt) throw new OutputAttemptClaimConflict();
          return null;
        }
        if (attemptNamespace) {
          // Invalidate/repoint metadata atomically before any write can occur.
          // Losing keys remain in the append-only ledger; old in-flight PUTs can
          // complete only at those old addresses, never at the new winner's keys.
          const generation = await tx.mediaPlaybackGeneration.findUnique({
            where: {
              videoId_generation: { videoId: candidate.videoId, generation: candidate.generation },
            },
            include: { renditions: true },
          });
          if (generation) {
            await tx.mediaPlaybackGeneration.update({
              where: { id: generation.id },
              data: {
                status: "BUILDING",
                readyAt: null,
                fallbackStatus: "PLANNED",
                hlsMasterStatus: "PLANNED",
                outputAttemptId: outputAttempt!.id,
                fallbackR2ObjectKey: outputAttempt!.canonicalR2ObjectKey,
                hlsMasterR2ObjectKey: hlsMasterObjectKey(attemptNamespace),
              },
            });
            for (const rendition of generation.renditions)
              await tx.mediaPlaybackRendition.update({
                where: { id: rendition.id },
                data: {
                  status: "PLANNED",
                  readyAt: null,
                  playlistR2ObjectKey: hlsRenditionPlaylistObjectKey(
                    attemptNamespace,
                    rendition.identity as MediaRenditionIdentity,
                  ),
                  segmentR2Prefix: hlsRenditionSegmentPrefix(
                    attemptNamespace,
                    rendition.identity as MediaRenditionIdentity,
                  ),
                },
              });
          }
        }
        return tx.mediaProcessingJob.findUnique({ where: { id: candidate.id } });
      })
      .catch((error) => {
        if (error instanceof OutputAttemptClaimConflict) return null;
        throw error;
      });
  }

  async heartbeat(jobId: string, leaseToken: string): Promise<boolean> {
    const leaseSeconds = (await this.settings.get("mediaProcessingLeaseSeconds")) as number;
    const now = new Date();
    const updated = await this.database.client.mediaProcessingJob.updateMany({
      where: {
        id: jobId,
        leaseOwner: leaseToken,
        status: { in: [...ACTIVE_STATUSES] },
        leaseExpiresAt: { gt: now },
      },
      data: {
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000),
      },
    });
    return updated.count === 1;
  }

  async requeueAfterFailure(input: {
    jobId: string;
    leaseToken: string;
    errorCode: string;
    errorMessage: string;
  }) {
    return this.database.client.$transaction(async (tx) => {
      await this.lockQueue(tx);
      const values = await this.settings.getManyResolvedInTransaction(tx, [
        "mediaProcessingRetryLimit",
      ]);
      const retryLimit = values.get("mediaProcessingRetryLimit") as number;
      const now = new Date();
      const job = await tx.mediaProcessingJob.findFirst({
        where: {
          id: input.jobId,
          leaseOwner: input.leaseToken,
          status: { in: [...ACTIVE_STATUSES] },
          leaseExpiresAt: { gt: now },
        },
      });
      if (!job) return null;

      const superseded = await hasNewerMediaGeneration(tx, job);
      const terminal =
        superseded ||
        job.attempt >= retryLimit ||
        input.errorCode === "MEDIA_OUTPUT_ENVELOPE_EXCEEDED";
      const backoffSeconds = Math.min(60, 2 ** Math.max(0, job.attempt));
      const changed = await tx.mediaProcessingJob.updateMany({
        where: {
          id: job.id,
          leaseOwner: input.leaseToken,
          status: { in: [...ACTIVE_STATUSES] },
          leaseExpiresAt: { gt: new Date() },
        },
        data: terminal
          ? {
              status: "FAILED",
              stage: superseded ? "SUPERSEDED" : "FAILED",
              leaseOwner: null,
              leaseWorkerId: null,
              leaseExpiresAt: null,
              heartbeatAt: null,
              errorCode: superseded ? "MEDIA_GENERATION_SUPERSEDED" : input.errorCode.slice(0, 128),
              errorMessage: input.errorMessage,
            }
          : {
              status: job.inputIntegrityVersion === 1 ? "INTEGRITY_QUEUED" : "QUEUED",
              stage: job.inputIntegrityVersion === 1 ? "INTEGRITY_QUEUED" : "RETRY_WAIT",
              queuedAt: new Date(now.getTime() + backoffSeconds * 1000),
              leaseOwner: null,
              leaseWorkerId: null,
              leaseExpiresAt: null,
              heartbeatAt: null,
              errorCode: input.errorCode.slice(0, 128),
              errorMessage: input.errorMessage,
            },
      });
      if (changed.count === 1 && job.inputIntegrityVersion === 1)
        await freezeOutputAttempts(tx, [job.id], now);
      return changed.count === 1
        ? tx.mediaProcessingJob.findUnique({ where: { id: job.id } })
        : null;
    });
  }

  async overview() {
    const capacity = await this.capacity();
    const activeWorkerCutoff = new Date(
      Date.now() - Math.max(60_000, capacity.leaseSeconds * 2_000),
    );
    const [grouped, workers] = await Promise.all([
      this.database.client.mediaProcessingJob.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      this.database.client.mediaProcessingWorker.findMany({
        where: {
          status: { in: ["RUNNING", "DRAINING"] },
          heartbeatAt: { gte: activeWorkerCutoff },
        },
        orderBy: { heartbeatAt: "desc" },
        take: 100,
        select: {
          id: true,
          hostName: true,
          processId: true,
          status: true,
          cpuCapacity: true,
          concurrencyLimit: true,
          activeJobCount: true,
          processingVersion: true,
          releaseSha: true,
          startedAt: true,
          heartbeatAt: true,
          drainingAt: true,
        },
      }),
    ]);
    const counts = publicMediaProcessingCounts(
      Object.fromEntries(grouped.map((row) => [row.status, row._count._all])),
    );
    const active = ACTIVE_STATUSES.reduce((total, status) => total + (counts[status] ?? 0), 0);
    return { capacity, active, counts, workers };
  }

  async recoverStale(
    onRecovered?: (
      tx: Prisma.TransactionClient,
      result: { recovered: number; requeued: number; failed: number },
    ) => Promise<void>,
    batchSize?: number,
  ) {
    if (
      batchSize !== undefined &&
      (!Number.isInteger(batchSize) ||
        batchSize < 1 ||
        batchSize > ADAPTIVE_BACKFILL_HARD_BATCH_MAX)
    ) {
      throw new RangeError("Recovery batch size must be an integer from 1 to 20.");
    }
    return this.database.client.$transaction(async (tx) => {
      await this.lockQueue(tx);
      const values = await this.settings.getManyResolvedInTransaction(tx, [
        "mediaProcessingRetryLimit",
        "mediaProcessingLeaseSeconds",
      ]);
      const retryLimit = values.get("mediaProcessingRetryLimit") as number;
      const leaseSeconds = values.get("mediaProcessingLeaseSeconds") as number;
      const now = new Date();
      const result = await this.recoverStaleInTransaction(tx, now, retryLimit, batchSize);
      // Explicit bounded operator requests only mutate the selected jobs. Automatic
      // recovery retains its existing worker-liveness housekeeping.
      if (batchSize === undefined) await this.markStaleWorkersInTransaction(tx, now, leaseSeconds);
      await onRecovered?.(tx, result);
      return result;
    });
  }

  private assertWorkerId(workerId: string): void {
    if (!workerId || workerId.length > MAX_WORKER_ID_LENGTH) {
      throw new Error("A valid media worker identifier is required.");
    }
  }

  private async lockQueue(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRawUnsafe(
      `DO $task85$ BEGIN PERFORM pg_advisory_xact_lock(${QUEUE_ADVISORY_LOCK}); END $task85$;`,
    );
  }

  private async markStaleWorkersInTransaction(
    tx: Prisma.TransactionClient,
    now: Date,
    leaseSeconds: number,
  ): Promise<void> {
    const cutoff = new Date(now.getTime() - Math.max(60_000, leaseSeconds * 2_000));
    await tx.mediaProcessingWorker.updateMany({
      where: {
        status: { in: ["RUNNING", "DRAINING"] },
        heartbeatAt: { lt: cutoff },
      },
      data: { status: "STALE", stoppedAt: now },
    });
  }

  private async recoverStaleInTransaction(
    tx: Prisma.TransactionClient,
    now: Date,
    retryLimit: number,
    batchSize?: number,
  ): Promise<{ recovered: number; requeued: number; failed: number }> {
    const stale = await tx.mediaProcessingJob.findMany({
      where: { status: { in: [...ACTIVE_STATUSES] }, leaseExpiresAt: { lt: now } },
      orderBy: [{ leaseExpiresAt: "asc" }, { id: "asc" }],
      ...(batchSize === undefined ? {} : { take: batchSize }),
      select: { id: true, attempt: true, updatedAt: true, inputIntegrityVersion: true },
    });
    let requeued = 0;
    let failed = 0;
    for (const job of stale) {
      const terminal = job.attempt >= retryLimit;
      const changed = await tx.mediaProcessingJob.updateMany({
        where: {
          id: job.id,
          updatedAt: job.updatedAt,
          status: { in: [...ACTIVE_STATUSES] },
          leaseExpiresAt: { lt: now },
        },
        data: terminal
          ? {
              status: "FAILED",
              stage: "STALE_LEASE_FAILED",
              leaseOwner: null,
              leaseWorkerId: null,
              leaseExpiresAt: null,
              heartbeatAt: null,
              errorCode: "STALE_WORKER_LEASE",
              errorMessage: "The media worker stopped heartbeating and exhausted its retry limit.",
            }
          : {
              status: job.inputIntegrityVersion === 1 ? "INTEGRITY_QUEUED" : "QUEUED",
              stage: job.inputIntegrityVersion === 1 ? "INTEGRITY_QUEUED" : "STALE_LEASE_RECOVERED",
              queuedAt: now,
              leaseOwner: null,
              leaseWorkerId: null,
              leaseExpiresAt: null,
              heartbeatAt: null,
              errorCode: "STALE_WORKER_LEASE",
              errorMessage: "The media worker stopped heartbeating; AYIN recovered the job safely.",
            },
      });
      if (changed.count === 1 && job.inputIntegrityVersion === 1)
        await freezeOutputAttempts(tx, [job.id], now);
      if (terminal) failed += changed.count;
      else requeued += changed.count;
    }
    return { recovered: requeued + failed, requeued, failed };
  }
}

class OutputAttemptClaimConflict extends Error {}
