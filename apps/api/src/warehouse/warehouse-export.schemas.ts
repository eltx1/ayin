import { z } from "zod";

export const warehouseDatasetNames = [
  "analytics_facts",
  "content_dimensions",
  "channel_dimensions",
  "ad_facts",
  "revenue_facts",
] as const;

export type WarehouseDatasetName = (typeof warehouseDatasetNames)[number];

export const WAREHOUSE_SCHEMA_VERSION = 1 as const;

const isoDateTime = z.string().datetime({ offset: true });
const nullableIsoDateTime = isoDateTime.nullable();
const uuid = z.string().uuid();
const nullableUuid = uuid.nullable();
const hash64 = z.string().regex(/^[a-f0-9]{64}$/);
const nullableHash64 = hash64.nullable();

export const analyticsFactV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    recordId: uuid,
    eventName: z.string().min(1).max(64),
    occurredAt: isoDateTime,
    receivedAt: isoDateTime,
    sessionHash: hash64,
    profileHash: nullableHash64,
    channelId: nullableUuid,
    videoId: nullableUuid,
    source: z.string().min(1).max(32),
    deviceClass: z.string().min(1).max(24).nullable(),
    durationDeltaMs: z.number().int().min(0).nullable(),
    positionMs: z.number().int().min(0).nullable(),
    countryCode: z.string().regex(/^[A-Z]{2}$/).nullable(),
    trafficSource: z
      .enum(["DIRECT", "INTERNAL", "SEARCH", "SOCIAL", "EXTERNAL"])
      .nullable(),
    protocol: z.enum(["HLS", "MP4"]).nullable(),
  })
  .strict();

export const contentDimensionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    videoId: uuid,
    channelId: uuid,
    contentType: z.string().min(1).max(40),
    videoForm: z.string().min(1).max(40),
    status: z.string().min(1).max(40),
    visibility: z.string().min(1).max(40),
    durationMs: z.number().int().min(0).nullable(),
    scheduledPublishAt: nullableIsoDateTime,
    publishedAt: nullableIsoDateTime,
    removedAt: nullableIsoDateTime,
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .strict();

export const channelDimensionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    channelId: uuid,
    status: z.string().min(1).max(40),
    isPlatformOwned: z.boolean(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    removedAt: nullableIsoDateTime,
  })
  .strict();

export const adFactV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    recordId: uuid,
    placementId: uuid,
    campaignId: nullableUuid,
    creativeId: nullableUuid,
    videoId: nullableUuid,
    profileHash: nullableHash64,
    sessionHash: nullableHash64,
    eventType: z.string().min(1).max(40),
    revenue: z.string().regex(/^-?\d+(?:\.\d+)?$/).nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    occurredAt: isoDateTime,
    createdAt: isoDateTime,
  })
  .strict();

export const revenueFactV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    recordId: uuid,
    channelId: uuid,
    contractId: nullableUuid,
    campaignId: nullableUuid,
    videoId: nullableUuid,
    payoutId: nullableUuid,
    type: z.string().min(1).max(40),
    state: z.string().min(1).max(40),
    grossAmount: z.string().regex(/^-?\d+(?:\.\d+)?$/).nullable(),
    amount: z.string().regex(/^-?\d+(?:\.\d+)?$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    revenueShareBps: z.number().int().min(0).max(10_000).nullable(),
    adSource: z.string().min(1).max(80).nullable(),
    periodStart: nullableIsoDateTime,
    periodEnd: nullableIsoDateTime,
    occurredAt: isoDateTime,
    finalizedAt: nullableIsoDateTime,
    createdAt: isoDateTime,
    sourceUpdatedAt: isoDateTime,
  })
  .strict();

export type AnalyticsFactV1 = z.infer<typeof analyticsFactV1Schema>;
export type ContentDimensionV1 = z.infer<typeof contentDimensionV1Schema>;
export type ChannelDimensionV1 = z.infer<typeof channelDimensionV1Schema>;
export type AdFactV1 = z.infer<typeof adFactV1Schema>;
export type RevenueFactV1 = z.infer<typeof revenueFactV1Schema>;

export interface WarehouseDatasetRecordMap {
  analytics_facts: AnalyticsFactV1;
  content_dimensions: ContentDimensionV1;
  channel_dimensions: ChannelDimensionV1;
  ad_facts: AdFactV1;
  revenue_facts: RevenueFactV1;
}

export function warehouseSchemaFor(dataset: WarehouseDatasetName) {
  switch (dataset) {
    case "analytics_facts":
      return analyticsFactV1Schema;
    case "content_dimensions":
      return contentDimensionV1Schema;
    case "channel_dimensions":
      return channelDimensionV1Schema;
    case "ad_facts":
      return adFactV1Schema;
    case "revenue_facts":
      return revenueFactV1Schema;
  }
}
