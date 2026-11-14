CREATE TABLE "MobileDevice" (
  "id" UUID NOT NULL,
  "installationId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "token" TEXT NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "platform" VARCHAR(10) NOT NULL CHECK ("platform" IN ('android', 'ios')),
  "appVersion" VARCHAR(64) NOT NULL,
  "preferences" JSONB NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notificationCursorAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MobileDevice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MobileDevice_installationId_key" ON "MobileDevice"("installationId");
CREATE UNIQUE INDEX "MobileDevice_tokenHash_key" ON "MobileDevice"("tokenHash");
CREATE INDEX "MobileDevice_accountId_revokedAt_idx" ON "MobileDevice"("accountId", "revokedAt");
CREATE INDEX "MobileDevice_sessionId_revokedAt_idx" ON "MobileDevice"("sessionId", "revokedAt");
CREATE INDEX "MobileDevice_revokedAt_lastSeenAt_idx" ON "MobileDevice"("revokedAt", "lastSeenAt");
ALTER TABLE "MobileDevice" ADD CONSTRAINT "MobileDevice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MobileDevice" ADD CONSTRAINT "MobileDevice_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AccountSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "MobilePushDelivery" (
  "id" UUID NOT NULL,
  "deviceId" UUID,
  "installationId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "notificationId" UUID NOT NULL,
  "dedupeKey" VARCHAR(128) NOT NULL,
  "type" VARCHAR(20) NOT NULL,
  "status" VARCHAR(20) NOT NULL CHECK ("status" IN ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED')),
  "providerCode" VARCHAR(80),
  "providerMessageId" VARCHAR(240),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "MobilePushDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MobilePushDelivery_installationId_dedupeKey_key" ON "MobilePushDelivery"("installationId", "dedupeKey");
CREATE INDEX "MobilePushDelivery_accountId_createdAt_idx" ON "MobilePushDelivery"("accountId", "createdAt");
CREATE INDEX "MobilePushDelivery_installationId_createdAt_idx" ON "MobilePushDelivery"("installationId", "createdAt");
ALTER TABLE "MobilePushDelivery" ADD CONSTRAINT "MobilePushDelivery_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "MobileDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MobilePushDelivery" ADD CONSTRAINT "MobilePushDelivery_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MobilePushDelivery" ADD CONSTRAINT "MobilePushDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
