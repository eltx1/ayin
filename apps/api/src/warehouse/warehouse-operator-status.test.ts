import { describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../database/database.service.js";
import { DisabledWarehouseExportAdapter } from "./warehouse-export.adapter.js";
import { WarehouseExportService } from "./warehouse-export.service.js";
import { warehouseDatasetNames } from "./warehouse-export.schemas.js";

describe("warehouse operator projection", () => {
  it("bounds one read to current dataset versions and never exposes delivery identifiers", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        dataset: "analytics_facts",
        schemaVersion: 1,
        cursorAt: new Date("2026-09-01T10:00:00Z"),
        lastSucceededAt: new Date("2026-09-01T10:05:00Z"),
        cursorId: "private-record",
        lastBatchId: "private-batch",
      },
      { dataset: "content_dimensions", schemaVersion: 2, lastSucceededAt: new Date() },
    ]);
    const adapter = new DisabledWarehouseExportAdapter();
    const write = vi.spyOn(adapter, "writeBatch");
    const service = new WarehouseExportService(
      { client: { warehouseExportCheckpoint: { findMany } } } as unknown as DatabaseService,
      adapter,
    );
    const result = await service.operatorStatus();
    expect(result.configured).toBe(false);
    expect(result.datasets).toHaveLength(warehouseDatasetNames.length);
    expect(result.datasets[0]).toEqual({
      dataset: "analytics_facts",
      schemaVersion: 1,
      cursorAt: "2026-09-01T10:00:00.000Z",
      lastSucceededAt: "2026-09-01T10:05:00.000Z",
    });
    expect(result.datasets[1]?.lastSucceededAt).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/private|cursorId|lastBatchId/);
    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: { OR: warehouseDatasetNames.map((dataset) => ({ dataset, schemaVersion: 1 })) },
      take: 5,
      select: { dataset: true, schemaVersion: true, cursorAt: true, lastSucceededAt: true },
    });
    expect(write).not.toHaveBeenCalled();
  });
  it("propagates checkpoint read failures instead of claiming no exports", async () => {
    const service = new WarehouseExportService(
      {
        client: {
          warehouseExportCheckpoint: {
            findMany: vi.fn().mockRejectedValue(new Error("database unavailable")),
          },
        },
      } as unknown as DatabaseService,
      new DisabledWarehouseExportAdapter(),
    );
    await expect(service.operatorStatus()).rejects.toThrow("database unavailable");
  });
});
