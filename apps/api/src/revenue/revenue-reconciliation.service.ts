import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import { DatabaseService } from "../database/database.service.js";
import { selectEffectiveContract } from "./contract-selection.js";
import { applyRevenueShareMicros, formatMoneyMicros, parseMoneyMicros } from "./money.js";
import {
  buildLedgerEffects,
  buildReconciliationLedgerKey,
  classifyReconciliation,
  type ReconciliationSnapshot,
  type ReconciliationStatus,
} from "./revenue-reconciliation.logic.js";
import { revenueReconciliationReportQuerySchema } from "./revenue-reconciliation.schemas.js";
import {
  REVENUE_REPORTING_ADAPTER,
  type NormalizedRevenueReport,
  type RevenueReportingAdapter,
} from "./revenue-reporting.adapter.js";

type Tx = Prisma.TransactionClient;

interface ReportRecord {
  id: string;
  source: string;
  sourceReportId: string;
  periodStart: Date;
  periodEnd: Date;
  currency: string;
  state: string;
  importFormat: string;
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  duplicateRows: number;
  correctedRows: number;
  finalizedRows: number;
  anomalousRows: number;
  createdAt: Date;
}

interface RowRecord {
  id: string;
  reportId: string;
  rowNumber: number;
  source: string;
  externalRowId: string;
  channelRef: string | null;
  videoRef: string | null;
  contentRef: string | null;
  channelId: string | null;
  videoId: string | null;
  grossAmount: unknown;
  creatorAmount: unknown | null;
  currency: string;
  state: string;
  reconciliationStatus: string;
  ledgerEntryId: string | null;
  priorRowId: string | null;
  reason: string | null;
  memo: string | null;
  createdAt: Date;
}

interface ResolvedAttribution {
  kind: "RESOLVED";
  channelId: string;
  videoId: string | null;
}

interface FailedAttribution {
  kind: "UNMATCHED" | "ANOMALOUS";
  channelId: string | null;
  videoId: string | null;
  reason: string;
}

type AttributionResult = ResolvedAttribution | FailedAttribution;

const SUCCESSFUL_STATUSES = ["MATCHED", "CORRECTED", "FINALIZED"] as const;

@Injectable()
export class RevenueReconciliationService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
    @Inject(REVENUE_REPORTING_ADAPTER) private readonly adapter: RevenueReportingAdapter,
  ) {}

  capabilities() {
    return this.adapter.capabilities();
  }

  async importReport(actorAccountId: string, input: unknown) {
    const report = this.adapter.normalize(input);
    const existing = await this.findReport(report.source, report.sourceReportId);
    if (existing) return { ...this.serializeReport(existing), idempotentReplay: true };

    try {
      return await this.database.client.$transaction(async (tx) => {
        const concurrent = await tx.revenueSourceReport.findUnique({
          where: {
            source_sourceReportId: {
              source: report.source,
              sourceReportId: report.sourceReportId,
            },
          },
        });
        if (concurrent) {
          return { ...this.serializeReport(concurrent), idempotentReplay: true };
        }

        const created = await tx.revenueSourceReport.create({
          data: {
            source: report.source,
            sourceReportId: report.sourceReportId,
            periodStart: report.periodStart,
            periodEnd: report.periodEnd,
            currency: report.currency,
            state: report.state,
            importFormat: report.format,
            importedByAccountId: actorAccountId,
            totalRows: report.rows.length,
          },
        });

        const counters = {
          matchedRows: 0,
          unmatchedRows: 0,
          duplicateRows: 0,
          correctedRows: 0,
          finalizedRows: 0,
          anomalousRows: 0,
        };
        const seenExternalRows = new Set<string>();

        for (const [index, row] of report.rows.entries()) {
          const rowNumber = index + 1;
          if (seenExternalRows.has(row.externalRowId)) {
            counters.duplicateRows += 1;
            await this.createSourceRow(tx, {
              reportId: created.id,
              rowNumber,
              report,
              row,
              status: "DUPLICATE",
              reason: "Duplicate externalRowId within the same source report.",
              channelId: null,
              videoId: null,
              creatorMicros: null,
              ledgerEntryId: null,
              priorRowId: null,
            });
            continue;
          }
          seenExternalRows.add(row.externalRowId);

          const attribution = await this.resolveAttribution(tx, row);
          if (attribution.kind !== "RESOLVED") {
            this.incrementCounter(counters, attribution.kind);
            await this.createSourceRow(tx, {
              reportId: created.id,
              rowNumber,
              report,
              row,
              status: attribution.kind,
              reason: attribution.reason,
              channelId: attribution.channelId,
              videoId: attribution.videoId,
              creatorMicros: null,
              ledgerEntryId: null,
              priorRowId: null,
            });
            continue;
          }

          const contract = await this.resolveContract(tx, attribution.channelId, report.periodEnd);
          const grossMicros = parseMoneyMicros(row.grossAmount);
          const creatorMicros = applyRevenueShareMicros(grossMicros, contract.revenueShareBps);
          const current = this.snapshot({
            report,
            channelId: attribution.channelId,
            videoId: attribution.videoId,
            grossMicros,
            creatorMicros,
          });
          const previous = await tx.revenueSourceReportRow.findFirst({
            where: {
              source: report.source,
              externalRowId: row.externalRowId,
              reconciliationStatus: { in: [...SUCCESSFUL_STATUSES] },
            },
            include: {
              report: {
                select: { periodStart: true, periodEnd: true, currency: true },
              },
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          });

          if (
            previous &&
            (previous.channelId === null ||
              previous.creatorAmount === null ||
              (previous.state !== "ESTIMATED" && previous.state !== "FINAL"))
          ) {
            counters.anomalousRows += 1;
            await this.createSourceRow(tx, {
              reportId: created.id,
              rowNumber,
              report,
              row,
              status: "ANOMALOUS",
              reason: "Prior successful reconciliation row is incomplete and requires review.",
              channelId: attribution.channelId,
              videoId: attribution.videoId,
              creatorMicros,
              ledgerEntryId: null,
              priorRowId: previous.id,
            });
            continue;
          }

          const previousSnapshot = previous
            ? this.snapshot({
                report: {
                  ...report,
                  periodStart: previous.report.periodStart,
                  periodEnd: previous.report.periodEnd,
                  currency: previous.report.currency,
                  state: previous.state,
                },
                channelId: previous.channelId!,
                videoId: previous.videoId,
                grossMicros: parseMoneyMicros(String(previous.grossAmount)),
                creatorMicros: parseMoneyMicros(String(previous.creatorAmount)),
              })
            : null;

          const classification = classifyReconciliation(previousSnapshot, current);
          this.incrementCounter(counters, classification.status);

          const effects = buildLedgerEffects(classification.status, current, previousSnapshot);
          let primaryLedgerEntryId: string | null = null;
          for (const effect of effects) {
            const entry = await tx.earningsLedgerEntry.create({
              data: {
                channelId: attribution.channelId,
                ...(contract.contractId ? { contractId: contract.contractId } : {}),
                ...(attribution.videoId ? { videoId: attribution.videoId } : {}),
                type: effect.type,
                state: effect.state,
                grossAmount: formatMoneyMicros(effect.grossMicros),
                amount: formatMoneyMicros(effect.creatorMicros),
                currency: report.currency,
                revenueShareBps: contract.revenueShareBps,
                idempotencyKey: buildReconciliationLedgerKey({
                  source: report.source,
                  sourceReportId: report.sourceReportId,
                  externalRowId: row.externalRowId,
                  effect: effect.key,
                }),
                adSource: row.adSource ?? report.source,
                periodStart: report.periodStart,
                periodEnd: report.periodEnd,
                occurredAt: report.periodEnd,
                ...(effect.finalized ? { finalizedAt: new Date() } : {}),
                memo: this.ledgerMemo(row.externalRowId, classification.status, row.memo),
              },
              select: { id: true },
            });
            if (effect.primary) primaryLedgerEntryId = entry.id;
          }

          await this.createSourceRow(tx, {
            reportId: created.id,
            rowNumber,
            report,
            row,
            status: classification.status,
            reason: classification.reason,
            channelId: attribution.channelId,
            videoId: attribution.videoId,
            creatorMicros,
            ledgerEntryId: primaryLedgerEntryId,
            priorRowId: previous?.id ?? null,
          });
        }

        const completed = await tx.revenueSourceReport.update({
          where: { id: created.id },
          data: counters,
        });

        await this.audit.recordInTransaction(tx, {
          actorAccountId,
          action: "REVENUE_REPORT_RECONCILED",
          entityType: "RevenueSourceReport",
          entityId: completed.id,
          metadata: {
            source: completed.source,
            sourceReportId: completed.sourceReportId,
            totalRows: completed.totalRows,
            ...counters,
            automaticProviderSyncConfigured: false,
          },
        });

        return { ...this.serializeReport(completed), idempotentReplay: false };
      });
    } catch (error) {
      const replay = await this.findReport(report.source, report.sourceReportId);
      if (replay) return { ...this.serializeReport(replay), idempotentReplay: true };
      throw error;
    }
  }

  async listReports(query: unknown) {
    const parsed = revenueReconciliationReportQuerySchema.parse(query);
    const where: Prisma.RevenueSourceReportWhereInput = {
      ...(parsed.source ? { source: parsed.source } : {}),
      ...(parsed.status ? { rows: { some: { reconciliationStatus: parsed.status } } } : {}),
    };
    const [total, items] = await Promise.all([
      this.database.client.revenueSourceReport.count({ where }),
      this.database.client.revenueSourceReport.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (parsed.page - 1) * parsed.take,
        take: parsed.take,
      }),
    ]);
    return {
      items: items.map((item) => this.serializeReport(item)),
      pagination: {
        total,
        page: parsed.page,
        take: parsed.take,
        pages: Math.max(1, Math.ceil(total / parsed.take)),
      },
    };
  }

  async getReport(reportId: string) {
    const report = await this.database.client.revenueSourceReport.findUniqueOrThrow({
      where: { id: reportId },
      include: { rows: { orderBy: [{ rowNumber: "asc" }] } },
    });
    return {
      ...this.serializeReport(report),
      rows: report.rows.map((row) => this.serializeRow(row)),
    };
  }

  private async findReport(source: string, sourceReportId: string) {
    return this.database.client.revenueSourceReport.findUnique({
      where: { source_sourceReportId: { source, sourceReportId } },
    });
  }

  private async resolveAttribution(
    tx: Tx,
    row: NormalizedRevenueReport["rows"][number],
  ): Promise<AttributionResult> {
    const channelRefSupplied = Boolean(row.channelId || row.channelHandle);
    const videoRefSupplied = Boolean(row.videoId || row.videoSlug);

    const channel = row.channelId
      ? await tx.channel.findUnique({ where: { id: row.channelId }, select: { id: true } })
      : row.channelHandle
        ? await tx.channel.findUnique({
            where: { handle: row.channelHandle },
            select: { id: true },
          })
        : null;
    if (channelRefSupplied && !channel) {
      return {
        kind: "UNMATCHED",
        channelId: null,
        videoId: null,
        reason: "Supplied channel attribution could not be resolved.",
      };
    }

    const video = row.videoId
      ? await tx.video.findUnique({
          where: { id: row.videoId },
          select: { id: true, channelId: true },
        })
      : row.videoSlug
        ? await tx.video.findUnique({
            where: { slug: row.videoSlug },
            select: { id: true, channelId: true },
          })
        : null;
    if (videoRefSupplied && !video) {
      return {
        kind: "UNMATCHED",
        channelId: channel?.id ?? null,
        videoId: null,
        reason: "Supplied video attribution could not be resolved.",
      };
    }

    if (channel && video && channel.id !== video.channelId) {
      return {
        kind: "ANOMALOUS",
        channelId: channel.id,
        videoId: video.id,
        reason: "Resolved video belongs to a different channel than the supplied channel.",
      };
    }

    const resolvedChannelId = channel?.id ?? video?.channelId ?? null;
    if (!resolvedChannelId) {
      return {
        kind: "UNMATCHED",
        channelId: null,
        videoId: video?.id ?? null,
        reason: row.contentId
          ? "External content attribution has no resolvable AYIN channel or video."
          : "Row does not contain resolvable AYIN channel or video attribution.",
      };
    }

    return {
      kind: "RESOLVED",
      channelId: resolvedChannelId,
      videoId: video?.id ?? null,
    };
  }

  private async resolveContract(tx: Tx, channelId: string, at: Date) {
    const [contracts, defaultRow] = await Promise.all([
      tx.creatorContract.findMany({
        where: {
          channelId,
          status: "ACTIVE",
          OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: at } }],
          AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] }],
        },
        orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      }),
      tx.platformSetting.findUnique({
        where: {
          namespace_key: {
            namespace: "MONETIZATION",
            key: "defaultCreatorRevenueShareBps",
          },
        },
        select: { value: true },
      }),
    ]);
    const selected = selectEffectiveContract(contracts, at);
    const rawDefault = defaultRow?.value;
    const defaultBps =
      typeof rawDefault === "number" && Number.isInteger(rawDefault)
        ? Math.max(0, Math.min(10_000, rawDefault))
        : 0;
    return selected
      ? { contractId: selected.id, revenueShareBps: selected.revenueShareBps as number }
      : { contractId: null, revenueShareBps: defaultBps };
  }

  private snapshot(input: {
    report: Pick<NormalizedRevenueReport, "state" | "currency" | "periodStart" | "periodEnd">;
    channelId: string;
    videoId: string | null;
    grossMicros: bigint;
    creatorMicros: bigint;
  }): ReconciliationSnapshot {
    return {
      state: input.report.state,
      currency: input.report.currency,
      periodStart: input.report.periodStart.toISOString(),
      periodEnd: input.report.periodEnd.toISOString(),
      channelId: input.channelId,
      videoId: input.videoId,
      grossMicros: input.grossMicros,
      creatorMicros: input.creatorMicros,
    };
  }

  private async createSourceRow(
    tx: Tx,
    input: {
      reportId: string;
      rowNumber: number;
      report: NormalizedRevenueReport;
      row: NormalizedRevenueReport["rows"][number];
      status: ReconciliationStatus;
      reason: string;
      channelId: string | null;
      videoId: string | null;
      creatorMicros: bigint | null;
      ledgerEntryId: string | null;
      priorRowId: string | null;
    },
  ) {
    return tx.revenueSourceReportRow.create({
      data: {
        reportId: input.reportId,
        rowNumber: input.rowNumber,
        source: input.report.source,
        externalRowId: input.row.externalRowId,
        channelRef: input.row.channelId ?? input.row.channelHandle ?? null,
        videoRef: input.row.videoId ?? input.row.videoSlug ?? null,
        contentRef: input.row.contentId ?? null,
        channelId: input.channelId,
        videoId: input.videoId,
        grossAmount: formatMoneyMicros(parseMoneyMicros(input.row.grossAmount)),
        ...(input.creatorMicros !== null
          ? { creatorAmount: formatMoneyMicros(input.creatorMicros) }
          : {}),
        currency: input.report.currency,
        state: input.report.state,
        reconciliationStatus: input.status,
        ledgerEntryId: input.ledgerEntryId,
        priorRowId: input.priorRowId,
        reason: input.reason.slice(0, 500),
        memo: input.row.memo ?? null,
      },
    });
  }

  private incrementCounter(
    counters: {
      matchedRows: number;
      unmatchedRows: number;
      duplicateRows: number;
      correctedRows: number;
      finalizedRows: number;
      anomalousRows: number;
    },
    status: ReconciliationStatus | "UNMATCHED" | "ANOMALOUS",
  ) {
    if (status === "MATCHED") counters.matchedRows += 1;
    else if (status === "UNMATCHED") counters.unmatchedRows += 1;
    else if (status === "DUPLICATE") counters.duplicateRows += 1;
    else if (status === "CORRECTED") counters.correctedRows += 1;
    else if (status === "FINALIZED") counters.finalizedRows += 1;
    else counters.anomalousRows += 1;
  }

  private ledgerMemo(externalRowId: string, status: ReconciliationStatus, memo?: string) {
    const prefix = `Revenue reconciliation ${status.toLowerCase()} for source row ${externalRowId}.`;
    return (memo ? `${prefix} ${memo}` : prefix).slice(0, 500);
  }

  private serializeReport(report: ReportRecord) {
    return {
      id: report.id,
      source: report.source,
      sourceReportId: report.sourceReportId,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      currency: report.currency,
      state: report.state,
      importFormat: report.importFormat,
      totalRows: report.totalRows,
      matchedRows: report.matchedRows,
      unmatchedRows: report.unmatchedRows,
      duplicateRows: report.duplicateRows,
      correctedRows: report.correctedRows,
      finalizedRows: report.finalizedRows,
      anomalousRows: report.anomalousRows,
      createdAt: report.createdAt,
    };
  }

  private serializeRow(row: RowRecord) {
    return {
      ...row,
      grossAmount: String(row.grossAmount),
      creatorAmount: row.creatorAmount === null ? null : String(row.creatorAmount),
    };
  }
}
