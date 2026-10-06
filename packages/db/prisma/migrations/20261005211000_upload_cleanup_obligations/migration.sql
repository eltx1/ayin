-- Extend the existing cleanup queue; no issuance or provider mutation is activated.
ALTER TYPE "PrivacyMediaDeletionKind" ADD VALUE 'MULTIPART';
ALTER TYPE "PrivacyMediaDeletionKind" ADD VALUE 'ALLOCATION';
ALTER TYPE "PrivacyMediaDeletionKind" ADD VALUE 'OUTPUT_SETTLEMENT';
CREATE TYPE "PrivacyMediaDeletionScope" AS ENUM ('PRIVACY', 'UPLOAD_SESSION', 'PROCESSING_SOURCE');
ALTER TABLE "PrivacyMediaDeletionJob"
  ALTER COLUMN "requestId" DROP NOT NULL,
  ALTER COLUMN "accountId" DROP NOT NULL,
  ALTER COLUMN "target" DROP NOT NULL,
  ADD COLUMN "operationKey" VARCHAR(240),
  ADD COLUMN "scope" "PrivacyMediaDeletionScope" NOT NULL DEFAULT 'PRIVACY',
  ADD COLUMN "channelId" UUID,
  ADD COLUMN "uploadSessionId" UUID,
  ADD COLUMN "sessionRevision" INTEGER,
  ADD COLUMN "sourceAssetId" UUID,
  ADD COLUMN "processingJobId" UUID,
  ADD COLUMN "providerUploadId" VARCHAR(1024),
  ADD COLUMN "leaseToken" UUID,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "lastObservation" VARCHAR(64),
  ADD COLUMN "outputAddresses" JSONB,
  ADD COLUMN "settlementProofReference" VARCHAR(200),
  ADD COLUMN "settlementVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "settlementLeaseToken" UUID,
  ADD COLUMN "retainUntil" TIMESTAMP(3);
-- Existing rows have non-null request ownership. Preserve their identity.
UPDATE "PrivacyMediaDeletionJob" SET "operationKey" = 'legacy:' || "id"::text;
ALTER TABLE "PrivacyMediaDeletionJob" ALTER COLUMN "operationKey" SET NOT NULL;
ALTER TABLE "PrivacyMediaDeletionJob" ALTER COLUMN "operationKey" SET DEFAULT gen_random_uuid()::text;
-- Multiple remote multipart IDs may share the same exact key/request.
DROP INDEX "PrivacyMediaDeletionJob_requestId_kind_target_key";
CREATE UNIQUE INDEX "privacy_cleanup_request_target_unique" ON "PrivacyMediaDeletionJob"("requestId", "kind", "target") WHERE "scope" = 'PRIVACY';
CREATE UNIQUE INDEX "PrivacyMediaDeletionJob_operationKey_key" ON "PrivacyMediaDeletionJob"("operationKey");
CREATE INDEX "PrivacyMediaDeletionJob_uploadSessionId_status_idx" ON "PrivacyMediaDeletionJob"("uploadSessionId", "status");
CREATE INDEX "PrivacyMediaDeletionJob_status_retainUntil_idx" ON "PrivacyMediaDeletionJob"("status", "retainUntil");
-- Preserve the legacy raw accountId FK (ON DELETE RESTRICT). Standalone
-- grants keep their owner; accepted channel-owned work uses accountId=NULL.
ALTER TABLE "PrivacyMediaDeletionJob" DROP CONSTRAINT "PrivacyMediaDeletionJob_requestId_fkey";
ALTER TABLE "PrivacyMediaDeletionJob" ADD CONSTRAINT "PrivacyMediaDeletionJob_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "AccountDeletionRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivacyMediaDeletionJob" ADD CONSTRAINT "media_cleanup_owner" CHECK (
  ("scope" = 'PRIVACY' AND "requestId" IS NOT NULL AND "accountId" IS NOT NULL AND "uploadSessionId" IS NULL AND "sessionRevision" IS NULL AND
    (("kind"::text <> 'OUTPUT_SETTLEMENT' AND "processingJobId" IS NULL) OR
     ("kind"::text = 'OUTPUT_SETTLEMENT' AND "processingJobId" IS NOT NULL))) OR
  ("scope" = 'UPLOAD_SESSION' AND "channelId" IS NOT NULL AND "uploadSessionId" IS NOT NULL AND "sessionRevision" IS NOT NULL AND "sessionRevision" > 0 AND "processingJobId" IS NULL) OR
  ("scope" = 'PROCESSING_SOURCE' AND "channelId" IS NOT NULL AND "uploadSessionId" IS NOT NULL AND "sessionRevision" IS NOT NULL AND "sessionRevision" > 0 AND "processingJobId" IS NOT NULL)
);
-- Enum values added in this migration are used as text until the migration commits.
ALTER TABLE "PrivacyMediaDeletionJob" ADD CONSTRAINT "media_cleanup_address" CHECK (
  ("target" IS NOT NULL AND octet_length("target") BETWEEN 1 AND 1024 AND length(btrim("target")) > 0) OR
  ("target" IS NULL AND "status" = 'DONE' AND "completedAt" IS NOT NULL)
);
ALTER TABLE "PrivacyMediaDeletionJob" ADD CONSTRAINT "media_cleanup_multipart" CHECK (
  ("kind"::text = 'MULTIPART' AND "scope" <> 'PRIVACY' AND
    (("providerUploadId" IS NOT NULL AND octet_length("providerUploadId") BETWEEN 1 AND 1024 AND length(btrim("providerUploadId")) > 0) OR "status" = 'DONE')) OR
  ("kind"::text <> 'MULTIPART' AND "providerUploadId" IS NULL)
);
ALTER TABLE "PrivacyMediaDeletionJob" ADD CONSTRAINT "media_cleanup_allocation" CHECK (
  "kind"::text <> 'ALLOCATION' OR "scope" IN ('UPLOAD_SESSION', 'PROCESSING_SOURCE')
);
ALTER TABLE "PrivacyMediaDeletionJob" ADD CONSTRAINT "media_cleanup_attempt_bounds" CHECK ("attempts" >= 0);
ALTER TABLE "MediaUploadSession"
  ADD COLUMN "lastGrantExpiresAt" TIMESTAMP(3),
  ADD COLUMN "grantsRevokedAt" TIMESTAMP(3),
  ADD COLUMN "cleanupRequestedAt" TIMESTAMP(3),
  ADD COLUMN "cleanupRetainUntil" TIMESTAMP(3);
ALTER TABLE "MediaUploadSession" DROP CONSTRAINT "upload_recovery_identity";
ALTER TABLE "MediaUploadSession" ADD CONSTRAINT "upload_recovery_identity" CHECK (
  "contentIdentityAlgorithm" = 'AYIN_SHA256_CHUNKS_V1' AND
  (("contentIdentityDigest" IS NOT NULL AND "contentIdentityDigest" ~ '^[0-9a-f]{64}$') OR
    ("contentIdentityDigest" IS NULL AND "state" IN ('REVOKED', 'EXPIRED', 'ABORTED', 'COMPLETED')))
);

CREATE INDEX "MediaUploadSession_cleanupRetainUntil_idx" ON "MediaUploadSession"("cleanupRetainUntil");

-- Old privacy workers use an unfenced UPDATE by id. They must not mark a new
-- durable obligation DONE using their legacy DELETE-only completion path.
ALTER TABLE "PrivacyMediaDeletionJob" ADD CONSTRAINT "media_cleanup_durable_done_evidence" CHECK (
  "scope" = 'PRIVACY' OR "status" <> 'DONE' OR
  ("settlementProofReference" IS NOT NULL AND length("settlementProofReference") BETWEEN 1 AND 200 AND
   "settlementVerifiedAt" IS NOT NULL AND "settlementLeaseToken" IS NOT NULL AND "completedAt" IS NOT NULL)
);

ALTER TABLE "PrivacyMediaDeletionJob" ADD CONSTRAINT "media_cleanup_processing_source_kind" CHECK (
  "scope" <> 'PROCESSING_SOURCE' OR "kind"::text IN ('OBJECT', 'MULTIPART', 'ALLOCATION')
);

-- A source-key settlement adapter cannot authorize worker-output cleanup.
-- A reviewed output-writer settlement protocol must deliberately replace this
-- gate before the kind can ever become DONE. No duration/operator boolean bypass.
ALTER TABLE "PrivacyMediaDeletionJob" ADD CONSTRAINT "media_cleanup_output_settlement_gate" CHECK (
  ("kind"::text <> 'OUTPUT_SETTLEMENT' AND "outputAddresses" IS NULL) OR
  ("kind"::text = 'OUTPUT_SETTLEMENT' AND "scope" = 'PRIVACY' AND "processingJobId" IS NOT NULL AND
   "outputAddresses" IS NOT NULL AND jsonb_typeof("outputAddresses") = 'object' AND "status" <> 'DONE')
);
