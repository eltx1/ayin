import { describe, expect, it } from "vitest";

import { applyRevenueShareMicros, formatMoneyMicros, parseMoneyMicros } from "./money.js";
import {
  buildLedgerEffects,
  buildReconciliationLedgerKey,
  classifyReconciliation,
  type ReconciliationSnapshot,
} from "./revenue-reconciliation.logic.js";

function snapshot(
  gross: string,
  state: "ESTIMATED" | "FINAL",
  creatorShareBps = 5500,
): ReconciliationSnapshot {
  const grossMicros = parseMoneyMicros(gross);
  return {
    state,
    currency: "USD",
    periodStart: "2026-08-01T00:00:00.000Z",
    periodEnd: "2026-09-01T00:00:00.000Z",
    channelId: "bb4bc72f-d17c-43cc-92a6-ea07c58d8e4a",
    videoId: "7f5bd9a0-6d65-46dd-9c5b-e649f22aa621",
    grossMicros,
    creatorMicros: applyRevenueShareMicros(grossMicros, creatorShareBps),
  };
}

describe("revenue reconciliation ledger planning", () => {
  it("computes estimated corrections with exact six-decimal integer deltas", () => {
    const previous = snapshot("100.000001", "ESTIMATED");
    const current = snapshot("99.999999", "ESTIMATED");
    const result = classifyReconciliation(previous, current);
    const effects = buildLedgerEffects(result.status, current, previous);

    expect(result.status).toBe("CORRECTED");
    expect(effects).toHaveLength(1);
    expect(effects[0]?.state).toBe("ESTIMATED");
    expect(formatMoneyMicros(effects[0]!.grossMicros)).toBe("-0.000002");
    expect(formatMoneyMicros(effects[0]!.creatorMicros)).toBe("-0.000002");
  });

  it("retires the prior estimate and appends a final row without destructive overwrite", () => {
    const previous = snapshot("100.000000", "ESTIMATED");
    const current = snapshot("98.500000", "FINAL");
    const result = classifyReconciliation(previous, current);
    const effects = buildLedgerEffects(result.status, current, previous);

    expect(result.status).toBe("FINALIZED");
    expect(effects.map((effect) => effect.key)).toEqual(["RETIRE_ESTIMATE", "PRIMARY"]);
    expect(formatMoneyMicros(effects[0]!.creatorMicros)).toBe("-55.000000");
    expect(effects[1]?.state).toBe("FINAL");
    expect(formatMoneyMicros(effects[1]!.creatorMicros)).toBe("54.175000");
  });

  it("turns a correction to a finalized row into a finalized adjustment delta", () => {
    const previous = snapshot("100.000000", "FINAL");
    const current = snapshot("101.000000", "FINAL");
    const result = classifyReconciliation(previous, current);
    const effects = buildLedgerEffects(result.status, current, previous);

    expect(result.status).toBe("CORRECTED");
    expect(effects[0]).toMatchObject({
      type: "ADJUSTMENT",
      state: "ADJUSTMENT",
      finalized: true,
    });
    expect(formatMoneyMicros(effects[0]!.creatorMicros)).toBe("0.550000");
  });

  it("detects exact repeats and illegal final-to-estimated regressions", () => {
    const final = snapshot("100.000000", "FINAL");
    expect(classifyReconciliation(final, final).status).toBe("DUPLICATE");
    expect(classifyReconciliation(final, snapshot("100.000000", "ESTIMATED")).status).toBe(
      "ANOMALOUS",
    );
  });

  it("builds stable bounded ledger idempotency keys", () => {
    const first = buildReconciliationLedgerKey({
      source: "provider-a",
      sourceReportId: "2026-08-final",
      externalRowId: "row-123",
      effect: "PRIMARY",
    });
    const second = buildReconciliationLedgerKey({
      source: "provider-a",
      sourceReportId: "2026-08-final",
      externalRowId: "row-123",
      effect: "PRIMARY",
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^recon:[a-f0-9]{64}$/);
    expect(first.length).toBeLessThan(200);
  });
});
