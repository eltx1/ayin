import { randomUUID } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import { availableParallelism, hostname } from "node:os";

import { Inject, Injectable } from "@nestjs/common";

import { ObservabilityService } from "../observability/observability.service.js";
import { releaseSha, StructuredLoggerService } from "../observability/structured-logger.service.js";
import { MEDIA_ARCHITECTURE_VERSION } from "./media-architecture-v2.js";
import { MediaProcessingExecutorService } from "./media-processing-executor.service.js";
import { MediaProcessingQueueService } from "./media-processing-queue.service.js";

const MAX_LOCAL_SLOTS = 128;
const IDLE_POLL_MS = 1000;
const WORKER_HEARTBEAT_MS = 10_000;
const DEFAULT_LOCAL_CONCURRENCY = 1;
const DEFAULT_SHUTDOWN_GRACE_SECONDS = 60;
const ABORT_SETTLE_MS = 5_000;

export function configuredMediaWorkerConcurrency(): number {
  const parsed = Number(process.env.MEDIA_WORKER_CONCURRENCY ?? DEFAULT_LOCAL_CONCURRENCY);
  if (!Number.isFinite(parsed)) return DEFAULT_LOCAL_CONCURRENCY;
  return Math.max(1, Math.min(MAX_LOCAL_SLOTS, Math.trunc(parsed)));
}

export function configuredMediaWorkerShutdownGraceMs(): number {
  const parsed = Number(
    process.env.MEDIA_WORKER_SHUTDOWN_GRACE_SECONDS ?? DEFAULT_SHUTDOWN_GRACE_SECONDS,
  );
  const seconds = Number.isFinite(parsed) ? Math.trunc(parsed) : DEFAULT_SHUTDOWN_GRACE_SECONDS;
  return Math.max(5, Math.min(300, seconds)) * 1000;
}

@Injectable()
export class MediaProcessingWorkerService {
  private readonly active = new Map<Promise<void>, AbortController>();
  private readonly hostName = hostname();
  private readonly instanceId = `${this.hostName.slice(0, 80)}:${process.pid}:${randomUUID()}`;
  private readonly startedAt = new Date();
  private readonly cpuCapacity = Math.max(1, availableParallelism());
  private readonly concurrencyLimit = configuredMediaWorkerConcurrency();
  private heartbeatErrorActive = false;
  private stopping = false;

  constructor(
    @Inject(MediaProcessingQueueService) private readonly queue: MediaProcessingQueueService,
    @Inject(MediaProcessingExecutorService)
    private readonly executor: MediaProcessingExecutorService,
    @Inject(StructuredLoggerService) private readonly logger: StructuredLoggerService,
    @Inject(ObservabilityService) private readonly observability: ObservabilityService,
  ) {}

  async run(): Promise<void> {
    await this.queue.registerWorker({
      workerId: this.instanceId,
      hostName: this.hostName,
      processId: process.pid,
      cpuCapacity: this.cpuCapacity,
      concurrencyLimit: this.concurrencyLimit,
      activeJobCount: 0,
      processingVersion: MEDIA_ARCHITECTURE_VERSION,
      releaseSha: releaseSha(),
      startedAt: this.startedAt,
    });
    this.logger.event("info", "media_worker.started", {
      instanceId: this.instanceId,
      pid: process.pid,
      host: this.hostName,
      cpuCapacity: this.cpuCapacity,
      concurrencyLimit: this.concurrencyLimit,
      processingVersion: MEDIA_ARCHITECTURE_VERSION,
    });
    await this.writeHeartbeat("running");
    const heartbeatTimer = setInterval(
      () => void this.writeHeartbeat(this.stopping ? "draining" : "running"),
      WORKER_HEARTBEAT_MS,
    );
    heartbeatTimer.unref();

    try {
      while (!this.stopping) {
        const capacity = await this.queue.capacity();
        const localSlotLimit = Math.min(
          MAX_LOCAL_SLOTS,
          this.concurrencyLimit,
          capacity.concurrentJobs,
        );
        let claimedAny = false;

        while (!this.stopping && this.active.size < localSlotLimit) {
          const job = await this.queue.claimNext(this.instanceId);
          if (!job) break;
          if (!job.leaseOwner) {
            throw new Error("Claimed media job did not include a lease token.");
          }

          claimedAny = true;
          const controller = new AbortController();
          const task = this.executor
            .process(job, job.leaseOwner, controller.signal)
            .catch((error: unknown) => {
              this.observability.captureError(error, {
                source: "media.worker.executor",
                path: "/media-worker",
                details: { jobId: job.id, workerId: this.instanceId },
              });
            })
            .finally(() => {
              this.active.delete(task);
              void this.writeHeartbeat(this.stopping ? "draining" : "running");
            });
          this.active.set(task, controller);
        }

        if (this.stopping) break;
        if (claimedAny) {
          await yieldToEventLoop();
          continue;
        }
        if (this.active.size > 0) {
          await Promise.race([Promise.race(this.active.keys()), sleep(IDLE_POLL_MS)]);
        } else {
          await sleep(IDLE_POLL_MS);
        }
      }
    } finally {
      clearInterval(heartbeatTimer);
      await this.queue.heartbeatWorker(this.instanceId, this.active.size, "DRAINING").catch(
        (error: unknown) => {
          this.observability.captureError(error, { source: "media.worker.registry_drain" });
        },
      );
      await this.writeHeartbeat("draining");
      this.logger.event("info", "media_worker.stopped_claiming", {
        instanceId: this.instanceId,
        activeJobs: this.active.size,
      });

      const graceMs = configuredMediaWorkerShutdownGraceMs();
      let drained = await this.waitForActive(graceMs);
      if (!drained && this.active.size > 0) {
        this.logger.event("warn", "media_worker.shutdown_abort_active", {
          instanceId: this.instanceId,
          activeJobs: this.active.size,
          graceMs,
        });
        for (const controller of this.active.values()) controller.abort();
        drained = await this.waitForActive(ABORT_SETTLE_MS);
      }

      await this.queue.markWorkerStopped(this.instanceId, this.active.size).catch(
        (error: unknown) => {
          this.observability.captureError(error, { source: "media.worker.registry_stop" });
        },
      );
      await this.writeHeartbeat("stopped");
      this.logger.event("info", "media_worker.stopped", {
        instanceId: this.instanceId,
        activeJobs: this.active.size,
        drained,
      });
    }
  }

  stop(): void {
    this.stopping = true;
  }

  activeCount(): number {
    return this.active.size;
  }

  workerId(): string {
    return this.instanceId;
  }

  private async waitForActive(timeoutMs: number): Promise<boolean> {
    if (this.active.size === 0) return true;
    const snapshot = [...this.active.keys()];
    return Promise.race([
      Promise.allSettled(snapshot).then(() => true),
      sleep(timeoutMs).then(() => false),
    ]);
  }

  private async writeHeartbeat(status: "running" | "draining" | "stopped"): Promise<void> {
    if (status !== "stopped") {
      await this.queue
        .heartbeatWorker(
          this.instanceId,
          this.active.size,
          status === "draining" ? "DRAINING" : "RUNNING",
        )
        .catch((error: unknown) => {
          this.observability.captureError(error, { source: "media.worker.registry_heartbeat" });
        });
    }

    const heartbeatPath =
      process.env.MEDIA_WORKER_HEARTBEAT_PATH ?? "/tmp/ayin-media-worker-heartbeat.json";
    const temporaryPath = `${heartbeatPath}.${process.pid}.tmp`;
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify({
          service: "ayin-media-worker",
          instanceId: this.instanceId,
          releaseSha: releaseSha(),
          pid: process.pid,
          host: this.hostName,
          startedAt: this.startedAt.toISOString(),
          heartbeatAt: new Date().toISOString(),
          activeJobs: this.active.size,
          concurrencyLimit: this.concurrencyLimit,
          cpuCapacity: this.cpuCapacity,
          processingVersion: MEDIA_ARCHITECTURE_VERSION,
          status,
        })}\n`,
        { mode: 0o640 },
      );
      await rename(temporaryPath, heartbeatPath);
      if (this.heartbeatErrorActive) {
        this.heartbeatErrorActive = false;
        this.logger.event("info", "media_worker.heartbeat_recovered");
      }
    } catch (error) {
      if (!this.heartbeatErrorActive) {
        this.heartbeatErrorActive = true;
        this.observability.captureError(error, { source: "media.worker.heartbeat" });
      }
    }
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
