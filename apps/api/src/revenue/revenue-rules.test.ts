import { describe, expect, it } from "vitest";

import { adjustmentSchema } from "./revenue.schemas.js";
import { buildRevenueImportKey, sumPayableLedgerMicros } from "./revenue-rules.js";
import { formatMoneyMicros } from "./money.js";

describe("revenue ledger rules", () => {
  it("builds a deterministic import key for retry idempotency", () => {
    expect(buildRevenueImportKey("gam", "period-2026-08-video-1")).toBe(
      buildRevenueImportKey("gam", "period-2026-08-video-1"),
    );
  });

  it("requires a meaningful reason for manual adjustments", () => {
    const result = adjustmentSchema.safeParse({
      channelId: "bb4bc72f-d17c-43cc-92a6-ea07c58d8e4a",
      amount: "10.000000",
      currency: "USD",
      reason: "short",
    });
    expect(result.success).toBe(false);
  });

  it("adds finalized adjustments without counting estimates or already assigned payouts", () => {
    const total = sumPayableLedgerMicros([
      { state: "ESTIMATED", amount: "100.000000", payoutId: null },
      { state: "FINAL", amount: "55.000000", payoutId: null },
      { state: "ADJUSTMENT", amount: "-5.000000", payoutId: null },
      { state: "FINAL", amount: "20.000000", payoutId: "paid" },
    ]);
    expect(formatMoneyMicros(total)).toBe("50.000000");
  });
});
