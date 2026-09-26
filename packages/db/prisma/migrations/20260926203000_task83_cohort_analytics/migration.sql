CREATE INDEX "analytics_event_profile_time_idx"
  ON "AnalyticsEvent"("profileHash", "occurredAt");
CREATE INDEX "analytics_event_channel_profile_time_idx"
  ON "AnalyticsEvent"("channelId", "profileHash", "occurredAt");

CREATE TABLE "AnalyticsPlatformAudienceDailyRollup" (
  "bucketStart" TIMESTAMP(3) NOT NULL,
  "activeProfiles" INTEGER NOT NULL DEFAULT 0,
  "newProfiles" INTEGER NOT NULL DEFAULT 0,
  "returningProfiles" INTEGER NOT NULL DEFAULT 0,
  "sessions" INTEGER NOT NULL DEFAULT 0,
  "watchTimeMs" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "AnalyticsPlatformAudienceDailyRollup_pkey" PRIMARY KEY ("bucketStart")
);

CREATE TABLE "AnalyticsChannelAudienceDailyRollup" (
  "bucketStart" TIMESTAMP(3) NOT NULL,
  "channelId" UUID NOT NULL,
  "activeProfiles" INTEGER NOT NULL DEFAULT 0,
  "newProfiles" INTEGER NOT NULL DEFAULT 0,
  "returningProfiles" INTEGER NOT NULL DEFAULT 0,
  "sessions" INTEGER NOT NULL DEFAULT 0,
  "watchTimeMs" BIGINT NOT NULL DEFAULT 0,
  "contentReturnProfiles" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AnalyticsChannelAudienceDailyRollup_pkey"
    PRIMARY KEY ("bucketStart", "channelId")
);
CREATE INDEX "AnalyticsChannelAudienceDailyRollup_channelId_bucketStart_idx"
  ON "AnalyticsChannelAudienceDailyRollup"("channelId", "bucketStart");

CREATE TABLE "AnalyticsPlatformCohortRollup" (
  "cohortDate" TIMESTAMP(3) NOT NULL,
  "cohortSize" INTEGER NOT NULL,
  "d1Retained" INTEGER,
  "d7Retained" INTEGER,
  "d30Retained" INTEGER,
  "d1Sessions" INTEGER,
  "d7Sessions" INTEGER,
  "d30Sessions" INTEGER,
  "d1WatchTimeMs" BIGINT,
  "d7WatchTimeMs" BIGINT,
  "d30WatchTimeMs" BIGINT,
  CONSTRAINT "AnalyticsPlatformCohortRollup_pkey" PRIMARY KEY ("cohortDate")
);

CREATE TABLE "AnalyticsChannelCohortRollup" (
  "cohortDate" TIMESTAMP(3) NOT NULL,
  "channelId" UUID NOT NULL,
  "cohortSize" INTEGER NOT NULL,
  "d1Retained" INTEGER,
  "d7Retained" INTEGER,
  "d30Retained" INTEGER,
  "d1Sessions" INTEGER,
  "d7Sessions" INTEGER,
  "d30Sessions" INTEGER,
  "d1WatchTimeMs" BIGINT,
  "d7WatchTimeMs" BIGINT,
  "d30WatchTimeMs" BIGINT,
  "d1ContentReturnProfiles" INTEGER,
  "d7ContentReturnProfiles" INTEGER,
  "d30ContentReturnProfiles" INTEGER,
  CONSTRAINT "AnalyticsChannelCohortRollup_pkey"
    PRIMARY KEY ("cohortDate", "channelId")
);
CREATE INDEX "AnalyticsChannelCohortRollup_channelId_cohortDate_idx"
  ON "AnalyticsChannelCohortRollup"("channelId", "cohortDate");

CREATE TABLE "AnalyticsSubscriptionEpisode" (
  "id" UUID NOT NULL,
  "channelId" UUID NOT NULL,
  "profileHash" CHAR(64) NOT NULL,
  "subscribedAt" TIMESTAMP(3) NOT NULL,
  "unsubscribedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnalyticsSubscriptionEpisode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AnalyticsSubscriptionEpisode_channelId_subscribedAt_idx"
  ON "AnalyticsSubscriptionEpisode"("channelId", "subscribedAt");
CREATE INDEX "AnalyticsSubscriptionEpisode_channelId_profileHash_unsubscribedAt_idx"
  ON "AnalyticsSubscriptionEpisode"("channelId", "profileHash", "unsubscribedAt");
CREATE INDEX "AnalyticsSubscriptionEpisode_subscribedAt_idx"
  ON "AnalyticsSubscriptionEpisode"("subscribedAt");

CREATE TABLE "AnalyticsSubscriberCohortRollup" (
  "cohortDate" TIMESTAMP(3) NOT NULL,
  "channelId" UUID NOT NULL,
  "cohortSize" INTEGER NOT NULL,
  "d1Retained" INTEGER,
  "d7Retained" INTEGER,
  "d30Retained" INTEGER,
  CONSTRAINT "AnalyticsSubscriberCohortRollup_pkey"
    PRIMARY KEY ("cohortDate", "channelId")
);
CREATE INDEX "AnalyticsSubscriberCohortRollup_channelId_cohortDate_idx"
  ON "AnalyticsSubscriberCohortRollup"("channelId", "cohortDate");

CREATE TABLE "AnalyticsCohortState" (
  "key" VARCHAR(32) NOT NULL,
  "subscriberTrackingStartedAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnalyticsCohortState_pkey" PRIMARY KEY ("key")
);

INSERT INTO "AnalyticsCohortState" ("key", "subscriberTrackingStartedAt", "updatedAt")
VALUES ('PRIMARY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
