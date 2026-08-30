CREATE TABLE "AnalyticsEvent" (
  "id" UUID NOT NULL,
  "clientEventId" VARCHAR(120) NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "eventName" VARCHAR(64) NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sessionHash" CHAR(64) NOT NULL,
  "profileHash" CHAR(64),
  "accountId" UUID,
  "channelId" UUID,
  "videoId" UUID,
  "source" VARCHAR(32) NOT NULL DEFAULT 'WEB',
  "deviceClass" VARCHAR(24),
  "durationDeltaMs" INTEGER,
  "positionMs" INTEGER,
  "metadata" JSONB,
  CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AnalyticsEvent_durationDeltaMs_check" CHECK ("durationDeltaMs" IS NULL OR ("durationDeltaMs" >= 0 AND "durationDeltaMs" <= 3600000)),
  CONSTRAINT "AnalyticsEvent_positionMs_check" CHECK ("positionMs" IS NULL OR "positionMs" >= 0)
);

CREATE UNIQUE INDEX "AnalyticsEvent_clientEventId_key" ON "AnalyticsEvent"("clientEventId");
CREATE INDEX "AnalyticsEvent_occurredAt_idx" ON "AnalyticsEvent"("occurredAt");
CREATE INDEX "AnalyticsEvent_eventName_occurredAt_idx" ON "AnalyticsEvent"("eventName", "occurredAt");
CREATE INDEX "AnalyticsEvent_sessionHash_occurredAt_idx" ON "AnalyticsEvent"("sessionHash", "occurredAt");
CREATE INDEX "AnalyticsEvent_channelId_occurredAt_idx" ON "AnalyticsEvent"("channelId", "occurredAt");
CREATE INDEX "AnalyticsEvent_videoId_occurredAt_idx" ON "AnalyticsEvent"("videoId", "occurredAt");
CREATE INDEX "AnalyticsEvent_accountId_occurredAt_idx" ON "AnalyticsEvent"("accountId", "occurredAt");

ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;
