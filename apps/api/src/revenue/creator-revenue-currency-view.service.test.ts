import { describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../database/database.service.js";
import type { CreatorFinanceService } from "./creator-finance.service.js";
import { CreatorRevenueCurrencyViewService } from "./creator-revenue-currency-view.service.js";
import type { RevenueService } from "./revenue.service.js";
type Overview = NonNullable<Awaited<ReturnType<CreatorFinanceService["overview"]>>>;
function input(eligible: boolean, available = "150.000000") {
  const overview = {
    channel: { id: "00000000-0000-4000-8000-000000000001" },
    currency: "EUR",
    paymentProfile: { preferredCurrency: "USD" },
    payoutThreshold: "100.000000",
    payoutReadiness: {
      profileReady: true,
      providerReady: true,
      complianceReady: eligible,
      thresholdMet: true,
      openPayout: false,
    },
    compliance: {
      payoutComplianceEligible: eligible,
      actionsRequired: eligible ? [] : ["Identity check is still being reviewed."],
    },
    canRequestPayout: false,
    payoutEligibility: { eligible: false, actionsRequired: ["Old currency observation"] },
    payouts: [],
  } as unknown as Overview;
  const client = {
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ estimated: "0", finalized: available, available, onHold: "0" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]),
  };
  const revenue = { searchLedger: vi.fn().mockResolvedValue({ items: [] }) };
  const service = new CreatorRevenueCurrencyViewService(
    { client } as unknown as DatabaseService,
    revenue as unknown as RevenueService,
  );
  return { overview, service };
}
describe("Creator revenue currency eligibility", () => {
  it("does not re-enable payouts while actual compliance is pending", async () => {
    const { overview, service } = input(false);
    const result = await service.normalize(overview);
    expect(result.currency).toBe("USD");
    expect(result.payoutReadiness.thresholdMet).toBe(true);
    expect(result.canRequestPayout).toBe(false);
    expect(result.payoutEligibility).toEqual({
      eligible: false,
      actionsRequired: ["Identity check is still being reviewed."],
    });
  });
  it("replaces stale other-currency readiness and actions with the actual selected-currency threshold", async () => {
    const { overview, service } = input(true, "50.000000");
    const result = await service.normalize(overview);
    expect(result.availableForPayout).toBe("50.000000");
    expect(result.canRequestPayout).toBe(false);
    expect(result.payoutEligibility).toEqual({
      eligible: false,
      actionsRequired: ["Reach the minimum payout amount."],
    });
  });
  it("keeps overview eligibility and request permission consistent when every actual gate is satisfied", async () => {
    const { overview, service } = input(true);
    const result = await service.normalize(overview);
    expect(result.canRequestPayout).toBe(true);
    expect(result.payoutEligibility).toEqual({ eligible: true, actionsRequired: [] });
  });
  it("preserves a restrictive readiness observation even when compliance detail is eligible", async () => {
    const { overview, service } = input(true);
    overview.payoutReadiness.complianceReady = false;
    expect((await service.normalize(overview)).canRequestPayout).toBe(false);
  });
});
