CREATE INDEX "video_public_feed_idx"
  ON "Video"("status", "visibility", "removedAt", "publishedAt", "id");

CREATE INDEX "media_asset_playable_video_idx"
  ON "MediaAsset"("videoId", "kind", "status", "removedAt", "mimeType");

CREATE INDEX "watch_history_trending_time_idx"
  ON "WatchHistory"("lastWatchedAt", "videoId");

CREATE INDEX "earnings_channel_currency_time_idx"
  ON "EarningsLedgerEntry"("channelId", "currency", "occurredAt");
