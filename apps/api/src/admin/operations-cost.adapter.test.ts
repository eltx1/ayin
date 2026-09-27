import { describe, expect, it, vi } from "vitest";

import { ManualOperationsCostAdapter } from "./operations-cost.adapter.js";

const categoryKeys = [
  "operationsComputeMonthlyMicros",
  "operationsDatabaseMonthlyMicros",
  "operationsObjectStorageMonthlyMicros",
  "operationsMediaDeliveryMonthlyMicros",
  "operationsLiveFastMonthlyMicros",
  "operationsExternalAiSearchMonthlyMicros",
  "operationsMonitoringMonthlyMicros",
] as const;

describe("Task 87 provider-neutral cost adapter", () => {
  it("requires explicit provenance before costs are considered complete", async () => {
    const resolved = new Map<string, { value: unknown; source: "stored" | "default" }>([
      ["operationsCostModelMode", { value: "MANUAL_ACTUAL", source: "stored" }],
      ["operationsCostCurrency", { value: "USD", source: "default" }],
      ["operationsMediaProcessingComputeHourMicros", { value: 5_000_000, source: "stored" }],
      ...categoryKeys.map((key) => [key, { value: 1_000_000, source: "stored" }] as const),
    ]);
    const settings = {
      getManyResolved: vi.fn(async () => resolved),
    };
    const adapter = new ManualOperationsCostAdapter(settings as never);
    const snapshot = await adapter.readMonthlyCosts(new Date("2026-09-01T00:00:00.000Z"));

    expect(snapshot.provider).toBe("MANUAL_SETTINGS");
    expect(snapshot.mode).toBe("MANUAL_ACTUAL");
    expect(snapshot.complete).toBe(false);
    expect(snapshot.totalMonthlyMicros).toBe(7_000_000n);
    expect(snapshot.mediaProcessingComputeHourMicros).toBe(5_000_000n);
  });

  it("accepts an explicitly stored complete manual model without inventing invoices", async () => {
    const resolved = new Map<string, { value: unknown; source: "stored" }>([
      ["operationsCostModelMode", { value: "MANUAL_ESTIMATE", source: "stored" }],
      ["operationsCostCurrency", { value: "USD", source: "stored" }],
      ["operationsMediaProcessingComputeHourMicros", { value: 2_500_000, source: "stored" }],
      ...categoryKeys.map((key, index) => [
        key,
        { value: (index + 1) * 1_000_000, source: "stored" },
      ] as const),
    ]);
    const adapter = new ManualOperationsCostAdapter({
      getManyResolved: vi.fn(async () => resolved),
    } as never);
    const snapshot = await adapter.readMonthlyCosts(new Date());

    expect(snapshot.complete).toBe(true);
    expect(snapshot.totalMonthlyMicros).toBe(28_000_000n);
    expect(snapshot.categories).toHaveLength(7);
  });
});
