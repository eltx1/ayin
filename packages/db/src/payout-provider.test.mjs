import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../prisma/migrations/20260918033000_payout_provider/migration.sql", import.meta.url),
  "utf8",
);
const schema = readFileSync(new URL("../prisma/creator-finance.prisma", import.meta.url), "utf8");
const service = readFileSync(
  new URL("../../../apps/api/src/revenue/payout-provider-transfer.service.ts", import.meta.url),
  "utf8",
);
const adapter = readFileSync(
  new URL("../../../apps/api/src/revenue/external-payout-provider.adapter.ts", import.meta.url),
  "utf8",
);

describe("Task 70 payout provider persistence and safety", () => {
  it("enforces one provider transfer per payout and stable provider idempotency keys", () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "PayoutProviderTransfer_payoutId_key"');
    expect(migration).toContain('CREATE UNIQUE INDEX "PayoutProviderTransfer_idempotencyKey_key"');
    expect(schema).toContain("idempotencyKey");
  });

  it("deduplicates provider events and records whether verification succeeded", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "PayoutProviderEvent_provider_externalEventId_key"',
    );
    expect(schema).toContain("verified");
    expect(schema).toContain("payloadSha256");
  });

  it("does not introduce destructive ledger amount rewrites", () => {
    const ledgerUpdates = service.match(/earningsLedgerEntry\.updateMany/g) ?? [];
    const reservationReleases = service.match(/data:\s*\{\s*payoutId:\s*null\s*\}/g) ?? [];
    expect(ledgerUpdates).toHaveLength(3);
    expect(reservationReleases).toHaveLength(3);
    expect(service).not.toMatch(/data:\s*\{\s*amount\s*:/u);
  });

  it("keeps the default external adapter production-disabled", () => {
    expect(adapter).toContain("productionEnabled: false");
    expect(adapter).toContain("connected: false");
    expect(adapter).toContain("PAYOUT_PROVIDER_NOT_CONFIGURED");
  });

  it("does not allow submission acknowledgement to mark payout paid", () => {
    expect(service).toContain('action: "payout.provider_submission_acknowledged"');
    expect(service).toContain('status: "PROCESSING"');
    expect(service).toContain('nextState === "COMPLETED"');
    expect(service).toContain('status: "PAID"');
  });
});
