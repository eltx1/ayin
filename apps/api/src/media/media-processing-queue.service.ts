import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";

const ACTIVE_STATUSES = ["PROCESSING", "UPLOADING", "VERIFYING"] as const;
const QUEUE_ADVISORY_LOCK = 86192028;

export interface MediaProcessingCapacity {
  enabled: boolean;
  concurrentJobs: number;
  retryLimit: number;
  leaseSeconds: number;
}

@Injectable()
export class MediaProcessingQueueService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {}

  async capacity(): Promise<MediaProcessingCapacity> {
    const [enabled, concurrentJobs, retryLimit, leaseSeconds] = await Promise.all([
      this.settings.get("mediaProcessingEnabled"),
      this.settings.get("mediaProcessingConcurrentJobs"),
      this.settings.get("mediaProcessingRetryLimit"),
      this.settings.get("mediaProcessingLeaseSeconds"),
    ]);
    return {
      enabled: enabled as boolean,
      concurrentJobs: concurrentJobs as number,
      retryLimit: retryLimit as number,
      leaseSeconds: leaseSeconds as number,
    };
  }

  async claimNext(workerId: string) {
    const owner = workerId.trim();
    if (!owner || owner.length > 255)
      throw new Error("A valid media worker identifier is required.");

    return this.database.client.$transaction(async (tx) => {
      await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock($1)", QUEUE_ADVISORY_LOCK);
      const capacity = await this.capacityInTransaction(tx);
      const now = new Date();
      await this.recoverStaleInTransaction(tx, now, capacity.retryLimit);
      if (!capacity.enabled) return null;

      const activeCount = await tx.mediaProcessingJob.count({
        where: { status: { in: [...ACTIVE_STATUSES] } },
      });
      if (activeCount >= capacity.concurrentJobs) return null;

      const candidate = await tx.mediaProcessingJob.findFirst({
        where: { status: "QUEUED", queuedAt: { lte: now } },
        orderBy: [{ priority: "desc" }, { queuedAt: "asc" }, { createdAt: "asc" }],
      });
      if (!candidate) return null;

      const leaseExpiresAt = new Date(now.getTime() + capacity.leaseSeconds * 1000);
      const changed = await tx.mediaProcessingJob.updateMany({
        where: { id: candidate.id, status: "QUEUED" },
        data: {
          status: "PROCESSING",
          stage: "CLAIMED",
          attempt: { increment: 1 },
          leaseOwner: owner,
          leaseExpiresAt,
          heartbeatAt: now,
          startedAt: candidate.startedAt ?? now,
          errorCode: null,
          errorMessage: null,
        },
      });
      if (changed.count !== 1) return null;
      return tx.mediaProcessingJob.findUnique({ where: { id: candidate.id } });
    });
  }

  async heartbeat(jobId: string, workerId: string): Promise<boolean> {
    const leaseSeconds = (await this.settings.get("mediaProcessingLeaseSeconds")) as number;
    const now = new Date();
    const updated = await this.database.client.mediaProcessingJob.updateMany({
      where: { id: jobId, leaseOwner: workerId, status: { in: [...ACTIVE_STATUSES] } },
      data: {
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000),
      },
    });
    return updated.count === 1;
  }

  async requeueAfterFailure(input: {
    jobId: string;
    workerId: string;
    errorCode: string;
    errorMessage: string;
  }) {
    return this.database.client.$transaction(async (tx) => {
      await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock($1)", QUEUE_ADVISORY_LOCK);
      const retryLimit = (
        await this.settings.getResolvedInTransaction(tx, "mediaProcessingRetryLimit")
      ).value as number;
      const job = await tx.mediaProcessingJob.findFirst({
        where: {
          id: input.jobId,
          leaseOwner: input.workerId,
          status: { in: [...ACTIVE_STATUSES] },
        },
      });
      if (!job) return null;

      const terminal = job.attempt >= retryLimit;
      const backoffSeconds = Math.min(60, 2 ** Math.max(0, job.attempt));
      return tx.mediaProcessingJob.update({
        where: { id: job.id },
        data: terminal
          ? {
              status: "FAILED",
              stage: "FAILED",
              leaseOwner: null,
              leaseExpiresAt: null,
              heartbeatAt: null,
              errorCode: input.errorCode.slice(0, 128),
              errorMessage: input.errorMessage,
            }
          : {
              status: "QUEUED",
              stage: "RETRY_WAIT",
              queuedAt: new Date(Date.now() + backoffSeconds * 1000),
              leaseOwner: null,
              leaseExpiresAt: null,
              heartbeatAt: null,
              errorCode: input.errorCode.slice(0, 128),
              errorMessage: input.errorMessage,
            },
      });
    });
  }

  async overview() {
    const [capacity, grouped] = await Promise.all([
      this.capacity(),
      this.database.client.mediaProcessingJob.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const counts = Object.fromEntries(grouped.map((row) => [row.status, row._count._all]));
    const active = ACTIVE_STATUSES.reduce((total, status) => total + (counts[status] ?? 0), 0);
    return { capacity, active, counts };
  }

  private async capacityInTransaction(
    tx: Prisma.TransactionClient,
  ): Promise<MediaProcessingCapacity> {
    const [enabled, concurrentJobs, retryLimit, leaseSeconds] = await Promise.all([
      this.settings.getResolvedInTransaction(tx, "mediaProcessingEnabled"),
      this.settings.getResolvedInTransaction(tx, "mediaProcessingConcurrentJobs"),
      this.settings.getResolvedInTransaction(tx, "mediaProcessingRetryLimit"),
      this.settings.getResolvedInTransaction(tx, "mediaProcessingLeaseSeconds"),
    ]);
    return {
      enabled: enabled.value as boolean,
      concurrentJobs: concurrentJobs.value as number,
      retryLimit: retryLimit.value as number,
      leaseSeconds: leaseSeconds.value as number,
    };
  }

  private async recoverStaleInTransaction(
    tx: Prisma.TransactionClient,
    now: Date,
    retryLimit: number,
  ): Promise<void> {
    const stale = await tx.mediaProcessingJob.findMany({
      where: { status: { in: [...ACTIVE_STATUSES] }, leaseExpiresAt: { lt: now } },
      select: { id: true, attempt: true },
    });

    for (const job of stale) {
      const terminal = job.attempt >= retryLimit;
      await tx.mediaProcessingJob.updateMany({
        where: {
          id: job.id,
          status: { in: [...ACTIVE_STATUSES] },
          leaseExpiresAt: { lt: now },
        },
        data: terminal
          ? {
              status: "FAILED",
              stage: "STALE_LEASE_FAILED",
              leaseOwner: null,
              leaseExpiresAt: null,
              heartbeatAt: null,
              errorCode: "STALE_WORKER_LEASE",
              errorMessage: "The media worker stopped heartbeating and exhausted its retry limit.",
            }
          : {
              status: "QUEUED",
              stage: "STALE_LEASE_RECOVERED",
              queuedAt: now,
              leaseOwner: null,
              leaseExpiresAt: null,
              heartbeatAt: null,
              errorCode: "STALE_WORKER_LEASE",
              errorMessage: "The media worker stopped heartbeating; AYIN recovered the job safely.",
            },
      });
    }
  }
}
