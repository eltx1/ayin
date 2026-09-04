CREATE TYPE "MediaProcessingJobStatus" AS ENUM ('INGESTING', 'QUEUED', 'PROCESSING', 'UPLOADING', 'VERIFYING', 'READY', 'FAILED', 'CANCELLED');

CREATE TABLE "MediaProcessingJob" (
    "id" UUID NOT NULL,
    "videoId" UUID NOT NULL,
    "finalAssetId" UUID,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "status" "MediaProcessingJobStatus" NOT NULL DEFAULT 'INGESTING',
    "sourceMimeType" VARCHAR(255) NOT NULL,
    "sourceSizeBytes" BIGINT NOT NULL,
    "stagingKey" VARCHAR(1024) NOT NULL,
    "inputR2ObjectKey" VARCHAR(1024),
    "outputR2ObjectKey" VARCHAR(1024) NOT NULL,
    "outputSizeBytes" BIGINT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "stage" VARCHAR(64),
    "leaseOwner" VARCHAR(255),
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "errorCode" VARCHAR(128),
    "errorMessage" TEXT,
    "queuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MediaProcessingJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaProcessingJob_finalAssetId_key" ON "MediaProcessingJob"("finalAssetId");
CREATE UNIQUE INDEX "MediaProcessingJob_stagingKey_key" ON "MediaProcessingJob"("stagingKey");
CREATE UNIQUE INDEX "MediaProcessingJob_outputR2ObjectKey_key" ON "MediaProcessingJob"("outputR2ObjectKey");
CREATE UNIQUE INDEX "MediaProcessingJob_videoId_generation_key" ON "MediaProcessingJob"("videoId", "generation");
CREATE INDEX "MediaProcessingJob_status_priority_queuedAt_idx" ON "MediaProcessingJob"("status", "priority", "queuedAt");
CREATE INDEX "MediaProcessingJob_leaseExpiresAt_idx" ON "MediaProcessingJob"("leaseExpiresAt");
CREATE INDEX "MediaProcessingJob_videoId_status_idx" ON "MediaProcessingJob"("videoId", "status");

ALTER TABLE "MediaProcessingJob" ADD CONSTRAINT "MediaProcessingJob_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaProcessingJob" ADD CONSTRAINT "MediaProcessingJob_finalAssetId_fkey" FOREIGN KEY ("finalAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
