import { describe, expect, it } from "vitest";

import {
  assertProviderTransferTransition,
  buildPayoutProviderIdempotencyKey,
  canRetryProviderSubmission,
  MAX_PROVIDER_SUBMIT_ATTEMPTS,
  providerSubmitRetryDelayMs,
} from "./payout-provider-state-machine.js";

describe("payout provider state machine", () => {
  it("never allows submission acknowledgement to jump directly to completed", () => {
    expect(() => assertProviderTransferTransition("SUBMITTING", "COMPLETED")).toThrow(
      "INVALID_PROVIDER_TRANSFER_TRANSITION",
    );
    expect(() => assertProviderTransferTransition("SUBMITTING", "PROCESSING")).not.toThrow();
  });

  it("makes the external submission key stable across retries", () => {
    const a = buildPayoutProviderIdempotencyKey("approved-provider", "payout-123");
    const b = buildPayoutProviderIdempotencyKey("approved-provider", "payout-123");
    expect(a).toBe(b);
    expect(a).toMatch(/^payout:[a-f0-9]{64}$/);
  });

  it("bounds retries and requires the retry window to be due", () => {
    const now = new Date("2026-09-18T00:00:00.000Z");
    expect(
      canRetryProviderSubmission({
        state: "SUBMISSION_UNKNOWN",
        submitAttempts: 1,
        nextRetryAt: new Date("2026-09-17T23:59:59.000Z"),
        now,
      }),
    ).toBe(true);
    expect(
      canRetryProviderSubmission({
        state: "SUBMISSION_UNKNOWN",
        submitAttempts: MAX_PROVIDER_SUBMIT_ATTEMPTS,
        nextRetryAt: null,
        now,
      }),
    ).toBe(false);
    expect(
      canRetryProviderSubmission({
        state: "SUBMISSION_UNKNOWN",
        submitAttempts: 1,
        nextRetryAt: null,
        now,
      }),
    ).toBe(false);
    expect(providerSubmitRetryDelayMs(99)).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it("keeps terminal transfer states terminal", () => {
    expect(() => assertProviderTransferTransition("COMPLETED", "FAILED")).toThrow(
      "INVALID_PROVIDER_TRANSFER_TRANSITION",
    );
    expect(() => assertProviderTransferTransition("CANCELLED", "PROCESSING")).toThrow(
      "INVALID_PROVIDER_TRANSFER_TRANSITION",
    );
  });
});
