import { describe, expect, it, vi } from "vitest";

import type { DatabaseService } from "../database/database.service.js";
import type { CreatorComplianceService } from "./creator-compliance.service.js";
import type { ExternalPayoutProviderAdapter } from "./external-payout-provider.adapter.js";
import { PayoutProviderTransferService } from "./payout-provider-transfer.service.js";
import type { RevenueService } from "./revenue.service.js";

describe("PayoutProviderTransferService safety", () => {
  it("refuses production submission when no approved provider is configured", async () => {
    const provider: ExternalPayoutProviderAdapter = {
      kind: "UNCONFIGURED_EXTERNAL",
      capabilities: () => ({
        provider: "UNCONFIGURED_EXTERNAL",
        connected: false,
        productionEnabled: false,
        idempotentSubmission: false,
        supportsCancellation: false,
        supportsDestinationTokenization: false,
        webhookVerification: "UNSUPPORTED",
      }),
      submitTransfer: vi.fn(),
      retrieveTransferStatus: vi.fn(),
      cancelTransfer: vi.fn(),
      verifyDestination: vi.fn(),
      verifyWebhook: vi.fn(),
    };
    const service = new PayoutProviderTransferService(
      {} as DatabaseService,
      {} as RevenueService,
      provider,
      {} as CreatorComplianceService,
    );
    await expect(
      service.submit("807f3fd3-bdb4-48d4-9f77-d99cce4aff1f", "payout-id", {
        reason: "Finance approved provider submission.",
      }),
    ).rejects.toThrow("PAYOUT_PROVIDER_NOT_CONFIGURED");
    expect(provider.submitTransfer).not.toHaveBeenCalled();
  });

  it("does not expose raw destination or provider token through capabilities", () => {
    const provider: ExternalPayoutProviderAdapter = {
      kind: "UNCONFIGURED_EXTERNAL",
      capabilities: () => ({
        provider: "UNCONFIGURED_EXTERNAL",
        connected: false,
        productionEnabled: false,
        idempotentSubmission: false,
        supportsCancellation: false,
        supportsDestinationTokenization: false,
        webhookVerification: "UNSUPPORTED",
      }),
      submitTransfer: vi.fn(),
      retrieveTransferStatus: vi.fn(),
      cancelTransfer: vi.fn(),
      verifyDestination: vi.fn(),
      verifyWebhook: vi.fn(),
    };
    const service = new PayoutProviderTransferService(
      {} as DatabaseService,
      {} as RevenueService,
      provider,
      {} as CreatorComplianceService,
    );
    expect(service.capabilities()).toMatchObject({
      paidConfirmation: "STATUS_OR_VERIFIED_WEBHOOK_ONLY",
      rawBankSecretsSentByThisAdapter: false,
    });
  });
});
