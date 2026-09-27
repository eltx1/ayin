import { formatMoneyMicros } from "../revenue/money.js";
import type { OperationsCostMode } from "./operations-cost.adapter.js";

export interface OperationsAlertThresholds {
  apiP95Ms: number;
  api5xxRateBps: number;
  dbConnectionUtilizationBps: number;
  mediaQueueAgeSeconds: number;
  backupAgeHours: number;
}

export interface OperationsAlertInput {
  apiRequests: number;
  apiP95Ms: number;
  api5xxRateBps: number;
  dbConnectionUtilizationBps: number | null;
  mediaQueueAgeSeconds: number;
  mediaProcessingEnabled: boolean;
  activeWorkerCount: number;
  backupAvailable: boolean;
  backupStatus: string | null;
  backupAgeHours: number | null;
  syntheticAvailable: boolean;
  syntheticStatus: string | null;
}

export interface OperationsAlert {
  severity: "CRITICAL" | "WARNING";
  code: string;
  message: string;
  observed: number | string | null;
  threshold: number | string | null;
}

export function rateBps(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.max(0, Math.round((numerator / denominator) * 10_000));
}

export function formatUnitMicros(totalMicros: bigint, units: number): string | null {
  if (!Number.isFinite(units) || units <= 0) return null;
  const scaledUnits = BigInt(Math.max(1, Math.round(units * 1_000_000)));
  return formatMoneyMicros((totalMicros * 1_000_000n) / scaledUnits);
}

export function grossMarginEstimate(input: {
  mode: OperationsCostMode;
  costsComplete: boolean;
  costCurrency: string;
  revenueCurrency: string | null;
  finalizedGrossMicros: bigint | null;
  finalizedCreatorShareMicros: bigint;
  totalCostMicros: bigint;
  grossCoverageComplete: boolean;
}) {
  const available =
    input.mode === "MANUAL_ACTUAL" &&
    input.costsComplete &&
    input.revenueCurrency !== null &&
    input.revenueCurrency === input.costCurrency &&
    input.finalizedGrossMicros !== null &&
    input.grossCoverageComplete;

  if (!available) {
    return {
      available: false as const,
      amount: null,
      rate: null,
      reason:
        "Gross margin requires operator-confirmed actual costs, complete cost categories, one matching revenue currency, and complete finalized gross-revenue coverage.",
    };
  }

  const gross = input.finalizedGrossMicros!;
  const margin = gross - input.finalizedCreatorShareMicros - input.totalCostMicros;
  return {
    available: true as const,
    amount: formatMoneyMicros(margin),
    rate: gross !== 0n ? Number(margin) / Number(gross) : null,
    reason: null,
  };
}

export function evaluateOperationsAlerts(
  input: OperationsAlertInput,
  thresholds: OperationsAlertThresholds,
): OperationsAlert[] {
  const alerts: OperationsAlert[] = [];

  if (input.apiRequests > 0 && input.apiP95Ms >= thresholds.apiP95Ms) {
    alerts.push({
      severity: "CRITICAL",
      code: "API_P95_HIGH",
      message: "API p95 latency is at or above the configured danger threshold.",
      observed: input.apiP95Ms,
      threshold: thresholds.apiP95Ms,
    });
  }
  if (input.apiRequests > 0 && input.api5xxRateBps >= thresholds.api5xxRateBps) {
    alerts.push({
      severity: "CRITICAL",
      code: "API_5XX_RATE_HIGH",
      message: "API 5xx error rate is at or above the configured danger threshold.",
      observed: input.api5xxRateBps,
      threshold: thresholds.api5xxRateBps,
    });
  }
  if (
    input.dbConnectionUtilizationBps !== null &&
    input.dbConnectionUtilizationBps >= thresholds.dbConnectionUtilizationBps
  ) {
    alerts.push({
      severity: "CRITICAL",
      code: "DB_CONNECTION_PRESSURE",
      message: "AYIN PostgreSQL connection utilization is at or above the configured threshold.",
      observed: input.dbConnectionUtilizationBps,
      threshold: thresholds.dbConnectionUtilizationBps,
    });
  }
  if (input.mediaQueueAgeSeconds >= thresholds.mediaQueueAgeSeconds) {
    alerts.push({
      severity: "CRITICAL",
      code: "MEDIA_QUEUE_AGE_HIGH",
      message: "The oldest media job has exceeded the configured queue-age threshold.",
      observed: input.mediaQueueAgeSeconds,
      threshold: thresholds.mediaQueueAgeSeconds,
    });
  }
  if (input.mediaProcessingEnabled && input.activeWorkerCount === 0) {
    alerts.push({
      severity: "CRITICAL",
      code: "MEDIA_WORKERS_UNAVAILABLE",
      message: "Media processing is enabled but no fresh worker is registered.",
      observed: 0,
      threshold: 1,
    });
  }
  if (input.backupAvailable && input.backupStatus === "failure") {
    alerts.push({
      severity: "CRITICAL",
      code: "BACKUP_FAILED",
      message: "The latest PostgreSQL backup status reports failure.",
      observed: input.backupStatus,
      threshold: "success",
    });
  } else if (
    input.backupAvailable &&
    input.backupAgeHours !== null &&
    input.backupAgeHours >= thresholds.backupAgeHours
  ) {
    alerts.push({
      severity: "CRITICAL",
      code: "BACKUP_STALE",
      message: "The latest PostgreSQL backup status is older than the configured threshold.",
      observed: Math.round(input.backupAgeHours * 10) / 10,
      threshold: thresholds.backupAgeHours,
    });
  } else if (!input.backupAvailable) {
    alerts.push({
      severity: "WARNING",
      code: "BACKUP_STATUS_UNAVAILABLE",
      message: "The runtime backup status file is not available to this API process.",
      observed: null,
      threshold: null,
    });
  }

  if (input.syntheticAvailable && input.syntheticStatus === "failed") {
    alerts.push({
      severity: "CRITICAL",
      code: "SYNTHETIC_MONITORING_FAILED",
      message: "The latest configured synthetic monitoring report contains confirmed failures.",
      observed: input.syntheticStatus,
      threshold: "passed",
    });
  } else if (!input.syntheticAvailable) {
    alerts.push({
      severity: "WARNING",
      code: "SYNTHETIC_STATUS_EXTERNAL",
      message:
        "Production synthetic monitoring runs externally; no local report path is configured for dashboard ingestion.",
      observed: null,
      threshold: null,
    });
  }

  return alerts;
}
