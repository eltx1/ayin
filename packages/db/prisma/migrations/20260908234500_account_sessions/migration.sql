CREATE TABLE "AccountSession" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "authVersion" INTEGER NOT NULL,
    "deviceLabel" VARCHAR(160) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" VARCHAR(64),

    CONSTRAINT "AccountSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccountSession_accountId_revokedAt_expiresAt_idx"
ON "AccountSession"("accountId", "revokedAt", "expiresAt");

CREATE INDEX "AccountSession_expiresAt_idx" ON "AccountSession"("expiresAt");

ALTER TABLE "AccountSession"
ADD CONSTRAINT "AccountSession_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
