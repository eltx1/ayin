CREATE INDEX "video_public_feed_idx"
  ON "Video"("publishedAt" DESC, "id" DESC)
  WHERE "status" = 'PUBLISHED'
    AND "visibility" = 'PUBLIC'
    AND "removedAt" IS NULL;

CREATE INDEX "media_asset_playable_video_idx"
  ON "MediaAsset"("videoId")
  WHERE "kind" = 'SOURCE_VIDEO'
    AND "status" = 'VALIDATED'
    AND "removedAt" IS NULL
    AND "mimeType" = 'video/mp4';

CREATE INDEX "watch_history_trending_time_idx"
  ON "WatchHistory"("lastWatchedAt", "videoId");

CREATE INDEX "earnings_channel_currency_time_idx"
  ON "EarningsLedgerEntry"("channelId", "currency", "occurredAt");
