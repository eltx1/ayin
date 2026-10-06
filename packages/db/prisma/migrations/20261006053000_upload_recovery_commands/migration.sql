-- Dormant creator commands. No provider, environment or request enables issuance.
ALTER TABLE "MediaUploadSession"
  ADD COLUMN "creationRequestId" UUID,
  ADD COLUMN "creationRequestDigest" CHAR(64),
  ADD COLUMN "grantlessReservationId" UUID,
  ADD COLUMN "grantReservationCount" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "upload_creation_request_shape" CHECK (
    ("creationRequestId" IS NULL AND "creationRequestDigest" IS NULL AND "grantlessReservationId" IS NULL) OR
    ("creationRequestId" IS NOT NULL AND "creationRequestDigest" IS NOT NULL AND "creationRequestDigest" ~ '^[0-9a-f]{64}$' AND "grantlessReservationId" IS NOT NULL)),
  ADD CONSTRAINT "upload_grant_reservation_count" CHECK ("grantReservationCount" >= 0 AND ("grantReservationCount" = 0 OR "lastGrantExpiresAt" IS NOT NULL));
CREATE UNIQUE INDEX "MediaUploadSession_initiatingAccountId_creationRequestId_key" ON "MediaUploadSession"("initiatingAccountId", "creationRequestId");
CREATE TYPE "MediaUploadOperationStatus" AS ENUM ('RESERVED', 'DISPATCHED', 'SUCCEEDED', 'UNKNOWN');
CREATE TABLE "MediaUploadOperation" (
  "id" UUID NOT NULL PRIMARY KEY,
  "sessionId" UUID NOT NULL REFERENCES "MediaUploadSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "requestId" UUID NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "requestDigest" CHAR(64) NOT NULL,
  "expectedRevision" INTEGER NOT NULL,
  "status" "MediaUploadOperationStatus" NOT NULL DEFAULT 'RESERVED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "dispatchStartedAt" TIMESTAMP(3),
  "grantIssuedAt" TIMESTAMP(3),
  "grantExpiresAt" TIMESTAMP(3),
  CONSTRAINT "upload_operation_shape" CHECK (
    "kind" IN ('CREATE', 'RESUME', 'AUTHORIZE', 'COMPLETE', 'CANCEL') AND
    "requestDigest" ~ '^[0-9a-f]{64}$' AND "expectedRevision" >= 1 AND
    (("grantIssuedAt" IS NULL AND "grantExpiresAt" IS NULL) OR
      ("kind" = 'AUTHORIZE' AND "grantIssuedAt" IS NOT NULL AND "grantExpiresAt" IS NOT NULL AND "grantExpiresAt" > "grantIssuedAt"))),
  CONSTRAINT "upload_operation_dispatch" CHECK ("status" NOT IN ('DISPATCHED', 'UNKNOWN') OR "dispatchStartedAt" IS NOT NULL)
);
CREATE UNIQUE INDEX "MediaUploadOperation_sessionId_requestId_key" ON "MediaUploadOperation"("sessionId", "requestId");
