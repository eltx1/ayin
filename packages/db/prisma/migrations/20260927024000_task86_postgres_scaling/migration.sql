CREATE INDEX "watch_history_trending_time_idx"
  ON "WatchHistory"("lastWatchedAt", "videoId");

CREATE INDEX "earnings_channel_currency_time_idx"
  ON "EarningsLedgerEntry"("channelId", "currency", "occurredAt");
