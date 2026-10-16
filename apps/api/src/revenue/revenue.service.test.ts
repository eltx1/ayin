import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import type { DatabaseService } from "../database/database.service.js";
import { RevenueService } from "./revenue.service.js";

describe("Manual payout financial timestamps", () => {
  afterEach(() => vi.useRealTimers());

  it.each(["PROCESSING", "PAID"])(
    "preserves the original financial timestamps when %s is repeated",
    async (status) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
      const processedAt = new Date("2026-09-29T12:00:00Z");
      const paidAt = status === "PAID" ? new Date("2026-09-30T12:00:00Z") : null;
      const current = {
        id: "00000000-0000-4000-8000-000000000002",
        provider: "MANUAL",
        status,
        amount: "60.123456",
        processedAt,
        paidAt,
      };
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ id: current.id }]),
        payout: {
          findUniqueOrThrow: vi.fn().mockResolvedValue(current),
          update: vi.fn().mockImplementation(async ({ data }) => ({ ...current, ...data })),
        },
      };
      const database = {
        client: { $transaction: async (work: (client: typeof tx) => unknown) => work(tx) },
      } as unknown as DatabaseService;
      const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
      const revenue = new RevenueService(database, audit as unknown as AdminAuditLogService);

      const result = await revenue.updatePayoutStatus(
        "00000000-0000-4000-8000-000000000001",
        current.id,
        { status, reason: "Repeat actual manual status after a lost response." },
      );

      expect(result.processedAt).toEqual(processedAt);
      expect(result.paidAt).toEqual(paidAt);
      expect(result.amount).toBe("60.123456");
    },
  );
});
