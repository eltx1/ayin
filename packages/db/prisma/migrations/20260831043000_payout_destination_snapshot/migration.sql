-- Snapshot payout beneficiary details so later profile edits cannot redirect an active payout.
ALTER TABLE "Payout"
  ADD COLUMN "destinationEncryptedSnapshot" TEXT,
  ADD COLUMN "destinationMaskSnapshot" VARCHAR(120),
  ADD COLUMN "legalNameSnapshot" VARCHAR(160),
  ADD COLUMN "countryCodeSnapshot" CHAR(2);

UPDATE "Payout" p
SET
  "destinationEncryptedSnapshot" = cpp."destinationEncrypted",
  "destinationMaskSnapshot" = cpp."destinationMask",
  "legalNameSnapshot" = cpp."legalName",
  "countryCodeSnapshot" = cpp."countryCode"
FROM "CreatorPayoutProfile" cpp
WHERE p."paymentProfileId" = cpp."id"
  AND p."destinationEncryptedSnapshot" IS NULL;
