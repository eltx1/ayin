import { describe, expect, it, vi } from "vitest";

import { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import { DatabaseService } from "../database/database.service.js";
import { RevenueReconciliationService } from "./revenue-reconciliation.service.js";
import { ManualRevenueReportingAdapter } from "./revenue-reporting.adapter.js";

describe("RevenueReconciliationService idempotency", () => {
  it("returns an existing source report on replay without opening a write transaction", async () => {
    const existing = {
      id: "171f59b6-c9fd-4a93-9e11-51f69173c548",
      source: "provider-a",
      sourceReportId: "august-final-v1",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-09-01T00:00:00.000Z"),
      currency: "USD",
      state: "FINAL",
      importFormat: "STRUCTURED",
      totalRows: 1,
      matchedRows: 0,
      unmatchedRows: 0,
      duplicateRows: 0,
      correctedRows: 0,
      finalizedRows: 1,
      anomalousRows: 0,
      createdAt: new Date("2026-09-02T00:00:00.000Z"),
    };
    const findUnique = vi.fn().mockResolvedValue(existing);
    const transaction = vi.fn();
    const database = {
      client: {
        revenueSourceReport: { findUnique },
        $transaction: transaction,
      },
    } as unknown as DatabaseService;
    const service = new RevenueReconciliationService(
      database,
      {} as AdminAuditLogService,
      new ManualRevenueReportingAdapter(),
    );

    const result = await service.importReport("807f3fd3-bdb4-48d4-9f77-d99cce4aff1f", {
      source: "provider-a",
      sourceReportId: "august-final-v1",
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-09-01T00:00:00.000Z",
      currency: "USD",
      state: "FINAL",
      format: "STRUCTURED",
      rows: [
        {
          externalRowId: "row-1",
          grossAmount: "100.000000",
          channelId: "bb4bc72f-d17c-43cc-92a6-ea07c58d8e4a",
        },
      ],
    });

    expect(result.idempotentReplay).toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
  });
});
