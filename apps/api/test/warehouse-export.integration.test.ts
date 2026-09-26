import { randomUUID } from "node:crypto";

import { createPrismaClient } from "@ayin/db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  WarehouseExportAdapter,
  WarehouseExportBatch,
  WarehouseExportReceipt,
} from "../src/warehouse/warehouse-export.adapter.js";
import { WarehouseExportService } from "../src/warehouse/warehouse-export.service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

class CollectingWarehouseAdapter implements WarehouseExportAdapter {
  readonly kind = "FIXTURE_OBJECT_BATCH";
  readonly configured = true;
  readonly patterns = ["OBJECT_BATCH"] as const;
  readonly batches: WarehouseExportBatch[] = [];

  async writeBatch(batch: WarehouseExportBatch): Promise<WarehouseExportReceipt> {
    this.batches.push(batch);
    return { batchId: batch.batchId, accepted: true, providerReceipt: null };
  }
}

databaseDescribe("Task 84 warehouse boundary integration", () => {
  const prisma = createPrismaClient(databaseUrl);
  let previousPageSize: string | undefined;

  beforeEach(async () => {
    previousPageSize = process.env.WAREHOUSE_EXPORT_PAGE_SIZE;
    process.env.WAREHOUSE_EXPORT_PAGE_SIZE = "10";
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "WarehouseExportCheckpoint",
        "AnalyticsEvent",
        "EarningsLedgerEntry",
        "Channel"
      CASCADE
    `);
  });

  afterEach(() => {
    if (previousPageSize === undefined) delete process.env.WAREHOUSE_EXPORT_PAGE_SIZE;
    else process.env.WAREHOUSE_EXPORT_PAGE_SIZE = previousPageSize;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("advances analytics checkpoints incrementally and exports late arrivals by receivedAt", async () => {
    const adapter = new CollectingWarehouseAdapter();
    const service = new WarehouseExportService({ client: prisma } as never, adapter);
    const firstReceivedAt = new Date("2026-09-01T10:00:01.000Z");
    const secondReceivedAt = new Date("2026-09-01T10:00:02.000Z");

    const firstId = "11111111-1111-4111-8111-111111111111";
    const secondId = "22222222-2222-4222-8222-222222222222";
    await prisma.analyticsEvent.createMany({
      data: [
        {
          id: firstId,
          clientEventId: randomUUID(),
          schemaVersion: 1,
          eventName: "VIDEO_START",
          occurredAt: new Date("2026-09-01T09:00:00.000Z"),
          receivedAt: firstReceivedAt,
          sessionHash: "a".repeat(64),
          source: "WEB",
        },
        {
          id: secondId,
          clientEventId: randomUUID(),
          schemaVersion: 1,
          eventName: "VIDEO_COMPLETE",
          occurredAt: new Date("2026-09-01T09:05:00.000Z"),
          receivedAt: secondReceivedAt,
          sessionHash: "b".repeat(64),
          source: "WEB",
        },
      ],
    });

    await expect(service.exportDataset("analytics_facts")).resolves.toEqual({
      exportedRecords: 2,
      batches: 1,
    });
    const firstCheckpoint = await prisma.warehouseExportCheckpoint.findUniqueOrThrow({
      where: { dataset_schemaVersion: { dataset: "analytics_facts", schemaVersion: 1 } },
    });
    expect(firstCheckpoint.cursorAt).toEqual(secondReceivedAt);
    expect(firstCheckpoint.cursorId).toBe(secondId);

    const lateId = "33333333-3333-4333-8333-333333333333";
    const lateReceivedAt = new Date("2026-09-01T11:00:00.000Z");
    await prisma.analyticsEvent.create({
      data: {
        id: lateId,
        clientEventId: randomUUID(),
        schemaVersion: 1,
        eventName: "VIDEO_START",
        occurredAt: new Date("2026-08-15T12:00:00.000Z"),
        receivedAt: lateReceivedAt,
        sessionHash: "c".repeat(64),
        source: "WEB",
      },
    });

    await expect(service.exportDataset("analytics_facts")).resolves.toEqual({
      exportedRecords: 1,
      batches: 1,
    });
    expect(adapter.batches.at(-1)?.records[0]).toMatchObject({
      recordId: lateId,
      occurredAt: "2026-08-15T12:00:00.000Z",
      receivedAt: lateReceivedAt.toISOString(),
    });
    const lateCheckpoint = await prisma.warehouseExportCheckpoint.findUniqueOrThrow({
      where: { dataset_schemaVersion: { dataset: "analytics_facts", schemaVersion: 1 } },
    });
    expect(lateCheckpoint.cursorAt).toEqual(lateReceivedAt);
    expect(lateCheckpoint.cursorId).toBe(lateId);
  });

  it("re-exports a revenue fact after a ledger update using updatedAt as the source version", async () => {
    const channel = await prisma.channel.create({
      data: { handle: `warehouse-${randomUUID().slice(0, 8)}`, name: "Warehouse fixture" },
    });
    const createdAt = new Date("2026-09-02T01:00:00.000Z");
    const entry = await prisma.earningsLedgerEntry.create({
      data: {
        channelId: channel.id,
        type: "AD_REVENUE",
        state: "ESTIMATED",
        amount: "7.000000",
        grossAmount: "10.000000",
        currency: "USD",
        occurredAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      },
    });
    const adapter = new CollectingWarehouseAdapter();
    const service = new WarehouseExportService({ client: prisma } as never, adapter);

    await expect(service.exportDataset("revenue_facts")).resolves.toEqual({
      exportedRecords: 1,
      batches: 1,
    });
    expect(adapter.batches.at(-1)?.records[0]).toMatchObject({
      recordId: entry.id,
      state: "ESTIMATED",
      sourceUpdatedAt: createdAt.toISOString(),
    });

    const finalizedAt = new Date("2026-09-03T01:00:00.000Z");
    await prisma.earningsLedgerEntry.update({
      where: { id: entry.id },
      data: {
        state: "FINAL",
        finalizedAt,
        updatedAt: finalizedAt,
      },
    });

    await expect(service.exportDataset("revenue_facts")).resolves.toEqual({
      exportedRecords: 1,
      batches: 1,
    });
    expect(adapter.batches.at(-1)?.records[0]).toMatchObject({
      recordId: entry.id,
      state: "FINAL",
      finalizedAt: finalizedAt.toISOString(),
      sourceUpdatedAt: finalizedAt.toISOString(),
    });
    const checkpoint = await prisma.warehouseExportCheckpoint.findUniqueOrThrow({
      where: { dataset_schemaVersion: { dataset: "revenue_facts", schemaVersion: 1 } },
    });
    expect(checkpoint.cursorAt).toEqual(finalizedAt);
    expect(checkpoint.cursorId).toBe(entry.id);
  });
});
