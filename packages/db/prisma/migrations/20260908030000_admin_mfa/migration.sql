CREATE TYPE "MfaCredentialStatus" AS ENUM ('PENDING', 'ENABLED');

CREATE TABLE "AccountMfaCredential" (
  "accountId" UUID NOT NULL,
  "status" "MfaCredentialStatus" NOT NULL DEFAULT 'PENDING',
  "encryptedSecret" TEXT NOT NULL,
  "recoveryCodeHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "version" INTEGER NOT NULL DEFAULT 1,
  "pendingExpiresAt" TIMESTAMP(3) NOT NULL,
  "enabledAt" TIMESTAMP(3),
  "lastUsedCounter" BIGINT,
  "recoveryCodesGeneratedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AccountMfaCredential_pkey" PRIMARY KEY ("accountId")
);

CREATE INDEX "AccountMfaCredential_status_enabledAt_idx"
  ON "AccountMfaCredential"("status", "enabledAt");

ALTER TABLE "AccountMfaCredential"
  ADD CONSTRAINT "AccountMfaCredential_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
