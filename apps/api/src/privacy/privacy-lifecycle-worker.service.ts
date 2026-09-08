import { Inject, Injectable } from "@nestjs/common";

import { ObservabilityService } from "../observability/observability.service.js";
import { StructuredLoggerService } from "../observability/structured-logger.service.js";
import { PrivacyLifecycleService } from "./privacy-lifecycle.service.js";

const IDLE_POLL_MS = 2_000;

@Injectable()
export class PrivacyLifecycleWorkerService {
  private stopping = false;

  constructor(
    @Inject(PrivacyLifecycleService) private readonly lifecycle: PrivacyLifecycleService,
    @Inject(StructuredLoggerService) private readonly logger: StructuredLoggerService,
    @Inject(ObservabilityService) private readonly observability: ObservabilityService,
  ) {}

  async run(): Promise<void> {
    this.logger.event("info", "privacy_worker.started");
    while (!this.stopping) {
      try {
        const lifecycleAdvanced = await this.lifecycle.advanceDue();
        const mediaProcessed = await this.lifecycle.processMediaDeletionBatch();
        if (this.stopping) break;
        if (lifecycleAdvanced === 0 && mediaProcessed === 0) await sleep(IDLE_POLL_MS);
        else await yieldToEventLoop();
      } catch (error) {
        this.observability.captureError(error, {
          source: "privacy.worker",
          path: "/privacy-worker",
        });
        if (!this.stopping) await sleep(IDLE_POLL_MS);
      }
    }
    this.logger.event("info", "privacy_worker.stopped");
  }

  stop(): void {
    this.stopping = true;
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
