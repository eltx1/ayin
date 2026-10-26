import type { Prisma } from "@ayin/db";
import { describe, expect, it, vi } from "vitest";

import type { DatabaseService } from "../database/database.service.js";
import type { AdminPayoutCreationService } from "./admin-payout-creation.service.js";
import type { CreatorComplianceService } from "./creator-compliance.service.js";
import type { CreatorFinanceRepository } from "./creator-finance.repository.js";
import { CreatorFinanceService } from "./creator-finance.service.js";
import type { ExternalPayoutProviderAdapter } from "./external-payout-provider.adapter.js";
import type { PayoutProviderTransferService } from "./payout-provider-transfer.service.js";
import type { PayoutProviderAdapter } from "./payout-provider.adapter.js";
import type { RevenueService } from "./revenue.service.js";

// Actual service with a delayed transaction callback, not a PostgreSQL claim.
// payout-safety.integration covers the controller, FK wait and persisted rollback.
describe("CreatorFinanceService dispute authority", () => {
  const actorAccountId = "807f3fd3-bdb4-48d4-9f77-d99cce4aff1f";
  const disputeId = "2934e15d-dd3d-4080-86f7-4ff419dbe685";
  const input = {
    status: "RESOLVED",
    resolution: "Isolated final finance review of a test dispute.",
    reason: "Isolated test of financial write authority",
  };
  function fixture() {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const waiting = new Promise<void>((resolve) => (entered = resolve));
    const authority = { active: true, role: true };
    const audit = vi.fn().mockResolvedValue({});
    const updateDispute = vi.fn().mockResolvedValue({
      id: disputeId,
      channelId: "d0db9a63-3623-48fc-8a4e-4fa5f729cc33",
      status: "RESOLVED",
      resolution: input.resolution,
    });
    const tx = {
      $queryRaw: vi.fn().mockImplementation(async (query: Prisma.Sql) => {
        if (query.sql.includes('FROM "Account"'))
          return authority.active ? [{ id: actorAccountId }] : [];
        if (query.sql.includes('FROM "AdminRoleAssignment"'))
          return authority.role ? [{ id: "finance-role" }] : [];
        throw Error("Unexpected isolated authority query");
      }),
      adminAuditLog: { create: audit },
    };
    const database = {
      client: {
        $transaction: vi.fn().mockImplementation(async (work) => {
          entered();
          await gate;
          return work(tx);
        }),
      },
    } as unknown as DatabaseService;
    const service = new CreatorFinanceService(
      database,
      { updateDispute } as unknown as CreatorFinanceRepository,
      {} as RevenueService,
      {} as AdminPayoutCreationService,
      {} as PayoutProviderAdapter,
      {} as ExternalPayoutProviderAdapter,
      {} as PayoutProviderTransferService,
      {} as CreatorComplianceService,
    );
    return { service, release, waiting, authority, audit, updateDispute };
  }

  it.each(["account", "role"] as const)(
    "rejects resolution when %s authority changed before the transaction executes",
    async (change) => {
      const current = fixture();
      const settled = Promise.allSettled([
        current.service.updateAdminDispute(actorAccountId, disputeId, input),
      ]);
      await current.waiting;
      if (change === "account") current.authority.active = false;
      else current.authority.role = false;
      current.release();
      const [result] = await settled;
      expect(result?.status).toBe("rejected");
      if (result?.status === "rejected") expect(result.reason.getStatus()).toBe(403);
      expect(current.updateDispute).not.toHaveBeenCalled();
      expect(current.audit).not.toHaveBeenCalled();
    },
  );

  it("retains an authorized resolution with its audit", async () => {
    const current = fixture();
    const pending = current.service.updateAdminDispute(actorAccountId, disputeId, input);
    await current.waiting;
    current.release();
    expect(await pending).toMatchObject({ id: disputeId, status: "RESOLVED" });
    expect(current.updateDispute).toHaveBeenCalledTimes(1);
    expect(current.audit).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({
        actorAccountId,
        action: "revenue.dispute_updated",
        entityId: disputeId,
      }),
    });
  });
});
