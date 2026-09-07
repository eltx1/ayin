import { randomUUID } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import { hostname } from "node:os";

import { Inject, Injectable } from "@nestjs/common";

import { ObservabilityService } from "../observability/observability.service.js";
import { releaseSha, StructuredLoggerService } from "../observability/structured-logger.service.js";
import { MediaProcessingExecutorService } from "./media-processing-executor.service.js";
import { MediaProcessingQueueService } from "./media-processing-queue.service.js";

const MAX_LOCAL_SLOTS = 128;
const IDLE_POLL_MS = 1000;
const HEARTBEAT_MS = 10_000;

@Injectable()
export class MediaProcessingWorkerService {
  private readonly active = new Set<Promise<void>>();
  private readonly instanceId = `${hostname()}:${process.pid}:${randomUUID()}`;
  private readonly startedAt = new Date().toISOString();
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
    this.logger.event("info", "media_worker.started", {
      instanceId: this.instanceId,
      pid: process.pid,
      host: hostname(),
    });
    await this.writeHeartbeat("running");
    const heartbeatTimer = setInterval(() => void this.writeHeartbeat("running"), HEARTBEAT_MS);
    heartbeatTimer.unref();
    try {
      while (!this.stopping) {
        const capacity = await this.queue.capacity();
        const localSlotLimit = Math.min(MAX_LOCAL_SLOTS, capacity.concurrentJobs);
        let claimedAny = false;
        while (!this.stopping && this.active.size < localSlotLimit) {
          const workerId = `${hostname()}:${process.pid}:${randomUUID()}`;
          const job = await this.queue.claimNext(workerId);
          if (!job) break;
          claimedAny = true;
          const task = this.executor
            .process(job, workerId)
            .catch((error: unknown) => {
              this.observability.captureError(error, {
                source: "media.worker.executor",
                path: "/media-worker",
                details: { jobId: job.id },
              });
            })
            .finally(() => this.active.delete(task));
          this.active.add(task);
        }

        if (this.stopping) break;
        if (claimedAny) {
          await yieldToEventLoop();
          continue;
        }
        if (this.active.size > 0) {
          await Promise.race([Promise.race(this.active), sleep(IDLE_POLL_MS)]);
        } else {
          await sleep(IDLE_POLL_MS);
        }
      }
    } finally {
      clearInterval(heartbeatTimer);
      await this.writeHeartbeat("stopping");
      this.logger.event("info", "media_worker.stopped_claiming", {
        instanceId: this.instanceId,
        activeJobs: this.active.size,
      });
    }
  }

  stop(): void {
    this.stopping = true;
  }

  activeCount(): number {
    return this.active.size;
  }

  private async writeHeartbeat(status: "running" | "stopping"): Promise<void> {
    const heartbeatPath = process.env.MEDIA_WORKER_HEARTBEAT_PATH ?? "/tmp/ayin-media-worker-heartbeat.json";
    const temporaryPath = `${heartbeatPath}.${process.pid}.tmp`;
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify({
          service: "ayin-media-worker",
          instanceId: this.instanceId,
          releaseSha: releaseSha(),
          pid: process.pid,
          startedAt: this.startedAt,
          heartbeatAt: new Date().toISOString(),
          activeJobs: this.active.size,
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
