import { Inject, Injectable } from "@nestjs/common";

import { ObservabilityService } from "../observability/observability.service.js";
import { StructuredLoggerService } from "../observability/structured-logger.service.js";
import { AnalyticsRollupService } from "./analytics-rollup.service.js";
import { AnalyticsService } from "./analytics.service.js";

const DEFAULT_INTERVAL_MS = 5 * 60_000;
const MIN_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 60 * 60_000;

function configuredIntervalMs(): number {
  const parsed = Number(process.env.ANALYTICS_ROLLUP_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, Math.trunc(parsed)));
}

@Injectable()
export class AnalyticsRollupWorkerService {
  private stopping = false;

  constructor(
    @Inject(AnalyticsRollupService) private readonly rollups: AnalyticsRollupService,
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
    @Inject(StructuredLoggerService) private readonly logger: StructuredLoggerService,
    @Inject(ObservabilityService) private readonly observability: ObservabilityService,
  ) {}

  async run(): Promise<void> {
    const intervalMs = configuredIntervalMs();
    this.logger.event("info", "analytics_rollup_worker.started", { intervalMs });

    while (!this.stopping) {
      const startedAt = Date.now();
      try {
        const result = await this.rollups.sync();
        const cleanup = await this.rollups.cleanupIfDue((retentionDays) =>
          this.analytics.deleteExpired(retentionDays),
        );
        this.logger.event("info", "analytics_rollup.completed", {
          cutoff: result.cutoff.toISOString(),
          hourlyFrom: result.hourlyRange?.from.toISOString() ?? null,
          hourlyTo: result.hourlyRange?.to.toISOString() ?? null,
          dailyFrom: result.dailyRange?.from.toISOString() ?? null,
          dailyTo: result.dailyRange?.to.toISOString() ?? null,
          retentionDays: result.retentionDays,
          cleanupRan: cleanup.ran,
          rawEventsDeleted: cleanup.deleted,
        });
      } catch (error) {
        this.observability.captureError(error, {
          source: "analytics.rollup_worker",
          path: "/analytics-rollup-worker",
        });
      }

      if (this.stopping) break;
      const remainingMs = Math.max(1_000, intervalMs - (Date.now() - startedAt));
      await sleep(remainingMs);
    }

    this.logger.event("info", "analytics_rollup_worker.stopped");
  }

  stop(): void {
    this.stopping = true;
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
