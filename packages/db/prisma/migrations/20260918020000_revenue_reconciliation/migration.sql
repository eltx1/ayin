CREATE TYPE "RevenueReportImportFormat" AS ENUM ('STRUCTURED', 'CSV');
CREATE TYPE "RevenueReconciliationStatus" AS ENUM (
  'MATCHED',
  'UNMATCHED',
  'DUPLICATE',
  'CORRECTED',
  'FINALIZED',
  'ANOMALOUS'
);

CREATE TABLE "RevenueSourceReport" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source" VARCHAR(80) NOT NULL,
  "sourceReportId" VARCHAR(160) NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "state" "EarningsEntryState" NOT NULL,
  "importFormat" "RevenueReportImportFormat" NOT NULL,
  "importedByAccountId" UUID,
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "matchedRows" INTEGER NOT NULL DEFAULT 0,
  "unmatchedRows" INTEGER NOT NULL DEFAULT 0,
  "duplicateRows" INTEGER NOT NULL DEFAULT 0,
  "correctedRows" INTEGER NOT NULL DEFAULT 0,
  "finalizedRows" INTEGER NOT NULL DEFAULT 0,
  "anomalousRows" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RevenueSourceReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RevenueSourceReport_period_check" CHECK ("periodEnd" > "periodStart"),
  CONSTRAINT "RevenueSourceReport_state_check" CHECK ("state" IN ('ESTIMATED', 'FINAL')),
  CONSTRAINT "RevenueSourceReport_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE TABLE "RevenueSourceReportRow" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "reportId" UUID NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "source" VARCHAR(80) NOT NULL,
  "externalRowId" VARCHAR(160) NOT NULL,
  "channelRef" VARCHAR(160),
  "videoRef" VARCHAR(200),
  "contentRef" VARCHAR(200),
  "channelId" UUID,
  "videoId" UUID,
  "grossAmount" DECIMAL(20,6) NOT NULL,
  "creatorAmount" DECIMAL(20,6),
  "currency" CHAR(3) NOT NULL,
  "state" "EarningsEntryState" NOT NULL,
  "reconciliationStatus" "RevenueReconciliationStatus" NOT NULL,
  "ledgerEntryId" UUID,
  "priorRowId" UUID,
  "reason" VARCHAR(500),
  "memo" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RevenueSourceReportRow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RevenueSourceReportRow_gross_check" CHECK ("grossAmount" >= 0),
  CONSTRAINT "RevenueSourceReportRow_state_check" CHECK ("state" IN ('ESTIMATED', 'FINAL')),
  CONSTRAINT "RevenueSourceReportRow_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "RevenueSourceReportRow_reportId_fkey"
    FOREIGN KEY ("reportId") REFERENCES "RevenueSourceReport"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RevenueSourceReport_source_sourceReportId_key"
  ON "RevenueSourceReport"("source", "sourceReportId");
CREATE INDEX "RevenueSourceReport_source_createdAt_idx"
  ON "RevenueSourceReport"("source", "createdAt");
CREATE INDEX "RevenueSourceReport_periodStart_periodEnd_idx"
  ON "RevenueSourceReport"("periodStart", "periodEnd");
CREATE INDEX "RevenueSourceReport_createdAt_idx"
  ON "RevenueSourceReport"("createdAt");

CREATE UNIQUE INDEX "RevenueSourceReportRow_reportId_rowNumber_key"
  ON "RevenueSourceReportRow"("reportId", "rowNumber");
CREATE INDEX "RevenueSourceReportRow_source_externalRowId_createdAt_idx"
  ON "RevenueSourceReportRow"("source", "externalRowId", "createdAt");
CREATE INDEX "RevenueSourceReportRow_reportId_reconciliationStatus_idx"
  ON "RevenueSourceReportRow"("reportId", "reconciliationStatus");
CREATE INDEX "RevenueSourceReportRow_channelId_createdAt_idx"
  ON "RevenueSourceReportRow"("channelId", "createdAt");
CREATE INDEX "RevenueSourceReportRow_videoId_createdAt_idx"
  ON "RevenueSourceReportRow"("videoId", "createdAt");
CREATE INDEX "RevenueSourceReportRow_ledgerEntryId_idx"
  ON "RevenueSourceReportRow"("ledgerEntryId");
