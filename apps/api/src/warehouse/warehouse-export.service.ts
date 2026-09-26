import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import { DatabaseService } from "../database/database.service.js";
import { analyticsPseudonym } from "../analytics/analytics-identity.js";
import {
  WAREHOUSE_EXPORT_ADAPTER,
  type WarehouseExportAdapter,
  type WarehouseExportBatch,
} from "./warehouse-export.adapter.js";
import {
  WAREHOUSE_SCHEMA_VERSION,
  adFactV1Schema,
  analyticsFactV1Schema,
  channelDimensionV1Schema,
  contentDimensionV1Schema,
  revenueFactV1Schema,
  warehouseDatasetNames,
  type AdFactV1,
  type AnalyticsFactV1,
  type ChannelDimensionV1,
  type ContentDimensionV1,
  type RevenueFactV1,
  type WarehouseDatasetName,
  type WarehouseDatasetRecordMap,
} from "./warehouse-export.schemas.js";

const DEFAULT_PAGE_SIZE = 1_000;
const MIN_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 10_000;

type ExportRecord<TDataset extends WarehouseDatasetName> = {
  cursorAt: Date;
  cursorId: string;
  partitionDate: string;
  record: WarehouseDatasetRecordMap[TDataset];
};

type Checkpoint = {
  cursorAt: Date | null;
  cursorId: string | null;
};

type AnalyticsSourceRow = {
  id: string;
  eventName: string;
  occurredAt: Date;
  receivedAt: Date;
  sessionHash: string;
  profileHash: string | null;
  channelId: string | null;
  videoId: string | null;
  source: string;
  deviceClass: string | null;
  durationDeltaMs: number | null;
  positionMs: number | null;
  metadata: unknown;
};

type ContentSourceRow = {
  id: string;
  channelId: string;
  contentType: string;
  videoForm: string;
  status: string;
  visibility: string;
  durationMs: number | null;
  scheduledPublishAt: Date | null;
  publishedAt: Date | null;
  removedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ChannelSourceRow = {
  id: string;
  status: string;
  isPlatformOwned: boolean;
  createdAt: Date;
  updatedAt: Date;
  removedAt: Date | null;
};

type AdSourceRow = {
  id: string;
  placementId: string;
  campaignId: string | null;
  creativeId: string | null;
  videoId: string | null;
  profileId: string | null;
  sessionId: string | null;
  eventType: string;
  revenue: { toString(): string } | null;
  currency: string | null;
  occurredAt: Date;
  createdAt: Date;
};

type RevenueSourceRow = {
  id: string;
  channelId: string;
  contractId: string | null;
  campaignId: string | null;
  videoId: string | null;
  payoutId: string | null;
  type: string;
  state: string;
  grossAmount: { toString(): string } | string | null;
  amount: { toString(): string } | string;
  currency: string;
  revenueShareBps: number | null;
  adSource: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  occurredAt: Date;
  finalizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export function utcPartitionDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function configuredWarehouseExportPageSize(): number {
  const parsed = Number(process.env.WAREHOUSE_EXPORT_PAGE_SIZE ?? DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_SIZE;
  return Math.max(MIN_PAGE_SIZE, Math.min(MAX_PAGE_SIZE, Math.trunc(parsed)));
}

function safeMetadataValue(
  metadata: unknown,
  key: "countryCode" | "trafficSource" | "protocol",
): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

export function analyticsFactFromSource(row: AnalyticsSourceRow): AnalyticsFactV1 {
  const countryCode = safeMetadataValue(row.metadata, "countryCode");
  const trafficSource = safeMetadataValue(row.metadata, "trafficSource");
  const protocol = safeMetadataValue(row.metadata, "protocol");
  return {
    schemaVersion: 1,
    recordId: row.id,
    eventName: row.eventName,
    occurredAt: row.occurredAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    sessionHash: row.sessionHash,
    profileHash: row.profileHash,
    channelId: row.channelId,
    videoId: row.videoId,
    source: row.source,
    deviceClass: row.deviceClass,
    durationDeltaMs: row.durationDeltaMs,
    positionMs: row.positionMs,
    countryCode: countryCode && /^[A-Z]{2}$/.test(countryCode) ? countryCode : null,
    trafficSource:
      trafficSource &&
      ["DIRECT", "INTERNAL", "SEARCH", "SOCIAL", "EXTERNAL"].includes(trafficSource)
        ? (trafficSource as AnalyticsFactV1["trafficSource"])
        : null,
    protocol: protocol === "HLS" || protocol === "MP4" ? protocol : null,
  };
}

export function contentDimensionFromSource(row: ContentSourceRow): ContentDimensionV1 {
  return {
    schemaVersion: 1,
    videoId: row.id,
    channelId: row.channelId,
    contentType: row.contentType,
    videoForm: row.videoForm,
    status: row.status,
    visibility: row.visibility,
    durationMs: row.durationMs,
    scheduledPublishAt: iso(row.scheduledPublishAt),
    publishedAt: iso(row.publishedAt),
    removedAt: iso(row.removedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function channelDimensionFromSource(row: ChannelSourceRow): ChannelDimensionV1 {
  return {
    schemaVersion: 1,
    channelId: row.id,
    status: row.status,
    isPlatformOwned: row.isPlatformOwned,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    removedAt: iso(row.removedAt),
  };
}

export function adFactFromSource(row: AdSourceRow): AdFactV1 {
  return {
    schemaVersion: 1,
    recordId: row.id,
    placementId: row.placementId,
    campaignId: row.campaignId,
    creativeId: row.creativeId,
    videoId: row.videoId,
    profileHash: row.profileId ? analyticsPseudonym(row.profileId) : null,
    sessionHash: row.sessionId ? analyticsPseudonym(row.sessionId) : null,
    eventType: row.eventType,
    revenue: row.revenue?.toString() ?? null,
    currency: row.currency,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export function revenueFactFromSource(row: RevenueSourceRow): RevenueFactV1 {
  return {
    schemaVersion: 1,
    recordId: row.id,
    channelId: row.channelId,
    contractId: row.contractId,
    campaignId: row.campaignId,
    videoId: row.videoId,
    payoutId: row.payoutId,
    type: row.type,
    state: row.state,
    grossAmount: row.grossAmount?.toString() ?? null,
    amount: row.amount.toString(),
    currency: row.currency,
    revenueShareBps: row.revenueShareBps,
    adSource: row.adSource,
    periodStart: iso(row.periodStart),
    periodEnd: iso(row.periodEnd),
    occurredAt: row.occurredAt.toISOString(),
    finalizedAt: iso(row.finalizedAt),
    createdAt: row.createdAt.toISOString(),
    sourceUpdatedAt: row.updatedAt.toISOString(),
  };
}

export function warehouseBatchId<TDataset extends WarehouseDatasetName>(
  batch: Omit<WarehouseExportBatch<TDataset>, "batchId">,
): string {
  return createHash("sha256").update(JSON.stringify(batch)).digest("hex");
}

@Injectable()
export class WarehouseExportService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WAREHOUSE_EXPORT_ADAPTER) private readonly adapter: WarehouseExportAdapter,
  ) {}

  capabilities() {
    return {
      configured: this.adapter.configured,
      adapter: this.adapter.kind,
      providerNeutral: true as const,
      patterns: [...this.adapter.patterns],
      datasets: warehouseDatasetNames.map((dataset) => ({
        dataset,
        schemaVersion: WAREHOUSE_SCHEMA_VERSION,
      })),
      pageSize: configuredWarehouseExportPageSize(),
    };
  }

  async exportOnce() {
    if (!this.adapter.configured) {
      return {
        configured: false as const,
        adapter: this.adapter.kind,
        exportedRecords: 0,
        batches: 0,
      };
    }

    let exportedRecords = 0;
    let batches = 0;
    const datasets: Array<{
      dataset: WarehouseDatasetName;
      exportedRecords: number;
      batches: number;
    }> = [];

    for (const dataset of warehouseDatasetNames) {
      const result = await this.exportDataset(dataset);
      exportedRecords += result.exportedRecords;
      batches += result.batches;
      datasets.push({ dataset, ...result });
    }

    return {
      configured: true as const,
      adapter: this.adapter.kind,
      exportedRecords,
      batches,
      datasets,
    };
  }

  async exportDataset(dataset: WarehouseDatasetName) {
    if (!this.adapter.configured) {
      return { exportedRecords: 0, batches: 0 };
    }

    const checkpointRow = await this.database.client.warehouseExportCheckpoint.findUnique({
      where: {
        dataset_schemaVersion: {
          dataset,
          schemaVersion: WAREHOUSE_SCHEMA_VERSION,
        },
      },
      select: { cursorAt: true, cursorId: true },
    });
    const checkpoint: Checkpoint = checkpointRow ?? { cursorAt: null, cursorId: null };
    const pageSize = configuredWarehouseExportPageSize();
    const records = await this.readPage(dataset, checkpoint, pageSize);
    if (records.length === 0) return { exportedRecords: 0, batches: 0 };

    const partitions = new Map<string, typeof records>();
    for (const record of records) {
      const existing = partitions.get(record.partitionDate);
      if (existing) existing.push(record);
      else partitions.set(record.partitionDate, [record]);
    }

    let batches = 0;
    let lastBatchId: string | null = null;
    for (const [partitionDate, partitionRecords] of partitions) {
      const last = partitionRecords[partitionRecords.length - 1]!;
      const withoutId = {
        dataset,
        schemaVersion: WAREHOUSE_SCHEMA_VERSION,
        partitionDate,
        cursor: {
          fromAt: checkpoint.cursorAt?.toISOString() ?? null,
          fromId: checkpoint.cursorId,
          throughAt: last.cursorAt.toISOString(),
          throughId: last.cursorId,
        },
        records: partitionRecords.map((item) => item.record),
      } satisfies Omit<WarehouseExportBatch, "batchId">;
      const batch = {
        ...withoutId,
        batchId: warehouseBatchId(withoutId),
      } satisfies WarehouseExportBatch;
      await this.adapter.writeBatch(batch);
      batches += 1;
      lastBatchId = batch.batchId;
    }

    const last = records[records.length - 1]!;
    await this.advanceCheckpoint(dataset, last.cursorAt, last.cursorId, lastBatchId!);
    return { exportedRecords: records.length, batches };
  }

  private async readPage(
    dataset: WarehouseDatasetName,
    checkpoint: Checkpoint,
    take: number,
  ): Promise<Array<ExportRecord<WarehouseDatasetName>>> {
    switch (dataset) {
      case "analytics_facts":
        return this.readAnalytics(checkpoint, take);
      case "content_dimensions":
        return this.readContentDimensions(checkpoint, take);
      case "channel_dimensions":
        return this.readChannelDimensions(checkpoint, take);
      case "ad_facts":
        return this.readAdFacts(checkpoint, take);
      case "revenue_facts":
        return this.readRevenueFacts(checkpoint, take);
    }
  }

  private async readAnalytics(
    checkpoint: Checkpoint,
    take: number,
  ): Promise<Array<ExportRecord<"analytics_facts">>> {
    const rows = (await this.database.client.analyticsEvent.findMany({
      where:
        checkpoint.cursorAt && checkpoint.cursorId
          ? {
              OR: [
                { receivedAt: { gt: checkpoint.cursorAt } },
                { receivedAt: checkpoint.cursorAt, id: { gt: checkpoint.cursorId } },
              ],
            }
          : {},
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
      take,
      select: {
        id: true,
        eventName: true,
        occurredAt: true,
        receivedAt: true,
        sessionHash: true,
        profileHash: true,
        channelId: true,
        videoId: true,
        source: true,
        deviceClass: true,
        durationDeltaMs: true,
        positionMs: true,
        metadata: true,
      },
    })) as AnalyticsSourceRow[];

    return rows.map((row) => {
      const record = analyticsFactV1Schema.parse(analyticsFactFromSource(row));
      return {
        cursorAt: row.receivedAt,
        cursorId: row.id,
        partitionDate: utcPartitionDate(row.occurredAt),
        record,
      };
    });
  }

  private async readContentDimensions(
    checkpoint: Checkpoint,
    take: number,
  ): Promise<Array<ExportRecord<"content_dimensions">>> {
    const rows = (await this.database.client.video.findMany({
      where:
        checkpoint.cursorAt && checkpoint.cursorId
          ? {
              OR: [
                { updatedAt: { gt: checkpoint.cursorAt } },
                { updatedAt: checkpoint.cursorAt, id: { gt: checkpoint.cursorId } },
              ],
            }
          : {},
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take,
      select: {
        id: true,
        channelId: true,
        contentType: true,
        videoForm: true,
        status: true,
        visibility: true,
        durationMs: true,
        scheduledPublishAt: true,
        publishedAt: true,
        removedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })) as unknown as ContentSourceRow[];

    return rows.map((row) => ({
      cursorAt: row.updatedAt,
      cursorId: row.id,
      partitionDate: utcPartitionDate(row.updatedAt),
      record: contentDimensionV1Schema.parse(contentDimensionFromSource(row)),
    }));
  }

  private async readChannelDimensions(
    checkpoint: Checkpoint,
    take: number,
  ): Promise<Array<ExportRecord<"channel_dimensions">>> {
    const rows = (await this.database.client.channel.findMany({
      where:
        checkpoint.cursorAt && checkpoint.cursorId
          ? {
              OR: [
                { updatedAt: { gt: checkpoint.cursorAt } },
                { updatedAt: checkpoint.cursorAt, id: { gt: checkpoint.cursorId } },
              ],
            }
          : {},
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take,
      select: {
        id: true,
        status: true,
        isPlatformOwned: true,
        createdAt: true,
        updatedAt: true,
        removedAt: true,
      },
    })) as unknown as ChannelSourceRow[];

    return rows.map((row) => ({
      cursorAt: row.updatedAt,
      cursorId: row.id,
      partitionDate: utcPartitionDate(row.updatedAt),
      record: channelDimensionV1Schema.parse(channelDimensionFromSource(row)),
    }));
  }

  private async readAdFacts(
    checkpoint: Checkpoint,
    take: number,
  ): Promise<Array<ExportRecord<"ad_facts">>> {
    const rows = (await this.database.client.adEvent.findMany({
      where:
        checkpoint.cursorAt && checkpoint.cursorId
          ? {
              OR: [
                { createdAt: { gt: checkpoint.cursorAt } },
                { createdAt: checkpoint.cursorAt, id: { gt: checkpoint.cursorId } },
              ],
            }
          : {},
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take,
      select: {
        id: true,
        placementId: true,
        campaignId: true,
        creativeId: true,
        videoId: true,
        profileId: true,
        sessionId: true,
        eventType: true,
        revenue: true,
        currency: true,
        occurredAt: true,
        createdAt: true,
      },
    })) as unknown as AdSourceRow[];

    return rows.map((row) => ({
      cursorAt: row.createdAt,
      cursorId: row.id,
      partitionDate: utcPartitionDate(row.occurredAt),
      record: adFactV1Schema.parse(adFactFromSource(row)),
    }));
  }

  private async readRevenueFacts(
    checkpoint: Checkpoint,
    take: number,
  ): Promise<Array<ExportRecord<"revenue_facts">>> {
    const rows = (await this.database.client.earningsLedgerEntry.findMany({
      where:
        checkpoint.cursorAt && checkpoint.cursorId
          ? {
              OR: [
                { updatedAt: { gt: checkpoint.cursorAt } },
                { updatedAt: checkpoint.cursorAt, id: { gt: checkpoint.cursorId } },
              ],
            }
          : {},
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take,
      select: {
        id: true,
        channelId: true,
        contractId: true,
        campaignId: true,
        videoId: true,
        payoutId: true,
        type: true,
        state: true,
        grossAmount: true,
        amount: true,
        currency: true,
        revenueShareBps: true,
        adSource: true,
        periodStart: true,
        periodEnd: true,
        occurredAt: true,
        finalizedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })) as unknown as RevenueSourceRow[];

    return rows.map((row) => ({
      cursorAt: row.updatedAt,
      cursorId: row.id,
      partitionDate: utcPartitionDate(row.occurredAt),
      record: revenueFactV1Schema.parse(revenueFactFromSource(row)),
    }));
  }

  private async advanceCheckpoint(
    dataset: WarehouseDatasetName,
    cursorAt: Date,
    cursorId: string,
    lastBatchId: string,
  ): Promise<void> {
    const succeededAt = new Date();
    await this.database.client.$executeRaw`
      INSERT INTO "WarehouseExportCheckpoint" (
        "dataset", "schemaVersion", "cursorAt", "cursorId",
        "lastBatchId", "lastSucceededAt", "updatedAt"
      )
      VALUES (
        ${dataset}, ${WAREHOUSE_SCHEMA_VERSION}, ${cursorAt}, ${cursorId},
        ${lastBatchId}, ${succeededAt}, ${succeededAt}
      )
      ON CONFLICT ("dataset", "schemaVersion") DO UPDATE SET
        "cursorAt" = EXCLUDED."cursorAt",
        "cursorId" = EXCLUDED."cursorId",
        "lastBatchId" = EXCLUDED."lastBatchId",
        "lastSucceededAt" = GREATEST(
          COALESCE("WarehouseExportCheckpoint"."lastSucceededAt", EXCLUDED."lastSucceededAt"),
          EXCLUDED."lastSucceededAt"
        ),
        "updatedAt" = EXCLUDED."updatedAt"
      WHERE "WarehouseExportCheckpoint"."cursorAt" IS NULL
         OR (
           "WarehouseExportCheckpoint"."cursorAt",
           COALESCE("WarehouseExportCheckpoint"."cursorId", '')
         ) < (
           EXCLUDED."cursorAt",
           COALESCE(EXCLUDED."cursorId", '')
         )
    `;
  }
}
