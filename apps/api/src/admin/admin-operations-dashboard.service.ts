import { readFile } from "node:fs/promises";

import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { MediaProcessingQueueService } from "../media/media-processing-queue.service.js";
import { ObservabilityService } from "../observability/observability.service.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";
import { formatMoneyMicros, parseMoneyMicros } from "../revenue/money.js";
import {
  OPERATIONS_COST_ADAPTER,
  type OperationsCostAdapter,
  type OperationsCostCategory,
} from "./operations-cost.adapter.js";
import {
  evaluateOperationsAlerts,
  formatUnitMicros,
  grossMarginEstimate,
  rateBps,
  type OperationsAlertThresholds,
} from "./operations-dashboard.metrics.js";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;

type CountRow = { count: bigint };
type ProcessingStatsRow = {
  terminalJobs: bigint;
  readyJobs: bigint;
  failedJobs: bigint;
  totalDurationMs: number | null;
  averageDurationMs: number | null;
  p95DurationMs: number | null;
};
type UploadedDurationRow = { uploadedContentMs: bigint };
type HlsReadinessRow = { playableVideos: bigint; hlsReadyVideos: bigint };
type GeneratedStorageRow = { canonicalBytes: bigint; hlsBytes: bigint };
type AdFactsRow = {
  requests: bigint;
  fills: bigint;
  impressions: bigint;
  starts: bigint;
  errors: bigint;
};
type RevenueWindowRow = {
  currency: string;
  estimatedRows: bigint;
  estimatedGrossRows: bigint;
  finalizedRows: bigint;
  finalizedGrossRows: bigint;
  estimatedGross: string;
  finalizedGross: string;
  estimatedCreatorShare: string;
  finalizedCreatorShare: string;
};
type LiabilityRow = { currency: string; amount: string };

interface BackupStatusFile {
  status?: string;
  completedAt?: string;
  stage?: string;
  releaseSha?: string;
  durationSeconds?: number;
}

interface SyntheticStatusFile {
  status?: string;
  completedAt?: string;
  summary?: {
    passed?: number;
    recovered?: number;
    failed?: number;
    skipped?: number;
  };
}

function utcFloorDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0),
  );
}

function rounded(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function bigintToGiB(value: bigint): number {
  return rounded(Number(value / 1024n) / (1024 * 1024), 3);
}

function safeRatio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function costByCategory(
  categories: Array<{ category: OperationsCostCategory; monthlyMicros: bigint }>,
  category: OperationsCostCategory,
): bigint {
  return categories.find((item) => item.category === category)?.monthlyMicros ?? 0n;
}

@Injectable()
export class AdminOperationsDashboardService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MediaProcessingQueueService) private readonly mediaQueue: MediaProcessingQueueService,
    @Inject(ObservabilityService) private readonly observability: ObservabilityService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
    @Inject(OPERATIONS_COST_ADAPTER) private readonly costs: OperationsCostAdapter,
  ) {}

  async snapshot() {
    const generatedAt = new Date();
    const to = utcFloorDay(generatedAt);
    const from = new Date(to.getTime() - WINDOW_DAYS * DAY_MS);
    const latestCompleteDay = new Date(to.getTime() - DAY_MS);

    const [
      product,
      media,
      apiMetrics,
      databaseMetrics,
      queueOverview,
      backup,
      synthetic,
      advertising,
      revenue,
      costSnapshot,
      thresholdValues,
    ] = await Promise.all([
      this.productMetrics(from, to, latestCompleteDay),
      this.mediaMetrics(from, to),
      this.observability.metricsSnapshot(),
      this.database.postgresPerformanceSnapshot(),
      this.mediaQueue.overview(),
      this.backupStatus(generatedAt),
      this.syntheticStatus(),
      this.advertisingMetrics(from, to),
      this.revenueMetrics(from, to),
      this.costs.readMonthlyCosts(to),
      this.settings.getMany([
        "operationsAlertApiP95Ms",
        "operationsAlertApi5xxRateBps",
        "operationsAlertDbConnectionUtilizationBps",
        "operationsAlertMediaQueueAgeSeconds",
        "operationsAlertBackupAgeHours",
      ]),
    ]);

    const api5xx = apiMetrics.api.statusClasses["5xx"] ?? 0;
    const api5xxRateBps = rateBps(api5xx, apiMetrics.api.requests);
    const dbConnectionUtilizationBps =
      databaseMetrics.server.maxConnections && databaseMetrics.server.maxConnections > 0
        ? rateBps(
            databaseMetrics.server.totalConnections,
            databaseMetrics.server.maxConnections,
          )
        : null;

    const thresholds: OperationsAlertThresholds = {
      apiP95Ms: thresholdValues.get("operationsAlertApiP95Ms") as number,
      api5xxRateBps: thresholdValues.get("operationsAlertApi5xxRateBps") as number,
      dbConnectionUtilizationBps: thresholdValues.get(
        "operationsAlertDbConnectionUtilizationBps",
      ) as number,
      mediaQueueAgeSeconds: thresholdValues.get("operationsAlertMediaQueueAgeSeconds") as number,
      backupAgeHours: thresholdValues.get("operationsAlertBackupAgeHours") as number,
    };

    const activeWorkerCount = queueOverview.workers.length;
    const alerts = evaluateOperationsAlerts(
      {
        apiRequests: apiMetrics.api.requests,
        apiP95Ms: apiMetrics.api.latencyMs.p95,
        api5xxRateBps,
        dbConnectionUtilizationBps,
        mediaQueueAgeSeconds: apiMetrics.worker.oldestQueuedAgeSeconds,
        mediaProcessingEnabled: queueOverview.capacity.enabled,
        activeWorkerCount,
        backupAvailable: backup.available,
        backupStatus: backup.status,
        backupAgeHours: backup.ageHours,
        syntheticAvailable: synthetic.available,
        syntheticStatus: synthetic.status,
      },
      thresholds,
    );

    const revenueCurrency = revenue.rows.length === 1 ? revenue.rows[0]!.currency : null;
    const finalizedGrossMicros =
      revenue.rows.length === 1 && revenue.rows[0]!.finalizedGrossComplete
        ? parseMoneyMicros(revenue.rows[0]!.finalizedGross)
        : null;
    const finalizedCreatorShareMicros =
      revenue.rows.length === 1
        ? parseMoneyMicros(revenue.rows[0]!.finalizedCreatorShare)
        : 0n;

    const costModelUsable =
      costSnapshot.mode !== "UNCONFIGURED" && costSnapshot.complete;
    const totalCostMicros = costSnapshot.totalMonthlyMicros;
    const storageCostMicros = costByCategory(costSnapshot.categories, "objectStorage");

    const revenuePerThousandQualifiedPlays =
      finalizedGrossMicros !== null && advertising.qualifiedPlays > 0
        ? formatMoneyMicros(
            (finalizedGrossMicros * 1_000n) / BigInt(advertising.qualifiedPlays),
          )
        : null;

    let processingCostPerUploadedHour: string | null = null;
    if (
      costSnapshot.mode !== "UNCONFIGURED" &&
      costSnapshot.mediaProcessingComputeHourMicros !== null &&
      media.processing.totalDurationMs > 0 &&
      media.uploadedContentHours > 0
    ) {
      const processingHoursScaled = BigInt(
        Math.round((media.processing.totalDurationMs / 3_600_000) * 1_000_000),
      );
      const processingCostMicros =
        (costSnapshot.mediaProcessingComputeHourMicros * processingHoursScaled) / 1_000_000n;
      processingCostPerUploadedHour = formatUnitMicros(
        processingCostMicros,
        media.uploadedContentHours,
      );
    }

    const grossMargin = grossMarginEstimate({
      mode: costSnapshot.mode,
      costsComplete: costSnapshot.complete,
      costCurrency: costSnapshot.currency,
      revenueCurrency,
      finalizedGrossMicros,
      finalizedCreatorShareMicros,
      totalCostMicros,
      grossCoverageComplete:
        revenue.rows.length === 1 && revenue.rows[0]!.finalizedGrossComplete,
    });

    return {
      generatedAt: generatedAt.toISOString(),
      window: {
        days: WINDOW_DAYS,
        from: from.toISOString(),
        to: to.toISOString(),
        timezone: "UTC" as const,
        note: "Product, media, advertising and revenue windows use complete UTC days.",
      },
      product,
      media: {
        ...media,
        queue: {
          globalConcurrencyLimit: queueOverview.capacity.concurrentJobs,
          processingEnabled: queueOverview.capacity.enabled,
          currentActiveJobs: queueOverview.active,
          queueDepth: apiMetrics.worker.queueDepth,
          oldestQueuedAgeSeconds: apiMetrics.worker.oldestQueuedAgeSeconds,
          workers: queueOverview.workers.map((worker) => ({
            id: worker.id,
            hostName: worker.hostName,
            status: worker.status,
            cpuCapacity: worker.cpuCapacity,
            concurrencyLimit: worker.concurrencyLimit,
            activeJobCount: worker.activeJobCount,
            processingVersion: worker.processingVersion,
            releaseSha: worker.releaseSha,
            heartbeatAt: worker.heartbeatAt.toISOString(),
          })),
        },
      },
      infrastructure: {
        api: {
          windowSeconds: apiMetrics.api.windowSeconds,
          requests: apiMetrics.api.requests,
          requestsPerSecond: apiMetrics.api.requestsPerSecond,
          latencyMs: apiMetrics.api.latencyMs,
          statusClasses: apiMetrics.api.statusClasses,
          error5xxRateBps: api5xxRateBps,
        },
        database: {
          status: "OK" as const,
          pool: databaseMetrics.pool,
          server: databaseMetrics.server,
          connectionUtilizationBps: dbConnectionUtilizationBps,
          slowStatements: databaseMetrics.slowStatements,
        },
        workers: {
          activeWorkerCount,
          totalWorkerConcurrency: queueOverview.workers.reduce(
            (total, worker) => total + worker.concurrencyLimit,
            0,
          ),
          activeWorkerJobs: queueOverview.workers.reduce(
            (total, worker) => total + worker.activeJobCount,
            0,
          ),
          globalConcurrencyLimit: queueOverview.capacity.concurrentJobs,
        },
        backup,
        syntheticMonitoring: synthetic,
      },
      advertising,
      revenue,
      cost: {
        provider: costSnapshot.provider,
        mode: costSnapshot.mode,
        currency: costSnapshot.currency,
        complete: costSnapshot.complete,
        note:
          costSnapshot.mode === "UNCONFIGURED"
            ? "No provider invoice is inferred. Configure explicit manual cost inputs or add a future billing adapter."
            : costSnapshot.mode === "MANUAL_ESTIMATE"
              ? "These are operator-entered planning estimates, not provider invoices."
              : "These values are operator-confirmed actual inputs; AYIN still does not fetch provider invoices in Task 87.",
        categories: costSnapshot.categories.map((item) => ({
          category: item.category,
          configured: item.configured,
          monthly: item.configured ? formatMoneyMicros(item.monthlyMicros) : null,
        })),
        totalMonthly: costModelUsable ? formatMoneyMicros(totalCostMicros) : null,
        mediaProcessingComputeHourRate: costSnapshot.mediaProcessingRateConfigured
          ? formatMoneyMicros(costSnapshot.mediaProcessingComputeHourMicros ?? 0n)
          : null,
      },
      unitEconomics: {
        currency: costSnapshot.currency,
        costPerWatchHour:
          costModelUsable && product.watchHours > 0
            ? formatUnitMicros(totalCostMicros, product.watchHours)
            : null,
        storageCostPerActiveVideo:
          costModelUsable && product.activeVideos > 0
            ? formatUnitMicros(storageCostMicros, product.activeVideos)
            : null,
        processingCostPerUploadedHour,
        revenuePerThousandQualifiedPlays: {
          available: revenuePerThousandQualifiedPlays !== null,
          value: revenuePerThousandQualifiedPlays,
          currency: revenueCurrency,
          definition:
            "Finalized gross revenue per 1,000 AdEvent IMPRESSION records in the same complete 30-day UTC window.",
          reason:
            revenuePerThousandQualifiedPlays === null
              ? "Requires one revenue currency, complete finalized gross-revenue coverage, and at least one qualified AdEvent IMPRESSION."
              : null,
        },
        grossMarginEstimate: grossMargin,
      },
      alerts: {
        thresholds,
        items: alerts,
        criticalCount: alerts.filter((item) => item.severity === "CRITICAL").length,
        warningCount: alerts.filter((item) => item.severity === "WARNING").length,
      },
      evidence: {
        productionInvoicesFetched: false,
        replicaDataUsed: false,
        notes: [
          "Revenue and payout liability are ledger-backed.",
          "No-fill is not reported because AYIN has no authoritative explicit no-fill event.",
          "Synthetic monitoring remains external unless an operator mirrors its report to AYIN_SYNTHETIC_STATUS_PATH.",
          "Cost inputs are manual/provider-neutral in Task 87; future billing adapters can implement the same boundary.",
        ],
      },
    };
  }

  private async productMetrics(from: Date, to: Date, latestCompleteDay: Date) {
    const [daily, monthlySessions, totals, activeCreatorRows, activeVideos] = await Promise.all([
      this.database.client.analyticsPlatformDailyRollup.findUnique({
        where: { bucketStart: latestCompleteDay },
        select: { uniqueSessions: true },
      }),
      this.database.client.$queryRawUnsafe<CountRow[]>(
        'SELECT COUNT(DISTINCT "sessionHash")::bigint AS count FROM "AnalyticsPlatformSessionDailyRollup" WHERE "bucketStart" >= $1 AND "bucketStart" < $2',
        from,
        to,
      ),
      this.database.client.analyticsPlatformDailyRollup.aggregate({
        where: { bucketStart: { gte: from, lt: to } },
        _sum: { watchTimeMs: true, uploads: true },
      }),
      this.database.client.$queryRawUnsafe<CountRow[]>(
        'SELECT COUNT(DISTINCT v."channelId")::bigint AS count FROM "Video" v JOIN "Channel" c ON c."id" = v."channelId" WHERE v."createdAt" >= $1 AND v."createdAt" < $2 AND v."status" <> \'REMOVED\' AND c."status" <> \'REMOVED\' AND c."removedAt" IS NULL',
        from,
        to,
      ),
      this.database.client.video.count({
        where: { status: "PUBLISHED", removedAt: null },
      }),
    ]);
    const watchTimeMs = Number(totals._sum.watchTimeMs ?? 0n);
    return {
      dauApprox: daily?.uniqueSessions ?? 0,
      mauApprox: Number(monthlySessions[0]?.count ?? 0n),
      watchTimeMs,
      watchHours: rounded(watchTimeMs / 3_600_000, 2),
      uploads: totals._sum.uploads ?? 0,
      activeCreators: Number(activeCreatorRows[0]?.count ?? 0n),
      activeCreatorsDefinition:
        "Distinct non-removed channels that created a non-removed video during the complete 30-day UTC window.",
      activeVideos,
    };
  }

  private async mediaMetrics(from: Date, to: Date) {
    const [processingRows, uploadRows, hlsRows, storageRows, fallbackTotals] = await Promise.all([
      this.database.client.$queryRawUnsafe<ProcessingStatsRow[]>(
        [
          'SELECT COUNT(*) FILTER (WHERE "status" IN (\'READY\',\'FAILED\',\'CANCELLED\'))::bigint AS "terminalJobs",',
          'COUNT(*) FILTER (WHERE "status" = \'READY\')::bigint AS "readyJobs",',
          'COUNT(*) FILTER (WHERE "status" = \'FAILED\')::bigint AS "failedJobs",',
          'COALESCE(SUM(EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) * 1000) FILTER (WHERE "completedAt" IS NOT NULL AND "startedAt" IS NOT NULL), 0)::double precision AS "totalDurationMs",',
          '(AVG(EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) * 1000) FILTER (WHERE "completedAt" IS NOT NULL AND "startedAt" IS NOT NULL))::double precision AS "averageDurationMs",',
          '(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) * 1000) FILTER (WHERE "completedAt" IS NOT NULL AND "startedAt" IS NOT NULL))::double precision AS "p95DurationMs"',
          'FROM "MediaProcessingJob" WHERE "updatedAt" >= $1 AND "updatedAt" < $2',
        ].join(" "),
        from,
        to,
      ),
      this.database.client.$queryRawUnsafe<UploadedDurationRow[]>(
        'SELECT COALESCE(SUM(v."durationMs"), 0)::bigint AS "uploadedContentMs" FROM "MediaProcessingJob" j JOIN "Video" v ON v."id" = j."videoId" WHERE j."updatedAt" >= $1 AND j."updatedAt" < $2 AND j."status" = \'READY\' AND v."durationMs" IS NOT NULL',
        from,
        to,
      ),
      this.database.client.$queryRawUnsafe<HlsReadinessRow[]>(
        [
          'SELECT COUNT(*)::bigint AS "playableVideos",',
          'COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "MediaPlaybackGeneration" g WHERE g."videoId" = v."id" AND g."status" = \'READY\' AND g."fallbackStatus" = \'READY\' AND g."hlsMasterStatus" = \'READY\' AND EXISTS (SELECT 1 FROM "MediaPlaybackRendition" r WHERE r."playbackGenerationId" = g."id" AND r."status" = \'READY\' AND r."protocol" = \'HLS\')))::bigint AS "hlsReadyVideos"',
          'FROM "Video" v WHERE v."status" = \'PUBLISHED\' AND v."removedAt" IS NULL AND EXISTS (SELECT 1 FROM "MediaAsset" a WHERE a."videoId" = v."id" AND a."kind" = \'SOURCE_VIDEO\' AND a."status" = \'VALIDATED\' AND a."removedAt" IS NULL AND a."mimeType" = \'video/mp4\')',
        ].join(" "),
      ),
      this.database.client.$queryRawUnsafe<GeneratedStorageRow[]>(
        'SELECT COALESCE((SELECT SUM(COALESCE(j."outputSizeBytes", 0)) FROM "MediaProcessingJob" j WHERE j."status" = \'READY\'), 0)::bigint AS "canonicalBytes", COALESCE((SELECT SUM(g."hlsOutputSizeBytes") FROM "MediaPlaybackGeneration" g WHERE g."status" = \'READY\'), 0)::bigint AS "hlsBytes"',
      ),
      this.database.client.analyticsChannelDailyRollup.aggregate({
        where: { bucketStart: { gte: from, lt: to } },
        _sum: { starts: true, mp4FallbackEvents: true },
      }),
    ]);

    const row = processingRows[0];
    const playableVideos = Number(hlsRows[0]?.playableVideos ?? 0n);
    const hlsReadyVideos = Number(hlsRows[0]?.hlsReadyVideos ?? 0n);
    const canonicalBytes = storageRows[0]?.canonicalBytes ?? 0n;
    const hlsBytes = storageRows[0]?.hlsBytes ?? 0n;
    const generatedBytes = canonicalBytes + hlsBytes;
    const starts = fallbackTotals._sum.starts ?? 0;
    const fallbackEvents = fallbackTotals._sum.mp4FallbackEvents ?? 0;
    const totalDurationMs = row?.totalDurationMs ?? 0;
    const uploadedContentMs = Number(uploadRows[0]?.uploadedContentMs ?? 0n);

    return {
      processing: {
        terminalJobs: Number(row?.terminalJobs ?? 0n),
        readyJobs: Number(row?.readyJobs ?? 0n),
        failedJobs: Number(row?.failedJobs ?? 0n),
        failureRate: safeRatio(Number(row?.failedJobs ?? 0n), Number(row?.terminalJobs ?? 0n)),
        totalDurationMs,
        averageDurationMs: rounded(row?.averageDurationMs ?? 0),
        p95DurationMs: rounded(row?.p95DurationMs ?? 0),
      },
      hls: {
        playableVideos,
        readyVideos: hlsReadyVideos,
        readinessRate: safeRatio(hlsReadyVideos, playableVideos),
      },
      mp4Fallback: {
        events: fallbackEvents,
        starts,
        rate: safeRatio(fallbackEvents, starts),
      },
      generatedStorage: {
        canonicalBytes: canonicalBytes.toString(),
        hlsBytes: hlsBytes.toString(),
        totalBytes: generatedBytes.toString(),
        totalGiB: bigintToGiB(generatedBytes),
      },
      uploadedContentHours: rounded(uploadedContentMs / 3_600_000, 2),
    };
  }

  private async advertisingMetrics(from: Date, to: Date) {
    const rows = await this.database.client.$queryRawUnsafe<AdFactsRow[]>(
      [
        'SELECT COUNT(*) FILTER (WHERE "eventType" = \'REQUEST\')::bigint AS requests,',
        'COUNT(*) FILTER (WHERE "eventType" = \'FILL\')::bigint AS fills,',
        'COUNT(*) FILTER (WHERE "eventType" = \'IMPRESSION\')::bigint AS impressions,',
        'COUNT(*) FILTER (WHERE "eventType" = \'START\')::bigint AS starts,',
        'COUNT(*) FILTER (WHERE "eventType" = \'ERROR\')::bigint AS errors',
        'FROM "AdEvent" WHERE "occurredAt" >= $1 AND "occurredAt" < $2',
      ].join(" "),
      from,
      to,
    );
    const row = rows[0];
    const requests = Number(row?.requests ?? 0n);
    const fills = Number(row?.fills ?? 0n);
    const impressions = Number(row?.impressions ?? 0n);
    const starts = Number(row?.starts ?? 0n);
    const errors = Number(row?.errors ?? 0n);
    return {
      requests,
      fills,
      impressions,
      starts,
      qualifiedPlays: impressions,
      technicalErrors: errors,
      fillRate: safeRatio(fills, requests),
      noFill: {
        available: false as const,
        value: null,
        reason:
          "AYIN records REQUEST and FILL events but has no authoritative explicit NO_FILL fact. REQUEST minus FILL is not exposed as no-fill.",
      },
    };
  }

  private async revenueMetrics(from: Date, to: Date) {
    const [rows, liabilityRows] = await Promise.all([
      this.database.client.$queryRawUnsafe<RevenueWindowRow[]>(
        [
          'SELECT "currency",',
          'COUNT(*) FILTER (WHERE "state" = \'ESTIMATED\')::bigint AS "estimatedRows",',
          'COUNT("grossAmount") FILTER (WHERE "state" = \'ESTIMATED\')::bigint AS "estimatedGrossRows",',
          'COUNT(*) FILTER (WHERE "state" IN (\'FINAL\',\'ADJUSTMENT\'))::bigint AS "finalizedRows",',
          'COUNT("grossAmount") FILTER (WHERE "state" IN (\'FINAL\',\'ADJUSTMENT\'))::bigint AS "finalizedGrossRows",',
          'COALESCE(SUM("grossAmount") FILTER (WHERE "state" = \'ESTIMATED\'), 0)::text AS "estimatedGross",',
          'COALESCE(SUM("grossAmount") FILTER (WHERE "state" IN (\'FINAL\',\'ADJUSTMENT\')), 0)::text AS "finalizedGross",',
          'COALESCE(SUM("amount") FILTER (WHERE "state" = \'ESTIMATED\'), 0)::text AS "estimatedCreatorShare",',
          'COALESCE(SUM("amount") FILTER (WHERE "state" IN (\'FINAL\',\'ADJUSTMENT\')), 0)::text AS "finalizedCreatorShare"',
          'FROM "EarningsLedgerEntry" WHERE "occurredAt" >= $1 AND "occurredAt" < $2 GROUP BY "currency" ORDER BY "currency" ASC',
        ].join(" "),
        from,
        to,
      ),
      this.database.client.$queryRawUnsafe<LiabilityRow[]>(
        [
          'WITH unassigned AS (SELECT "currency", COALESCE(SUM("amount"), 0) AS amount FROM "EarningsLedgerEntry" WHERE "state" IN (\'FINAL\',\'ADJUSTMENT\') AND "payoutId" IS NULL GROUP BY "currency"),',
          'in_flight AS (SELECT "currency", COALESCE(SUM("amount"), 0) AS amount FROM "Payout" WHERE "status" IN (\'PENDING\',\'PROCESSING\') GROUP BY "currency")',
          'SELECT COALESCE(u."currency", p."currency") AS "currency", (COALESCE(u.amount, 0) + COALESCE(p.amount, 0))::text AS amount',
          'FROM unassigned u FULL OUTER JOIN in_flight p ON p."currency" = u."currency" ORDER BY COALESCE(u."currency", p."currency") ASC',
        ].join(" "),
      ),
    ]);

    return {
      rows: rows.map((row) => ({
        currency: row.currency,
        estimatedGross: row.estimatedGross,
        estimatedGrossComplete: row.estimatedRows === row.estimatedGrossRows,
        estimatedCreatorShare: row.estimatedCreatorShare,
        finalizedGross: row.finalizedGross,
        finalizedGrossComplete: row.finalizedRows === row.finalizedGrossRows,
        finalizedCreatorShare: row.finalizedCreatorShare,
      })),
      payoutLiability: liabilityRows.map((row) => ({
        currency: row.currency,
        amount: row.amount,
      })),
      note:
        "Gross revenue is shown only from stored grossAmount facts. Creator share uses immutable ledger amount facts. Liability is finalized/adjustment creator share not yet paid, including pending/processing payouts.",
    };
  }

  private async backupStatus(now: Date) {
    const path = process.env.AYIN_BACKUP_STATUS_PATH ?? "/home/ayin/backup-status/latest.json";
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as BackupStatusFile;
      const completedAt = parsed.completedAt ? new Date(parsed.completedAt) : null;
      const validCompletedAt =
        completedAt && Number.isFinite(completedAt.getTime()) ? completedAt : null;
      return {
        available: true as const,
        source: "LOCAL_VERIFIED_BACKUP_STATUS",
        status: parsed.status ?? "unknown",
        completedAt: validCompletedAt?.toISOString() ?? null,
        ageHours: validCompletedAt
          ? rounded(Math.max(0, now.getTime() - validCompletedAt.getTime()) / 3_600_000, 1)
          : null,
        stage: parsed.stage ?? null,
        releaseSha: parsed.releaseSha ?? null,
        durationSeconds: parsed.durationSeconds ?? null,
      };
    } catch {
      return {
        available: false as const,
        source: "LOCAL_VERIFIED_BACKUP_STATUS",
        status: null,
        completedAt: null,
        ageHours: null,
        stage: null,
        releaseSha: null,
        durationSeconds: null,
      };
    }
  }

  private async syntheticStatus() {
    const path = process.env.AYIN_SYNTHETIC_STATUS_PATH?.trim();
    if (!path) {
      return {
        available: false as const,
        source: "EXTERNAL_GITHUB_ACTIONS",
        status: null,
        completedAt: null,
        summary: null,
        reason:
          "Production synthetic monitoring is external. Set AYIN_SYNTHETIC_STATUS_PATH only when a trusted process mirrors the generated report onto the API host.",
      };
    }
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as SyntheticStatusFile;
      return {
        available: true as const,
        source: "MIRRORED_REPORT",
        status: parsed.status ?? "unknown",
        completedAt: parsed.completedAt ?? null,
        summary: parsed.summary ?? null,
        reason: null,
      };
    } catch {
      return {
        available: false as const,
        source: "MIRRORED_REPORT",
        status: null,
        completedAt: null,
        summary: null,
        reason: "The configured synthetic report path is missing or invalid.",
      };
    }
  }
}
