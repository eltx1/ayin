-- Task 70 makes payout provider identity provider-neutral while leaving production disabled
-- until a real approved adapter/account is configured.
ALTER TABLE "CreatorPayoutProfile"
  DROP CONSTRAINT IF EXISTS "CreatorPayoutProfile_provider_check";
ALTER TABLE "Payout"
  DROP CONSTRAINT IF EXISTS "Payout_provider_check";
ALTER TABLE "CreatorPayoutProfile"
  ALTER COLUMN "provider" TYPE VARCHAR(64);
ALTER TABLE "Payout"
  ALTER COLUMN "provider" TYPE VARCHAR(64);

CREATE TYPE "PayoutProviderTransferState" AS ENUM (
  'READY',
  'SUBMITTING',
  'SUBMISSION_UNKNOWN',
  'SUBMITTED',
  'PROCESSING',
  'CANCEL_REQUESTED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'UNKNOWN'
);

ALTER TABLE "CreatorPayoutProfile"
  ADD COLUMN "providerDestinationTokenEncrypted" TEXT,
  ADD COLUMN "providerDestinationVerifiedAt" TIMESTAMP(3);

ALTER TABLE "Payout"
  ADD COLUMN "providerDestinationTokenEncryptedSnapshot" TEXT;

CREATE TABLE "PayoutProviderTransfer" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "payoutId" UUID NOT NULL,
  "provider" VARCHAR(64) NOT NULL,
  "idempotencyKey" VARCHAR(200) NOT NULL,
  "state" "PayoutProviderTransferState" NOT NULL DEFAULT 'READY',
  "externalTransferId" VARCHAR(255),
  "providerResponseState" VARCHAR(120),
  "submitAttempts" INTEGER NOT NULL DEFAULT 0,
  "statusAttempts" INTEGER NOT NULL DEFAULT 0,
  "cancelAttempts" INTEGER NOT NULL DEFAULT 0,
  "nextRetryAt" TIMESTAMP(3),
  "lastErrorCode" VARCHAR(160),
  "lastErrorMessage" VARCHAR(1000),
  "submittedAt" TIMESTAMP(3),
  "lastCheckedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PayoutProviderTransfer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayoutProviderTransfer_payoutId_fkey"
    FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PayoutProviderTransfer_attempts_check"
    CHECK ("submitAttempts" >= 0 AND "statusAttempts" >= 0 AND "cancelAttempts" >= 0)
);

CREATE TABLE "PayoutProviderEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "transferId" UUID,
  "provider" VARCHAR(64) NOT NULL,
  "externalEventId" VARCHAR(255) NOT NULL,
  "eventType" VARCHAR(120) NOT NULL,
  "providerState" VARCHAR(120),
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "payloadSha256" CHAR(64) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),

  CONSTRAINT "PayoutProviderEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayoutProviderEvent_transferId_fkey"
    FOREIGN KEY ("transferId") REFERENCES "PayoutProviderTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PayoutProviderEvent_payloadSha256_check"
    CHECK ("payloadSha256" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "PayoutProviderTransfer_payoutId_key"
  ON "PayoutProviderTransfer"("payoutId");
CREATE UNIQUE INDEX "PayoutProviderTransfer_idempotencyKey_key"
  ON "PayoutProviderTransfer"("idempotencyKey");
CREATE UNIQUE INDEX "PayoutProviderTransfer_provider_externalTransferId_key"
  ON "PayoutProviderTransfer"("provider", "externalTransferId");
CREATE INDEX "PayoutProviderTransfer_state_nextRetryAt_idx"
  ON "PayoutProviderTransfer"("state", "nextRetryAt");
CREATE INDEX "PayoutProviderTransfer_provider_state_updatedAt_idx"
  ON "PayoutProviderTransfer"("provider", "state", "updatedAt");

CREATE UNIQUE INDEX "PayoutProviderEvent_provider_externalEventId_key"
  ON "PayoutProviderEvent"("provider", "externalEventId");
CREATE INDEX "PayoutProviderEvent_transferId_receivedAt_idx"
  ON "PayoutProviderEvent"("transferId", "receivedAt");
