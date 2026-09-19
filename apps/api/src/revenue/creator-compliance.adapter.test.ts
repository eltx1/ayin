import { describe, expect, it } from "vitest";

import { DisabledCreatorComplianceAdapter } from "./creator-compliance.adapter.js";

describe("creator compliance adapter boundary", () => {
  it("does not invent compliance requirements when no approved provider/legal configuration exists", async () => {
    const adapter = new DisabledCreatorComplianceAdapter();
    expect(adapter.capabilities()).toMatchObject({
      connected: false,
      productionEnabled: false,
      externalIdentityWorkflow: false,
      externalTaxWorkflow: false,
    });
    await expect(
      adapter.requirements({
        channelId: "9a273b21-917a-478f-bdd1-b7326613cdb5",
        countryCode: "US",
        payoutProvider: "MANUAL",
      }),
    ).resolves.toEqual({
      identityRequired: false,
      taxRequired: false,
      payoutDestinationVerificationRequired: false,
      source: "NONE",
      version: null,
    });
  });

  it("does not branch on country inside the disabled boundary", async () => {
    const adapter = new DisabledCreatorComplianceAdapter();
    const us = await adapter.requirements({
      channelId: "9a273b21-917a-478f-bdd1-b7326613cdb5",
      countryCode: "US",
      payoutProvider: "MANUAL",
    });
    const eg = await adapter.requirements({
      channelId: "9a273b21-917a-478f-bdd1-b7326613cdb5",
      countryCode: "EG",
      payoutProvider: "MANUAL",
    });
    expect(eg).toEqual(us);
  });
});
