import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  DisabledExternalPayoutProviderAdapter,
  verifyHmacSha256Signature,
} from "./external-payout-provider.adapter.js";

describe("external payout provider adapter boundary", () => {
  it("is production-disabled when no approved provider/account is configured", () => {
    const adapter = new DisabledExternalPayoutProviderAdapter();
    expect(adapter.capabilities()).toEqual({
      provider: "UNCONFIGURED_EXTERNAL",
      connected: false,
      productionEnabled: false,
      idempotentSubmission: false,
      supportsCancellation: false,
      supportsDestinationTokenization: false,
      webhookVerification: "UNSUPPORTED",
    });
  });

  it("verifies HMAC-SHA256 signatures in constant-time compatible form", () => {
    const secret = "provider-webhook-secret";
    const body = Buffer.from('{"event":"transfer.completed"}', "utf8");
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyHmacSha256Signature(secret, body, signature)).toBe(true);
    expect(verifyHmacSha256Signature(secret, body, `sha256=${signature}`)).toBe(true);
    expect(verifyHmacSha256Signature(secret, body, "0".repeat(64))).toBe(false);
  });
});
