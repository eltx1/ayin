-- Prevent concurrent payout requests from reserving the same creator balance twice.
-- Existing installations may already contain duplicate active payouts from the pre-locking path.
-- Preserve every payout record, keep the active payout that owns the most ledger rows (then the
-- oldest request as a deterministic tie-breaker), release ledger reservations owned by the other
-- duplicates, and mark those duplicate payout records CANCELLED before enforcing uniqueness.

CREATE TEMP TABLE "_PayoutActiveDedup" ON COMMIT DROP AS
SELECT
  p."id",
  ROW_NUMBER() OVER (
    PARTITION BY p."channelId", p."currency"
    ORDER BY
      (SELECT COUNT(*) FROM "EarningsLedgerEntry" e WHERE e."payoutId" = p."id") DESC,
      p."requestedAt" ASC,
      p."id" ASC
  ) AS "rank"
FROM "Payout" p
WHERE p."status" IN ('PENDING', 'PROCESSING');

UPDATE "EarningsLedgerEntry" e
SET "payoutId" = NULL
FROM "_PayoutActiveDedup" duplicate
WHERE duplicate."rank" > 1
  AND e."payoutId" = duplicate."id";

UPDATE "Payout" p
SET
  "status" = 'CANCELLED',
  "processedAt" = COALESCE(p."processedAt", CURRENT_TIMESTAMP),
  "failureReason" = CASE
    WHEN p."failureReason" IS NULL OR BTRIM(p."failureReason") = '' THEN
      'Automatically cancelled during payout-safety migration because another active payout was selected as the canonical reservation.'
    ELSE
      p."failureReason" || E'\nAutomatically cancelled during payout-safety migration because another active payout was selected as the canonical reservation.'
  END,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "_PayoutActiveDedup" duplicate
WHERE duplicate."rank" > 1
  AND p."id" = duplicate."id";

DROP TABLE "_PayoutActiveDedup";

-- PostgreSQL now enforces the invariant atomically across creator and admin payout paths.
CREATE UNIQUE INDEX "Payout_one_active_per_channel_currency_idx"
  ON "Payout"("channelId", "currency")
  WHERE "status" IN ('PENDING', 'PROCESSING');
