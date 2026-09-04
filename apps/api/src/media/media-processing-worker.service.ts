import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import { Inject, Injectable, Logger } from "@nestjs/common";

import { MediaProcessingExecutorService } from "./media-processing-executor.service.js";
import { MediaProcessingQueueService } from "./media-processing-queue.service.js";

const MAX_LOCAL_SLOTS = 128;
const IDLE_POLL_MS = 1000;

@Injectable()
export class MediaProcessingWorkerService {
  private readonly logger = new Logger(MediaProcessingWorkerService.name);
  private readonly active = new Set<Promise<void>>();
  private stopping = false;

  constructor(
    @Inject(MediaProcessingQueueService) private readonly queue: MediaProcessingQueueService,
    @Inject(MediaProcessingExecutorService) private readonly executor: MediaProcessingExecutorService,
  ) {}

  async run(): Promise<void> {
    this.logger.log(`AYIN media worker pool started on ${hostname()}:${process.pid}.`);
    while (!this.stopping) {
      let claimedAny = false;
      while (!this.stopping && this.active.size < MAX_LOCAL_SLOTS) {
        const workerId = `${hostname()}:${process.pid}:${randomUUID()}`;
        const job = await this.queue.claimNext(workerId);
        if (!job) break;
        claimedAny = true;
        const task = this.executor
          .process(job, workerId)
          .catch((error: unknown) => {
            this.logger.error(
              `Unexpected executor failure for ${job.id}: ${error instanceof Error ? error.message : String(error)}`,
            );
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
    this.logger.log("AYIN media worker pool stopped claiming new jobs.");
  }

  stop(): void {
    this.stopping = true;
  }

  activeCount(): number {
    return this.active.size;
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
