import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { DatabaseService } from "../database/database.service.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";
import { ADAPTIVE_BACKFILL_MARKER } from "./media-adaptive-rollout.js";

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

    return this.database.client.$transaction(async (tx) => {
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
      await this.recoverStaleInTransaction(tx, now, retryLimit);
      await this.markStaleWorkersInTransaction(tx, now, leaseSeconds);

      const activeCount = await tx.mediaProcessingJob.count({
        where: { status: { in: [...ACTIVE_STATUSES] } },
      });
      if (activeCount >= capacity.concurrentJobs) return null;

      const candidate = await tx.mediaProcessingJob.findFirst({
        where: {
          status: "QUEUED",
          queuedAt: { lte: now },
          ...(canClaimBackfill
            ? {}
            : { NOT: { stagingKey: { contains: ADAPTIVE_BACKFILL_MARKER } } }),
        },
        orderBy: [{ priority: "desc" }, { queuedAt: "asc" }, { createdAt: "asc" }],
      });
      if (!candidate) return null;

      const leaseExpiresAt = new Date(now.getTime() + capacity.leaseSeconds * 1000);
      const changed = await tx.mediaProcessingJob.updateMany({
        where: { id: candidate.id, status: "QUEUED", leaseOwner: null },
        data: {
          status: "PROCESSING",
          stage: "CLAIMED",
          attempt: { increment: 1 },
          leaseOwner: leaseToken,
          leaseWorkerId: stableWorkerId,
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

      const terminal = job.attempt >= retryLimit;
      const backoffSeconds = Math.min(60, 2 ** Math.max(0, job.attempt));
      return tx.mediaProcessingJob.update({
        where: { id: job.id },
        data: terminal
          ? {
              status: "FAILED",
              stage: "FAILED",
              leaseOwner: null,
              leaseWorkerId: null,
              leaseExpiresAt: null,
              heartbeatAt: null,
              errorCode: input.errorCode.slice(0, 128),
              errorMessage: input.errorMessage,
            }
          : {
              status: "QUEUED",
              stage: "RETRY_WAIT",
              queuedAt: new Date(now.getTime() + backoffSeconds * 1000),
              leaseOwner: null,
              leaseWorkerId: null,
              leaseExpiresAt: null,
              heartbeatAt: null,
              errorCode: input.errorCode.slice(0, 128),
              errorMessage: input.errorMessage,
            },
      });
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
    const counts = Object.fromEntries(grouped.map((row) => [row.status, row._count._all]));
    const active = ACTIVE_STATUSES.reduce((total, status) => total + (counts[status] ?? 0), 0);
    return { capacity, active, counts, workers };
  }

  async recoverStale(
    onRecovered?: (tx: Prisma.TransactionClient, result: { recovered: number }) => Promise<void>,
  ) {
    return this.database.client.$transaction(async (tx) => {
      await this.lockQueue(tx);
      const values = await this.settings.getManyResolvedInTransaction(tx, [
        "mediaProcessingRetryLimit",
        "mediaProcessingLeaseSeconds",
      ]);
      const retryLimit = values.get("mediaProcessingRetryLimit") as number;
      const leaseSeconds = values.get("mediaProcessingLeaseSeconds") as number;
      const now = new Date();
      const recovered = await tx.mediaProcessingJob.count({
        where: { status: { in: [...ACTIVE_STATUSES] }, leaseExpiresAt: { lt: now } },
      });
      await this.recoverStaleInTransaction(tx, now, capacity.retryLimit);
      await this.markStaleWorkersInTransaction(tx, now, capacity.leaseSeconds);
      const result = { recovered };
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
              leaseWorkerId: null,
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
              leaseWorkerId: null,
              leaseExpiresAt: null,
              heartbeatAt: null,
              errorCode: "STALE_WORKER_LEASE",
              errorMessage: "The media worker stopped heartbeating; AYIN recovered the job safely.",
            },
      });
    }
  }
}
