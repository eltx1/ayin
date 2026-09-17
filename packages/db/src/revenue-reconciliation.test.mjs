import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260918020000_revenue_reconciliation/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const schema = readFileSync(new URL("../prisma/creator-finance.prisma", import.meta.url), "utf8");
const service = readFileSync(
  new URL("../../../apps/api/src/revenue/revenue-reconciliation.service.ts", import.meta.url),
  "utf8",
);

describe("Task 69 revenue reconciliation persistence", () => {
  it("enforces idempotent source report identity and records every required status", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "RevenueSourceReport_source_sourceReportId_key"',
    );
    for (const status of [
      "MATCHED",
      "UNMATCHED",
      "DUPLICATE",
      "CORRECTED",
      "FINALIZED",
      "ANOMALOUS",
    ]) {
      expect(schema).toContain(status);
    }
  });

  it("does not introduce destructive ledger amount updates", () => {
    expect(migration).not.toMatch(/UPDATE\s+"EarningsLedgerEntry"/iu);
    expect(service).not.toMatch(/earningsLedgerEntry\.update(?:Many)?\s*\(/u);
    expect(service).toContain("earningsLedgerEntry.create");
  });

  it("keeps automatic provider sync disabled until a real reporting adapter is configured", () => {
    expect(service).toContain("automaticProviderSyncConfigured: false");
  });
});
