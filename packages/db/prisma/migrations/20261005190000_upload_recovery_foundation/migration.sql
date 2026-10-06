-- Additive, dormant metadata. No legacy source/session rows are synthesized.
CREATE TYPE "MediaUploadSessionAuthority" AS ENUM ('OWNER', 'ADMIN');
CREATE TYPE "MediaUploadSessionMode" AS ENUM ('SINGLE', 'MULTIPART');
CREATE TYPE "MediaUploadSessionState" AS ENUM ('PREPARING', 'OPEN', 'FINALIZING', 'COMPLETED', 'CANCELLING', 'ABORTED', 'EXPIRED', 'REVOKED', 'UNRESOLVED');

CREATE TABLE "MediaUploadSession" (
  "id" UUID NOT NULL,
  "sourceAssetId" UUID,
  "initiatingAccountId" UUID,
  "channelId" UUID NOT NULL,
  "videoId" UUID,
  "authority" "MediaUploadSessionAuthority" NOT NULL,
  "mode" "MediaUploadSessionMode" NOT NULL,
  "objectKey" VARCHAR(1024) NOT NULL,
  "providerUploadId" VARCHAR(1024),
  "sizeBytes" BIGINT NOT NULL,
  "mimeType" VARCHAR(255) NOT NULL,
  "partSizeBytes" BIGINT NOT NULL,
  "contentIdentityAlgorithm" VARCHAR(32) NOT NULL,
  "contentIdentityDigest" CHAR(64),
  "state" "MediaUploadSessionState" NOT NULL DEFAULT 'PREPARING',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC'),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "hardExpiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MediaUploadSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MediaUploadSession_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MediaUploadSession_initiatingAccountId_fkey" FOREIGN KEY ("initiatingAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "upload_recovery_byte_bounds" CHECK (
    "sizeBytes" > 0 AND "sizeBytes" <= 53687091200 AND
    "partSizeBytes" > 0 AND "partSizeBytes" <= 5368709120 AND
    ("sizeBytes" + "partSizeBytes" - 1) / "partSizeBytes" <= 10000
  ),
  CONSTRAINT "upload_recovery_mode_shape" CHECK (
    ("mode" = 'SINGLE' AND "providerUploadId" IS NULL AND "sizeBytes" <= 5368709120) OR
    ("mode" = 'MULTIPART' AND "partSizeBytes" >= 5242880 AND
      ("providerUploadId" IS NOT NULL OR "state" IN ('PREPARING', 'UNRESOLVED', 'REVOKED', 'EXPIRED', 'ABORTED')))
  ),
  CONSTRAINT "upload_recovery_identity" CHECK (
    "contentIdentityAlgorithm" = 'AYIN_SHA256_CHUNKS_V1' AND
    (("contentIdentityDigest" IS NOT NULL AND "contentIdentityDigest" ~ '^[0-9a-f]{64}$') OR
      ("contentIdentityDigest" IS NULL AND "state" IN ('REVOKED', 'EXPIRED', 'ABORTED')))
  ),
  CONSTRAINT "upload_recovery_lifecycle" CHECK (
    "revision" >= 1 AND "hardExpiresAt" > "createdAt" AND
    "hardExpiresAt" <= "createdAt" + INTERVAL '24 hours'
  ),
  CONSTRAINT "upload_recovery_metadata_bounds" CHECK (
    octet_length("objectKey") BETWEEN 1 AND 1024 AND length(btrim("objectKey")) > 0 AND
    length(btrim("mimeType")) > 0 AND
    ("providerUploadId" IS NULL OR (octet_length("providerUploadId") BETWEEN 1 AND 1024 AND length(btrim("providerUploadId")) > 0))
  )
);

CREATE UNIQUE INDEX "MediaUploadSession_sourceAssetId_key" ON "MediaUploadSession"("sourceAssetId");
CREATE INDEX "MediaUploadSession_initiatingAccountId_channelId_createdAt_idx" ON "MediaUploadSession"("initiatingAccountId", "channelId", "createdAt");
CREATE INDEX "MediaUploadSession_state_hardExpiresAt_idx" ON "MediaUploadSession"("state", "hardExpiresAt");
CREATE INDEX "MediaUploadSession_channelId_state_hardExpiresAt_idx" ON "MediaUploadSession"("channelId", "state", "hardExpiresAt");
