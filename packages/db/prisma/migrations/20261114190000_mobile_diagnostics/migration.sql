CREATE TABLE "MobileDiagnostic" (
    "id" UUID NOT NULL,
    "installationId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "platform" VARCHAR(10),
    "appVersion" VARCHAR(64),
    "snapshot" JSONB,
    "receivedAt" TIMESTAMP(3),
    "consentVersion" INTEGER NOT NULL DEFAULT 0,
    "consentRevokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MobileDiagnostic_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MobileDiagnostic_installationId_key" ON "MobileDiagnostic"("installationId");
CREATE INDEX "MobileDiagnostic_accountId_receivedAt_idx" ON "MobileDiagnostic"("accountId", "receivedAt");
CREATE INDEX "MobileDiagnostic_sessionId_idx" ON "MobileDiagnostic"("sessionId");
CREATE INDEX "MobileDiagnostic_expiresAt_idx" ON "MobileDiagnostic"("expiresAt");
ALTER TABLE "MobileDiagnostic" ADD CONSTRAINT "MobileDiagnostic_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MobileDiagnostic" ADD CONSTRAINT "MobileDiagnostic_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AccountSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
