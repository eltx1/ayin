ALTER TABLE "MediaProcessingJob"
  ADD COLUMN "leaseWorkerId" VARCHAR(160);

CREATE INDEX "media_job_worker_lease_idx"
  ON "MediaProcessingJob"("leaseWorkerId", "status", "leaseExpiresAt");

CREATE TABLE "MediaProcessingWorker" (
  "id" VARCHAR(160) NOT NULL,
  "hostName" VARCHAR(255) NOT NULL,
  "processId" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "cpuCapacity" INTEGER NOT NULL,
  "concurrencyLimit" INTEGER NOT NULL,
  "activeJobCount" INTEGER NOT NULL DEFAULT 0,
  "processingVersion" INTEGER NOT NULL,
  "releaseSha" VARCHAR(64) NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "heartbeatAt" TIMESTAMP(3) NOT NULL,
  "drainingAt" TIMESTAMP(3),
  "stoppedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MediaProcessingWorker_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "media_worker_status_heartbeat_idx"
  ON "MediaProcessingWorker"("status", "heartbeatAt");
