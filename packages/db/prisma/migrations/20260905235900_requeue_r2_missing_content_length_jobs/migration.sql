-- Requeue only media-processing jobs that failed because the worker's
-- canonical R2 PUT omitted Content-Length. The upload implementation is
-- fixed before this repair migration is deployed, so these jobs are safe
-- to process again.
UPDATE "MediaProcessingJob"
SET
  "status" = 'QUEUED',
  "stage" = 'REPAIR_RETRY_QUEUED',
  "progressPercent" = 0,
  "attempt" = 0,
  "queuedAt" = NOW(),
  "startedAt" = NULL,
  "completedAt" = NULL,
  "leaseOwner" = NULL,
  "leaseExpiresAt" = NULL,
  "heartbeatAt" = NULL,
  "errorCode" = NULL,
  "errorMessage" = NULL,
  "updatedAt" = NOW()
WHERE "status" = 'FAILED'
  AND "errorCode" = 'R2_PROCESSING_FAILED'
  AND "errorMessage" LIKE '%MissingContentLength%';
