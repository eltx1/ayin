import { parseMoneyMicros } from "./money.js";

export function buildRevenueImportKey(source: string, idempotencyKey: string) {
  return `${source.trim()}:${idempotencyKey.trim()}`;
}

export function sumPayableLedgerMicros(
  entries: Array<{ state: "ESTIMATED" | "FINAL" | "ADJUSTMENT"; amount: string; payoutId: string | null }>,
) {
  return entries.reduce((total, entry) => {
    if (entry.state === "ESTIMATED" || entry.payoutId !== null) return total;
    return total + parseMoneyMicros(entry.amount);
  }, 0n);
}
