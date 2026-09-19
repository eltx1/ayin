-- AYIN Task 71: creator identity/tax/payout compliance workflow.
-- AYIN stores normalized statuses and an encrypted opaque provider reference only.
-- It does not add identity-document numbers, tax IDs, document URLs, or country-specific forms.

ALTER TABLE "CreatorPayoutProfile"
  DROP CONSTRAINT IF EXISTS "CreatorPayoutProfile_identityStatus_check",
  DROP CONSTRAINT IF EXISTS "CreatorPayoutProfile_taxStatus_check";

UPDATE "CreatorPayoutProfile"
SET "taxStatus" = 'NOT_STARTED'
WHERE "taxStatus" = 'NOT_PROVIDED';

ALTER TABLE "CreatorPayoutProfile"
  ALTER COLUMN "taxStatus" SET DEFAULT 'NOT_STARTED',
  ADD COLUMN "payoutDestinationStatus" VARCHAR(24) NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "complianceProvider" VARCHAR(64),
  ADD COLUMN "complianceReferenceEncrypted" TEXT,
  ADD COLUMN "complianceLastCheckedAt" TIMESTAMP(3);

UPDATE "CreatorPayoutProfile"
SET "payoutDestinationStatus" = CASE
  WHEN "providerDestinationVerifiedAt" IS NOT NULL THEN 'VERIFIED'
  WHEN "destinationEncrypted" IS NOT NULL OR "providerDestinationTokenEncrypted" IS NOT NULL THEN 'PENDING'
  ELSE 'NOT_STARTED'
END;

ALTER TABLE "CreatorPayoutProfile"
  ADD CONSTRAINT "CreatorPayoutProfile_identityStatus_check"
    CHECK ("identityStatus" IN ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REQUIRES_ACTION', 'REJECTED')),
  ADD CONSTRAINT "CreatorPayoutProfile_taxStatus_check"
    CHECK ("taxStatus" IN ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REQUIRES_ACTION', 'REJECTED')),
  ADD CONSTRAINT "CreatorPayoutProfile_payoutDestinationStatus_check"
    CHECK ("payoutDestinationStatus" IN ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REQUIRES_ACTION', 'REJECTED'));

CREATE INDEX "CreatorPayoutProfile_complianceProvider_updatedAt_idx"
  ON "CreatorPayoutProfile"("complianceProvider", "updatedAt");
