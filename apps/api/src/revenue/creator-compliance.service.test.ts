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
