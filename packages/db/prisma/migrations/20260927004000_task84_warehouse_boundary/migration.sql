CREATE TABLE "WarehouseExportCheckpoint" (
  "dataset" VARCHAR(40) NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "cursorAt" TIMESTAMP(3),
  "cursorId" VARCHAR(80),
  "lastBatchId" CHAR(64),
  "lastSucceededAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WarehouseExportCheckpoint_pkey" PRIMARY KEY ("dataset", "schemaVersion")
);

CREATE INDEX "WarehouseExportCheckpoint_lastSucceededAt_idx"
  ON "WarehouseExportCheckpoint"("lastSucceededAt");

CREATE INDEX "analytics_event_export_cursor_idx"
  ON "AnalyticsEvent"("receivedAt", "id");
CREATE INDEX "channel_export_cursor_idx"
  ON "Channel"("updatedAt", "id");
CREATE INDEX "video_export_cursor_idx"
  ON "Video"("updatedAt", "id");
CREATE INDEX "ad_event_export_cursor_idx"
  ON "AdEvent"("createdAt", "id");
CREATE INDEX "earnings_export_created_cursor_idx"
  ON "EarningsLedgerEntry"("createdAt", "id");
CREATE INDEX "earnings_export_finalized_cursor_idx"
  ON "EarningsLedgerEntry"("finalizedAt", "id");
