-- Creator finance center records are intentionally isolated from card/payment credentials.
-- Destination details are encrypted by the application before persistence.

CREATE TABLE "CreatorPayoutProfile" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "legalName" VARCHAR(160) NOT NULL,
    "preferredCurrency" CHAR(3) NOT NULL,
    "provider" VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    "destinationEncrypted" TEXT,
    "destinationMask" VARCHAR(120),
    "countryCode" CHAR(2),
    "identityStatus" VARCHAR(24) NOT NULL DEFAULT 'NOT_STARTED',
    "taxStatus" VARCHAR(24) NOT NULL DEFAULT 'NOT_PROVIDED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreatorPayoutProfile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CreatorPayoutProfile_channelId_key" UNIQUE ("channelId"),
    CONSTRAINT "CreatorPayoutProfile_provider_check"
      CHECK ("provider" IN ('MANUAL', 'BANK_TRANSFER', 'PAYPAL', 'PAYONEER', 'WISE')),
    CONSTRAINT "CreatorPayoutProfile_identityStatus_check"
      CHECK ("identityStatus" IN ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED')),
    CONSTRAINT "CreatorPayoutProfile_taxStatus_check"
      CHECK ("taxStatus" IN ('NOT_PROVIDED', 'PENDING', 'VERIFIED', 'REQUIRES_ACTION'))
);

CREATE INDEX "CreatorPayoutProfile_provider_updatedAt_idx"
  ON "CreatorPayoutProfile"("provider", "updatedAt");

ALTER TABLE "CreatorPayoutProfile"
  ADD CONSTRAINT "CreatorPayoutProfile_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RevenueDispute" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "payoutId" UUID,
    "createdByAccountId" UUID NOT NULL,
    "category" VARCHAR(24) NOT NULL,
    "message" TEXT NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedByAccountId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "RevenueDispute_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RevenueDispute_category_check"
      CHECK ("category" IN ('EARNINGS', 'PAYOUT', 'OTHER')),
    CONSTRAINT "RevenueDispute_status_check"
      CHECK ("status" IN ('OPEN', 'REVIEWING', 'RESOLVED', 'REJECTED'))
);

CREATE INDEX "RevenueDispute_channelId_status_createdAt_idx"
  ON "RevenueDispute"("channelId", "status", "createdAt");
CREATE INDEX "RevenueDispute_status_createdAt_idx"
  ON "RevenueDispute"("status", "createdAt");
CREATE INDEX "RevenueDispute_payoutId_idx"
  ON "RevenueDispute"("payoutId");

ALTER TABLE "RevenueDispute"
  ADD CONSTRAINT "RevenueDispute_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RevenueDispute"
  ADD CONSTRAINT "RevenueDispute_payoutId_fkey"
  FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RevenueDispute"
  ADD CONSTRAINT "RevenueDispute_createdByAccountId_fkey"
  FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RevenueDispute"
  ADD CONSTRAINT "RevenueDispute_resolvedByAccountId_fkey"
  FOREIGN KEY ("resolvedByAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payout"
  ADD COLUMN "provider" VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "requestSource" VARCHAR(16) NOT NULL DEFAULT 'ADMIN',
  ADD COLUMN "paymentProfileId" UUID;

ALTER TABLE "Payout"
  ADD CONSTRAINT "Payout_provider_check"
    CHECK ("provider" IN ('MANUAL', 'BANK_TRANSFER', 'PAYPAL', 'PAYONEER', 'WISE')),
  ADD CONSTRAINT "Payout_requestSource_check"
    CHECK ("requestSource" IN ('ADMIN', 'CREATOR')),
  ADD CONSTRAINT "Payout_paymentProfileId_fkey"
    FOREIGN KEY ("paymentProfileId") REFERENCES "CreatorPayoutProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Payout_provider_status_requestedAt_idx"
  ON "Payout"("provider", "status", "requestedAt");
CREATE INDEX "Payout_paymentProfileId_idx"
  ON "Payout"("paymentProfileId");
