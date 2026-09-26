import { describe, expect, it, vi } from "vitest";

import type {
  WarehouseExportAdapter,
  WarehouseExportBatch,
  WarehouseExportReceipt,
} from "./warehouse-export.adapter.js";
import { WarehouseExportService, warehouseBatchId } from "./warehouse-export.service.js";

class FixtureAdapter implements WarehouseExportAdapter {
  readonly kind = "FIXTURE_BATCH";
  readonly configured = true;
  readonly patterns = ["BATCH_FILE"] as const;
  readonly batches: WarehouseExportBatch[] = [];
  failNext = false;

  async writeBatch(batch: WarehouseExportBatch): Promise<WarehouseExportReceipt> {
    this.batches.push(batch);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("FIXTURE_EXPORT_FAILURE");
    }
    return { batchId: batch.batchId, accepted: true, providerReceipt: null };
  }
}

describe("Task 84 warehouse export delivery semantics", () => {
  it("uses stable batch ids for identical retry payloads", () => {
    const input = {
      dataset: "analytics_facts" as const,
      schemaVersion: 1 as const,
      partitionDate: "2026-09-01",
      cursor: {
        fromAt: null,
        fromId: null,
        throughAt: "2026-09-01T10:00:01.000Z",
        throughId: "11111111-1111-4111-8111-111111111111",
      },
      records: [
        {
          schemaVersion: 1 as const,
          recordId: "11111111-1111-4111-8111-111111111111",
          eventName: "VIDEO_START",
          occurredAt: "2026-09-01T10:00:00.000Z",
          receivedAt: "2026-09-01T10:00:01.000Z",
          sessionHash: "a".repeat(64),
          profileHash: null,
          channelId: null,
          videoId: null,
          source: "WEB",
          deviceClass: "DESKTOP",
          durationDeltaMs: null,
          positionMs: null,
          countryCode: null,
          trafficSource: null,
          protocol: null,
        },
      ],
    };

    expect(warehouseBatchId(input)).toBe(warehouseBatchId(structuredClone(input)));
  });

  it("does not advance checkpoints on adapter failure and retries the same deterministic batch", async () => {
    const checkpointWrite = vi.fn(async () => 1);
    const database = {
      client: {
        warehouseExportCheckpoint: {
          findUnique: vi.fn(async () => null),
        },
        analyticsEvent: {
          findMany: vi.fn(async () => [
            {
              id: "11111111-1111-4111-8111-111111111111",
              eventName: "VIDEO_START",
              occurredAt: new Date("2026-09-01T10:00:00.000Z"),
              receivedAt: new Date("2026-09-01T10:00:01.000Z"),
              sessionHash: "a".repeat(64),
              profileHash: null,
              channelId: null,
              videoId: null,
              source: "WEB",
              deviceClass: "DESKTOP",
              durationDeltaMs: null,
              positionMs: null,
              metadata: null,
            },
          ]),
        },
        $executeRaw: checkpointWrite,
      },
    };
    const adapter = new FixtureAdapter();
    const service = new WarehouseExportService(database as never, adapter);

    adapter.failNext = true;
    await expect(service.exportDataset("analytics_facts")).rejects.toThrow(
      "FIXTURE_EXPORT_FAILURE",
    );
    expect(checkpointWrite).not.toHaveBeenCalled();
    const failedBatchId = adapter.batches[0]!.batchId;

    await expect(service.exportDataset("analytics_facts")).resolves.toEqual({
      exportedRecords: 1,
      batches: 1,
    });
    expect(adapter.batches[1]!.batchId).toBe(failedBatchId);
    expect(checkpointWrite).toHaveBeenCalledTimes(1);
  });

  it("is a zero-dependency no-op when no warehouse adapter is configured", async () => {
    const databaseAccess = vi.fn(() => {
      throw new Error("DATABASE_SHOULD_NOT_BE_TOUCHED");
    });
    const disabledAdapter: WarehouseExportAdapter = {
      kind: "DISABLED",
      configured: false,
      patterns: [],
      async writeBatch() {
        throw new Error("ADAPTER_SHOULD_NOT_BE_TOUCHED");
      },
    };
    const service = new WarehouseExportService(
      {
        client: new Proxy(
          {},
          {
            get: databaseAccess,
          },
        ),
      } as never,
      disabledAdapter,
    );

    await expect(service.exportOnce()).resolves.toEqual({
      configured: false,
      adapter: "DISABLED",
      exportedRecords: 0,
      batches: 0,
    });
    expect(databaseAccess).not.toHaveBeenCalled();
  });
});
