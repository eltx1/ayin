import type { Prisma } from "@ayin/db";
import { describe, expect, it, vi } from "vitest";

import type { DatabaseService } from "../database/database.service.js";
import type {
  CreatorComplianceAdapter,
  CreatorComplianceRequirements,
} from "./creator-compliance.adapter.js";
import { CreatorComplianceService } from "./creator-compliance.service.js";

function adapter(requirements: CreatorComplianceRequirements): CreatorComplianceAdapter {
  return {
    kind: "APPROVED_TEST_PROVIDER",
    capabilities: () => ({
      provider: "APPROVED_TEST_PROVIDER",
      connected: true,
      productionEnabled: true,
      externalIdentityWorkflow: true,
      externalTaxWorkflow: true,
      tokenizedProviderReference: true,
    }),
    requirements: vi.fn().mockResolvedValue(requirements),
    startIdentity: vi.fn(),
    startTax: vi.fn(),
    retrieveStatus: vi.fn(),
  };
}

function database(profile: Record<string, unknown> | null) {
  return {
    client: {
      creatorPayoutProfile: {
        findUnique: vi.fn().mockResolvedValue(profile),
      },
    },
  } as unknown as DatabaseService;
}

const profile = {
  id: "58caa104-b33d-45cf-8afe-dd8c378abac7",
  channelId: "26c89710-950a-44bf-b6a8-8f65fed5dce8",
  provider: "MANUAL",
  countryCode: "EG",
  identityStatus: "PENDING",
  taxStatus: "NOT_STARTED",
  payoutDestinationStatus: "PENDING",
  destinationEncrypted: "encrypted",
  destinationMask: "•••• 1234",
  providerDestinationTokenEncrypted: null,
  providerDestinationVerifiedAt: null,
  complianceProvider: null,
  complianceReferenceEncrypted: null,
  complianceLastCheckedAt: null,
};

describe("CreatorComplianceService", () => {
  it("gates only requirements supplied by the configured boundary", async () => {
    const service = new CreatorComplianceService(
      database(profile),
      adapter({
        identityRequired: true,
        taxRequired: false,
        payoutDestinationVerificationRequired: false,
        source: "PROVIDER",
        version: "test-v1",
      }),
    );
    const result = await service.statusForChannel(profile.channelId);
    expect(result.payoutComplianceEligible).toBe(false);
    expect(result.identity.required).toBe(true);
    expect(result.tax.required).toBe(false);
    expect(result.actionsRequired).toEqual(["Identity check is still being reviewed."]);
  });

  it("does not infer country requirements when the adapter says none", async () => {
    const service = new CreatorComplianceService(
      database(profile),
      adapter({
        identityRequired: false,
        taxRequired: false,
        payoutDestinationVerificationRequired: false,
        source: "NONE",
        version: null,
      }),
    );
    const result = await service.statusForChannel(profile.channelId);
    expect(result.payoutComplianceEligible).toBe(true);
    expect(result.actionsRequired).toEqual([]);
  });
});

// Exercise the real service across a deterministic asynchronous channel-lock
// boundary. PostgreSQL lock/revocation behavior is covered separately in the
// isolated payout-safety integration suite; these doubles are not DB evidence.
describe("CreatorComplianceService override authority", () => {
  const actorAccountId = "807f3fd3-bdb4-48d4-9f77-d99cce4aff1f";
  const fields = ["IDENTITY", "TAX", "PAYOUT_DESTINATION"] as const;
  function overrideFixture() {
    let acquired!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => (acquired = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const authority = { active: true, role: true };
    const row = { ...profile };
    const update = vi.fn().mockImplementation(async ({ data }) => Object.assign(row, data));
    const audit = vi.fn().mockResolvedValue({});
    const tx = {
      $queryRaw: vi.fn().mockImplementation(async (query: Prisma.Sql) => {
        if (query.sql.includes("ayin-finance-channel-lock")) {
          acquired();
          await gate;
          return [{ id: profile.channelId, status: "ACTIVE" }];
        }
        if (query.sql.includes('FROM "Account"'))
          return authority.active ? [{ id: actorAccountId }] : [];
        if (query.sql.includes('FROM "AdminRoleAssignment"'))
          return authority.role ? [{ id: "finance-role" }] : [];
        return [{ id: profile.id }];
      }),
      creatorPayoutProfile: {
        findUniqueOrThrow: vi.fn().mockImplementation(async () => ({ ...row })),
        update,
      },
      adminAuditLog: { create: audit },
    };
    const db = {
      client: {
        $transaction: vi.fn().mockImplementation(async (work) => work(tx)),
        creatorPayoutProfile: {
          findUnique: vi.fn().mockImplementation(async () => ({ ...row })),
        },
      },
    } as unknown as DatabaseService;
    const service = new CreatorComplianceService(
      db,
      adapter({
        identityRequired: true,
        taxRequired: true,
        payoutDestinationVerificationRequired: true,
        source: "PROVIDER",
        version: "isolated-test-v1",
      }),
    );
    return { service, waiting, release, authority, row, update, audit };
  }

  for (const field of fields) {
    it.each(["account", "role"] as const)(
      `rejects ${field} after %s authority is revoked while waiting`,
      async (change) => {
        const fixture = overrideFixture();
        const outcome = fixture.service.adminOverride(actorAccountId, profile.channelId, {
          field,
          status: "REJECTED",
          reason: "Isolated regression after a delayed financial write",
        });
        const settled = Promise.allSettled([outcome]);
        await fixture.waiting;
        if (change === "account") fixture.authority.active = false;
        else fixture.authority.role = false;
        fixture.release();
        const [result] = await settled;
        expect(result?.status).toBe("rejected");
        if (result?.status === "rejected") expect(result.reason.getStatus()).toBe(403);
        expect(fixture.update).not.toHaveBeenCalled();
        expect(fixture.audit).not.toHaveBeenCalled();
        expect(fixture.row).toEqual(profile);
      },
    );

    it(`retains an authorized ${field} change and records its actual predecessor`, async () => {
      const fixture = overrideFixture();
      const pending = fixture.service.adminOverride(actorAccountId, profile.channelId, {
        field,
        status: "VERIFIED",
        reason: "Isolated independently reviewed authorized override",
      });
      await fixture.waiting;
      fixture.release();
      expect(await pending).toMatchObject({ field, status: "VERIFIED" });
      const key =
        field === "IDENTITY"
          ? "identityStatus"
          : field === "TAX"
            ? "taxStatus"
            : "payoutDestinationStatus";
      expect(fixture.row[key]).toBe("VERIFIED");
      expect(fixture.audit).toHaveBeenCalledExactlyOnceWith({
        data: expect.objectContaining({
          actorAccountId,
          action: "creator.compliance_status_overridden",
          metadata: expect.objectContaining({ field, from: profile[key], to: "VERIFIED" }),
        }),
      });
    });
  }
});
