import { Inject, Injectable } from "@nestjs/common";

import { ObservabilityService } from "../observability/observability.service.js";
import { StructuredLoggerService } from "../observability/structured-logger.service.js";
import { WarehouseExportService } from "./warehouse-export.service.js";

const DEFAULT_INTERVAL_MS = 15 * 60_000;
const MIN_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 24 * 60 * 60_000;

export function configuredWarehouseExportIntervalMs(): number {
  const parsed = Number(process.env.WAREHOUSE_EXPORT_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, Math.trunc(parsed)));
}

@Injectable()
export class WarehouseExportWorkerService {
  private stopping = false;
  private wakeSleep: (() => void) | null = null;

  constructor(
    @Inject(WarehouseExportService) private readonly exports: WarehouseExportService,
    @Inject(StructuredLoggerService) private readonly logger: StructuredLoggerService,
    @Inject(ObservabilityService) private readonly observability: ObservabilityService,
  ) {}

  async run(): Promise<void> {
    const intervalMs = configuredWarehouseExportIntervalMs();
    const capabilities = this.exports.capabilities();
    this.logger.event("info", "warehouse_export_worker.started", {
      intervalMs,
      adapter: capabilities.adapter,
      configured: capabilities.configured,
      patterns: capabilities.patterns,
    });

    while (!this.stopping) {
      const startedAt = Date.now();
      try {
        const result = await this.exports.exportOnce();
        this.logger.event("info", "warehouse_export.completed", {
          configured: result.configured,
          adapter: result.adapter,
          exportedRecords: result.exportedRecords,
          batches: result.batches,
        });
      } catch (error) {
        this.observability.captureError(error, {
          source: "warehouse.export_worker",
          path: "/warehouse-export-worker",
        });
      }

      if (this.stopping) break;
      const remainingMs = Math.max(1_000, intervalMs - (Date.now() - startedAt));
      await this.sleep(remainingMs);
    }

    this.logger.event("info", "warehouse_export_worker.stopped");
  }

  stop(): void {
    this.stopping = true;
    this.wakeSleep?.();
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wakeSleep = null;
        resolve();
      }, milliseconds);
      this.wakeSleep = () => {
        clearTimeout(timer);
        this.wakeSleep = null;
        resolve();
      };
    });
  }
}
