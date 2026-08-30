CREATE TYPE "EarningsEntryState" AS ENUM ('ESTIMATED', 'FINAL', 'ADJUSTMENT');

ALTER TABLE "EarningsLedgerEntry"
  ADD COLUMN "state" "EarningsEntryState" NOT NULL DEFAULT 'ESTIMATED',
  ADD COLUMN "grossAmount" DECIMAL(20,6),
  ADD COLUMN "revenueShareBps" INTEGER,
  ADD COLUMN "idempotencyKey" VARCHAR(200),
  ADD COLUMN "adSource" VARCHAR(80),
  ADD COLUMN "periodStart" TIMESTAMP(3),
  ADD COLUMN "periodEnd" TIMESTAMP(3);

UPDATE "EarningsLedgerEntry"
SET "state" = 'ADJUSTMENT'
WHERE "type" = 'ADJUSTMENT';

UPDATE "EarningsLedgerEntry"
SET "state" = 'FINAL'
WHERE "type" IN ('PAYOUT', 'REVERSAL') OR "finalizedAt" IS NOT NULL;

ALTER TABLE "EarningsLedgerEntry"
  ADD CONSTRAINT "EarningsLedgerEntry_revenueShareBps_check"
    CHECK ("revenueShareBps" IS NULL OR ("revenueShareBps" >= 0 AND "revenueShareBps" <= 10000)),
  ADD CONSTRAINT "EarningsLedgerEntry_period_check"
    CHECK ("periodStart" IS NULL OR "periodEnd" IS NULL OR "periodEnd" > "periodStart");

CREATE UNIQUE INDEX "EarningsLedgerEntry_idempotencyKey_key"
  ON "EarningsLedgerEntry"("idempotencyKey");
CREATE INDEX "EarningsLedgerEntry_channelId_state_occurredAt_idx"
  ON "EarningsLedgerEntry"("channelId", "state", "occurredAt");
CREATE INDEX "EarningsLedgerEntry_videoId_periodStart_idx"
  ON "EarningsLedgerEntry"("videoId", "periodStart");
CREATE INDEX "EarningsLedgerEntry_campaignId_periodStart_idx"
  ON "EarningsLedgerEntry"("campaignId", "periodStart");
