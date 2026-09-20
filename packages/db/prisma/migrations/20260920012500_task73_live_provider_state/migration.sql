CREATE TYPE "LiveRecordingHandoffStatus" AS ENUM (
  'NONE',
  'WAITING',
  'COPYING',
  'READY',
  'CLEANUP_PENDING',
  'FAILED'
);

ALTER TABLE "LiveStream"
ADD COLUMN "providerLastEventAt" TIMESTAMP(3),
ADD COLUMN "providerLastEventId" VARCHAR(255),
ADD COLUMN "recordingLastEventAt" TIMESTAMP(3),
ADD COLUMN "recordingLastEventId" VARCHAR(255),
ADD COLUMN "providerRecordingAssetId" VARCHAR(255),
ADD COLUMN "recordingHandoffStatus" "LiveRecordingHandoffStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN "recordingR2ObjectKey" VARCHAR(1024),
ADD COLUMN "recordingMediaAssetId" UUID,
ADD COLUMN "recordingProviderDownloadUrl" TEXT,
ADD COLUMN "recordingRenditionName" VARCHAR(255),
ADD COLUMN "recordingHandoffAttempt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "recordingHandoffStartedAt" TIMESTAMP(3),
ADD COLUMN "recordingHandoffHeartbeatAt" TIMESTAMP(3),
ADD COLUMN "recordingHandoffAt" TIMESTAMP(3),
ADD COLUMN "recordingProviderDeletedAt" TIMESTAMP(3),
ADD COLUMN "recordingHandoffError" VARCHAR(500);

CREATE INDEX "LiveStream_providerKey_providerStreamId_idx"
ON "LiveStream"("providerKey", "providerStreamId");

CREATE INDEX "LiveStream_providerRecordingAssetId_idx"
ON "LiveStream"("providerRecordingAssetId");

CREATE INDEX "LiveStream_recordingHandoffStatus_updatedAt_idx"
ON "LiveStream"("recordingHandoffStatus", "updatedAt");
