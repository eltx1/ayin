CREATE TABLE "AnalyticsVideoHourlyRollup" (
  "bucketStart" TIMESTAMP(3) NOT NULL,
  "channelId" UUID NOT NULL,
  "videoId" UUID NOT NULL,
  "views" INTEGER NOT NULL DEFAULT 0,
  "starts" INTEGER NOT NULL DEFAULT 0,
  "watchTimeMs" BIGINT NOT NULL DEFAULT 0,
  "completions" INTEGER NOT NULL DEFAULT 0,
  "startupSamples" INTEGER NOT NULL DEFAULT 0,
  "startupDurationMs" BIGINT NOT NULL DEFAULT 0,
  "bufferEvents" INTEGER NOT NULL DEFAULT 0,
  "bufferSamples" INTEGER NOT NULL DEFAULT 0,
  "bufferDurationMs" BIGINT NOT NULL DEFAULT 0,
  "hlsFatalEvents" INTEGER NOT NULL DEFAULT 0,
  "mp4FallbackEvents" INTEGER NOT NULL DEFAULT 0,
  "qualitySwitchEvents" INTEGER NOT NULL DEFAULT 0,
  "adRequests" INTEGER NOT NULL DEFAULT 0,
  "adStarts" INTEGER NOT NULL DEFAULT 0,
  "adCompletes" INTEGER NOT NULL DEFAULT 0,
  "adClicks" INTEGER NOT NULL DEFAULT 0,
  "adErrors" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AnalyticsVideoHourlyRollup_pkey" PRIMARY KEY ("bucketStart", "videoId")
);

CREATE INDEX "AnalyticsVideoHourlyRollup_channelId_bucketStart_idx"
  ON "AnalyticsVideoHourlyRollup"("channelId", "bucketStart");

CREATE TABLE "AnalyticsVideoDailyRollup" (
  "bucketStart" TIMESTAMP(3) NOT NULL,
  "channelId" UUID NOT NULL,
  "videoId" UUID NOT NULL,
  "views" INTEGER NOT NULL DEFAULT 0,
  "starts" INTEGER NOT NULL DEFAULT 0,
  "watchTimeMs" BIGINT NOT NULL DEFAULT 0,
  "completions" INTEGER NOT NULL DEFAULT 0,
  "startupSamples" INTEGER NOT NULL DEFAULT 0,
  "startupDurationMs" BIGINT NOT NULL DEFAULT 0,
  "bufferEvents" INTEGER NOT NULL DEFAULT 0,
  "bufferSamples" INTEGER NOT NULL DEFAULT 0,
  "bufferDurationMs" BIGINT NOT NULL DEFAULT 0,
  "hlsFatalEvents" INTEGER NOT NULL DEFAULT 0,
  "mp4FallbackEvents" INTEGER NOT NULL DEFAULT 0,
  "qualitySwitchEvents" INTEGER NOT NULL DEFAULT 0,
  "adRequests" INTEGER NOT NULL DEFAULT 0,
  "adStarts" INTEGER NOT NULL DEFAULT 0,
  "adCompletes" INTEGER NOT NULL DEFAULT 0,
  "adClicks" INTEGER NOT NULL DEFAULT 0,
  "adErrors" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AnalyticsVideoDailyRollup_pkey" PRIMARY KEY ("bucketStart", "videoId")
);

CREATE INDEX "AnalyticsVideoDailyRollup_channelId_bucketStart_idx"
  ON "AnalyticsVideoDailyRollup"("channelId", "bucketStart");

CREATE TABLE "AnalyticsChannelDailyRollup" (
  "bucketStart" TIMESTAMP(3) NOT NULL,
  "channelId" UUID NOT NULL,
  "views" INTEGER NOT NULL DEFAULT 0,
  "starts" INTEGER NOT NULL DEFAULT 0,
  "watchTimeMs" BIGINT NOT NULL DEFAULT 0,
  "completions" INTEGER NOT NULL DEFAULT 0,
  "subscribeEvents" INTEGER NOT NULL DEFAULT 0,
  "likeEvents" INTEGER NOT NULL DEFAULT 0,
  "startupSamples" INTEGER NOT NULL DEFAULT 0,
  "startupDurationMs" BIGINT NOT NULL DEFAULT 0,
  "bufferEvents" INTEGER NOT NULL DEFAULT 0,
  "bufferSamples" INTEGER NOT NULL DEFAULT 0,
  "bufferDurationMs" BIGINT NOT NULL DEFAULT 0,
  "hlsFatalEvents" INTEGER NOT NULL DEFAULT 0,
  "mp4FallbackEvents" INTEGER NOT NULL DEFAULT 0,
  "qualitySwitchEvents" INTEGER NOT NULL DEFAULT 0,
  "analyticsAdEvents" INTEGER NOT NULL DEFAULT 0,
  "analyticsAdErrors" INTEGER NOT NULL DEFAULT 0,
  "adRequests" INTEGER NOT NULL DEFAULT 0,
  "adFills" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AnalyticsChannelDailyRollup_pkey" PRIMARY KEY ("bucketStart", "channelId")
);

CREATE INDEX "AnalyticsChannelDailyRollup_channelId_bucketStart_idx"
  ON "AnalyticsChannelDailyRollup"("channelId", "bucketStart");

CREATE TABLE "AnalyticsChannelDailyDimensionRollup" (
  "bucketStart" TIMESTAMP(3) NOT NULL,
  "channelId" UUID NOT NULL,
  "dimension" VARCHAR(32) NOT NULL,
  "value" VARCHAR(64) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AnalyticsChannelDailyDimensionRollup_pkey"
    PRIMARY KEY ("bucketStart", "channelId", "dimension", "value")
);

CREATE INDEX "analytics_channel_dimension_bucket_idx"
  ON "AnalyticsChannelDailyDimensionRollup"("channelId", "bucketStart", "dimension");

CREATE TABLE "AnalyticsPlaybackSessionDailyRollup" (
  "bucketStart" TIMESTAMP(3) NOT NULL,
  "channelId" UUID NOT NULL,
  "videoId" UUID NOT NULL,
  "sessionHash" CHAR(64) NOT NULL,
  "started" BOOLEAN NOT NULL DEFAULT false,
  "maxPositionMs" INTEGER,
  CONSTRAINT "AnalyticsPlaybackSessionDailyRollup_pkey"
    PRIMARY KEY ("bucketStart", "channelId", "videoId", "sessionHash")
);

CREATE INDEX "AnalyticsPlaybackSessionDailyRollup_channelId_bucketStart_idx"
  ON "AnalyticsPlaybackSessionDailyRollup"("channelId", "bucketStart");
CREATE INDEX "AnalyticsPlaybackSessionDailyRollup_videoId_bucketStart_idx"
  ON "AnalyticsPlaybackSessionDailyRollup"("videoId", "bucketStart");

CREATE TABLE "AnalyticsPlatformSessionDailyRollup" (
  "bucketStart" TIMESTAMP(3) NOT NULL,
  "sessionHash" CHAR(64) NOT NULL,
  CONSTRAINT "AnalyticsPlatformSessionDailyRollup_pkey"
    PRIMARY KEY ("bucketStart", "sessionHash")
);

CREATE INDEX "AnalyticsPlatformSessionDailyRollup_bucketStart_idx"
  ON "AnalyticsPlatformSessionDailyRollup"("bucketStart");

CREATE TABLE "AnalyticsPlatformDailyRollup" (
  "bucketStart" TIMESTAMP(3) NOT NULL,
  "uniqueSessions" INTEGER NOT NULL DEFAULT 0,
  "views" INTEGER NOT NULL DEFAULT 0,
  "starts" INTEGER NOT NULL DEFAULT 0,
  "watchTimeMs" BIGINT NOT NULL DEFAULT 0,
  "completions" INTEGER NOT NULL DEFAULT 0,
  "uploads" INTEGER NOT NULL DEFAULT 0,
  "tvStarts" INTEGER NOT NULL DEFAULT 0,
  "adEvents" INTEGER NOT NULL DEFAULT 0,
  "errors" INTEGER NOT NULL DEFAULT 0,
  "bufferEvents" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AnalyticsPlatformDailyRollup_pkey" PRIMARY KEY ("bucketStart")
);

CREATE TABLE "AnalyticsRollupState" (
  "key" VARCHAR(32) NOT NULL,
  "lastSuccessfulAt" TIMESTAMP(3),
  "lastCleanupAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnalyticsRollupState_pkey" PRIMARY KEY ("key")
);
