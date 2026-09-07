import { readFile } from "node:fs/promises";

import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { loadMediaStorageConfig } from "../media/media-storage.config.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";
import { classifyError, type ErrorClass, statusClass } from "./observability-core.js";
import { releaseSha, StructuredLoggerService } from "./structured-logger.service.js";
import {
  TELEMETRY_ADAPTER,
  type TelemetryAdapter,
  type TelemetryAdapterStatus,
} from "./telemetry.adapter.js";

const ACTIVE_MEDIA_STATUSES = ["PROCESSING", "UPLOADING", "VERIFYING"] as const;
const WORKER_HEARTBEAT_MAX_AGE_MS = 30_000;
const METRIC_WINDOW_MS = 60_000;
const MAX_LATENCY_SAMPLES = 1000;

type SafeDetail = string | number | boolean | null;

interface ApiMetricEvent {
  at: number;
  latencyMs: number;
  statusCode: number;
}

@Injectable()
export class ObservabilityService {
  private readonly apiEvents: ApiMetricEvent[] = [];
  private readonly errorCounters = new Map<string, number>();

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
    @Inject(StructuredLoggerService) private readonly logger: StructuredLoggerService,
    @Inject(TELEMETRY_ADAPTER) private readonly telemetry: TelemetryAdapter,
  ) {}

  adapterStatus(): TelemetryAdapterStatus {
    return this.telemetry.status();
  }

  recordRequest(input: {
    method: string;
    path: string;
    statusCode: number;
    latencyMs: number;
  }): void {
    const now = Date.now();
    this.apiEvents.push({ at: now, latencyMs: input.latencyMs, statusCode: input.statusCode });
    this.prune(now);
    if (input.statusCode >= 400) {
      const errorClass = classifyError(null, input.path, input.statusCode);
      this.increment(`http.${errorClass}`);
      if (input.path.startsWith("/media") || input.path.includes("upload"))
        this.increment("media.upload_error");
      if (input.statusCode === 401 || input.statusCode === 403) this.increment("auth.error");
      if (input.path.startsWith("/ads")) this.increment("ads.http_error");
    }
  }

  captureError(
    error: unknown,
    input: {
      path?: string;
      statusCode?: number;
      source: string;
      details?: Record<string, SafeDetail>;
    },
  ): ErrorClass {
    const errorClass = classifyError(error, input.path ?? "", input.statusCode);
    this.increment(`error.${errorClass}`);
    const severity = input.statusCode && input.statusCode < 500 ? "warn" : "error";
    const event = {
      source: input.source,
      errorClass,
      statusCode: input.statusCode ?? null,
      path: input.path ?? null,
      errorName: error instanceof Error ? error.name : typeof error,
      ...(input.details ?? {}),
    };
    this.logger.event(severity, "error.captured", event);
    void Promise.resolve(
      this.telemetry.capture({
        event: "error.captured",
        severity,
        releaseSha: releaseSha(),
        errorClass,
        source: input.source,
        statusCode: input.statusCode ?? null,
        path: input.path ?? null,
      }),
    ).catch(() => {
      this.increment("telemetry.export_error");
    });
    return errorClass;
  }

  async live() {
    return {
      service: "ayin-api",
      status: "alive" as const,
      releaseSha: releaseSha(),
      uptimeSeconds: Math.floor(process.uptime()),
      process: { pid: process.pid, node: process.version },
    };
  }

  async ready() {
    const checks = {
      database: await this.databaseCheck(),
      configuration: this.configurationCheck(),
      worker: await this.workerCheck(),
    };
    const ready =
      checks.database.status === "ok" &&
      checks.configuration.status === "ok" &&
      checks.worker.status !== "unhealthy";
    return {
      service: "ayin-api",
      status: ready ? ("ready" as const) : ("not_ready" as const),
      releaseSha: releaseSha(),
      checks,
    };
  }

  async metricsSnapshot() {
    const now = Date.now();
    this.prune(now);
    const [queueRows, oldestQueued, failed, retries, adErrors] = await Promise.all([
      this.database.client.mediaProcessingJob.groupBy({ by: ["status"], _count: { _all: true } }),
      this.database.client.mediaProcessingJob.findFirst({
        where: { status: "QUEUED" },
        orderBy: { queuedAt: "asc" },
        select: { queuedAt: true },
      }),
      this.database.client.mediaProcessingJob.count({ where: { status: "FAILED" } }),
      this.database.client.mediaProcessingJob.count({ where: { attempt: { gt: 1 } } }),
      this.database.client.analyticsEvent.count({
        where: {
          eventName: "AD_ERROR",
          occurredAt: { gte: new Date(now - 24 * 60 * 60 * 1000) },
        },
      }),
    ]);
    const queueCounts = Object.fromEntries(queueRows.map((row) => [row.status, row._count._all]));
    const activeJobs = ACTIVE_MEDIA_STATUSES.reduce(
      (sum, status) => sum + (queueCounts[status] ?? 0),
      0,
    );
    const statusClasses = { "1xx": 0, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
    for (const event of this.apiEvents) statusClasses[statusClass(event.statusCode)] += 1;
    const latencies = this.apiEvents.map((event) => event.latencyMs).sort((a, b) => a - b);
    return {
      releaseSha: releaseSha(),
      telemetry: this.adapterStatus(),
      api: {
        windowSeconds: METRIC_WINDOW_MS / 1000,
        requests: this.apiEvents.length,
        requestsPerSecond: this.apiEvents.length / (METRIC_WINDOW_MS / 1000),
        statusClasses,
        latencyMs: {
          average: average(latencies),
          p50: percentile(latencies, 0.5),
          p95: percentile(latencies, 0.95),
          max: latencies.at(-1) ?? 0,
        },
      },
      worker: {
        queueDepth: queueCounts.QUEUED ?? 0,
        oldestQueuedAgeSeconds: oldestQueued
          ? Math.max(0, Math.floor((now - oldestQueued.queuedAt.getTime()) / 1000))
          : 0,
        activeJobs,
        failures: failed,
        jobsWithRetries: retries,
      },
      errors: {
        counters: Object.fromEntries(this.errorCounters),
        adIntegrationLast24Hours: adErrors,
      },
    };
  }

  private async databaseCheck() {
    const started = performance.now();
    try {
      await this.database.client.$queryRaw`SELECT 1`;
      return { status: "ok" as const, latencyMs: Math.round(performance.now() - started) };
    } catch (error) {
      this.captureError(error, { source: "health.database" });
      return { status: "unhealthy" as const };
    }
  }

  private configurationCheck() {
    try {
      const environment =
        process.env.APP_ENV === "local"
          ? ({ ...process.env, APP_ENV: "development" } as NodeJS.ProcessEnv)
          : process.env;
      const storage = loadMediaStorageConfig(environment);
      const authSecretOk = (process.env.AUTH_TOKEN_SECRET?.length ?? 0) >= 32;
      const payoutKeyOk = Boolean(process.env.PAYOUT_DATA_ENCRYPTION_KEY);
      if (!authSecretOk || !payoutKeyOk) {
        throw new Error("Critical runtime configuration is invalid.");
      }
      return {
        status: "ok" as const,
        appEnv: process.env.APP_ENV ?? "development",
        mediaStorageMode: storage.mode,
      };
    } catch (error) {
      this.captureError(error, { source: "health.configuration" });
      return { status: "unhealthy" as const };
    }
  }

  private async workerCheck() {
    let enabled = false;
    try {
      enabled = (await this.settings.get("mediaProcessingEnabled")) as boolean;
    } catch {
      return { status: "unknown" as const, reason: "settings_unavailable" };
    }
    if (!enabled) return { status: "disabled" as const };
    const heartbeatPath =
      process.env.MEDIA_WORKER_HEARTBEAT_PATH ?? "/tmp/ayin-media-worker-heartbeat.json";
    try {
      const parsed = JSON.parse(await readFile(heartbeatPath, "utf8")) as {
        heartbeatAt?: string;
        releaseSha?: string;
        activeJobs?: number;
      };
      const heartbeatAt = Date.parse(parsed.heartbeatAt ?? "");
      const ageMs = Number.isFinite(heartbeatAt)
        ? Date.now() - heartbeatAt
        : Number.POSITIVE_INFINITY;
      const currentRelease = releaseSha();
      const releaseMatchesApi =
        currentRelease === "unknown" || parsed.releaseSha === currentRelease;
      const fresh = ageMs >= 0 && ageMs <= WORKER_HEARTBEAT_MAX_AGE_MS;
      const healthy = fresh && (process.env.APP_ENV !== "production" || releaseMatchesApi);
      return {
        status: healthy ? ("ok" as const) : ("unhealthy" as const),
        ageSeconds: Number.isFinite(ageMs) ? Math.max(0, Math.floor(ageMs / 1000)) : null,
        releaseMatchesApi,
        activeJobs: parsed.activeJobs ?? 0,
      };
    } catch {
      return process.env.APP_ENV === "production"
        ? { status: "unhealthy" as const, reason: "heartbeat_missing" }
        : { status: "unknown" as const, reason: "heartbeat_missing" };
    }
  }

  private increment(key: string): void {
    this.errorCounters.set(key, (this.errorCounters.get(key) ?? 0) + 1);
  }

  private prune(now: number): void {
    const threshold = now - METRIC_WINDOW_MS;
    while (this.apiEvents[0]?.at && this.apiEvents[0].at < threshold) this.apiEvents.shift();
    if (this.apiEvents.length > MAX_LATENCY_SAMPLES) {
      this.apiEvents.splice(0, this.apiEvents.length - MAX_LATENCY_SAMPLES);
    }
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1));
  return Math.round((values[index] ?? 0) * 100) / 100;
}
