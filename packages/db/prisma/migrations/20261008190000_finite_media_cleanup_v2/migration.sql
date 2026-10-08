-- Finite application settlement V2. Historical contracts/evidence are not upgraded.
ALTER TYPE "PrivacyMediaDeletionScope" ADD VALUE 'PROCESSING_OUTPUT';
CREATE TYPE "MediaUploadProviderOutcome" AS ENUM ('NOT_DISPATCHED', 'UNKNOWN', 'ACKNOWLEDGED');
ALTER TABLE "MediaUploadSession"
  ADD COLUMN "sourceProtocolVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("sourceProtocolVersion" IN (1, 2)),
  ADD COLUMN "providerExposureBytes" BIGINT CHECK ("providerExposureBytes" >= 0),
  ADD CONSTRAINT "source_v2_multipart_only" CHECK ("sourceProtocolVersion" <> 2 OR mode = 'MULTIPART');
ALTER TABLE "MediaUploadOperation"
  ADD COLUMN "providerOutcome" "MediaUploadProviderOutcome" NOT NULL DEFAULT 'NOT_DISPATCHED',
  ADD COLUMN "providerTerminalAt" TIMESTAMP(3),
  ADD COLUMN "providerUploadId" VARCHAR(1024),
  ADD CONSTRAINT "upload_provider_ack_shape" CHECK (
    ("providerOutcome" = 'ACKNOWLEDGED' AND "providerTerminalAt" IS NOT NULL) OR
    ("providerOutcome" <> 'ACKNOWLEDGED' AND "providerTerminalAt" IS NULL)),
  ADD CONSTRAINT "upload_provider_allocation_shape" CHECK (
    "providerUploadId" IS NULL OR (kind IN ('CREATE','COMPLETE') AND octet_length("providerUploadId") BETWEEN 1 AND 1024));
-- Legacy operations keep unknown historical semantics. Only V2 dispatches enter
-- this index; it prevents alternate request IDs from repeating CREATE/COMPLETE.
CREATE UNIQUE INDEX "upload_single_object_dispatch" ON "MediaUploadOperation" ("sessionId", kind)
  WHERE kind IN ('CREATE','COMPLETE') AND "providerOutcome" <> 'NOT_DISPATCHED';
ALTER TABLE "MediaProcessingJob" ADD COLUMN "outputProtocolVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("outputProtocolVersion" IN (1, 2));
ALTER TABLE "MediaProcessingOutputAttempt"
  ADD COLUMN "protocolVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("protocolVersion" IN (1, 2)),
  ADD COLUMN "writesFrozenAt" TIMESTAMP(3);
CREATE TYPE "MediaProcessingOutputWriteStatus" AS ENUM ('DISPATCHED','ACKNOWLEDGED','UNKNOWN');
CREATE TABLE "MediaProcessingOutputWrite" (
  id UUID PRIMARY KEY,
  "outputAttemptId" UUID NOT NULL REFERENCES "MediaProcessingOutputAttempt"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "processingJobId" UUID NOT NULL,
  "claimToken" VARCHAR(255) NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  "objectKey" VARCHAR(1024) NOT NULL UNIQUE,
  "expectedSizeBytes" BIGINT NOT NULL CHECK ("expectedSizeBytes" > 0),
  "contentType" VARCHAR(255) NOT NULL CHECK (length("contentType") > 0),
  status "MediaProcessingOutputWriteStatus" NOT NULL DEFAULT 'DISPATCHED',
  "dispatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "outcomeUnknownAt" TIMESTAMP(3),
  CONSTRAINT "output_write_outcome_shape" CHECK (
    (status = 'ACKNOWLEDGED' AND "acknowledgedAt" IS NOT NULL) OR
    (status <> 'ACKNOWLEDGED' AND "acknowledgedAt" IS NULL)),
  CONSTRAINT "output_write_unknown_shape" CHECK (status <> 'UNKNOWN' OR "outcomeUnknownAt" IS NOT NULL)
);
CREATE INDEX "MediaProcessingOutputWrite_outputAttemptId_status_idx" ON "MediaProcessingOutputWrite" ("outputAttemptId", status);
ALTER TABLE "PrivacyMediaDeletionJob"
  ADD COLUMN "outputAttemptId" UUID,
  ADD COLUMN "cleanupContractVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("cleanupContractVersion" IN (1,2)),
  ADD COLUMN "cleanupEvidence" JSONB,
  ADD COLUMN "observedAbsentAt" TIMESTAMP(3),
  ADD COLUMN "debtKind" VARCHAR(32),
  ADD COLUMN "debtSince" TIMESTAMP(3),
  ADD COLUMN "recheckAt" TIMESTAMP(3),
  ADD COLUMN "recheckCount" INTEGER NOT NULL DEFAULT 0 CHECK ("recheckCount" >= 0);
CREATE INDEX "media_cleanup_v2_recheck_idx" ON "PrivacyMediaDeletionJob" ("cleanupContractVersion", "recheckAt");
ALTER TABLE "PrivacyMediaDeletionJob" DROP CONSTRAINT "media_cleanup_owner";
ALTER TABLE "PrivacyMediaDeletionJob" ADD CONSTRAINT "media_cleanup_owner" CHECK (
  ("scope" = 'PRIVACY' AND "requestId" IS NOT NULL AND "accountId" IS NOT NULL AND "uploadSessionId" IS NULL AND "sessionRevision" IS NULL AND "outputAttemptId" IS NULL AND
    (("kind"::text <> 'OUTPUT_SETTLEMENT' AND "processingJobId" IS NULL) OR
     ("kind"::text = 'OUTPUT_SETTLEMENT' AND "processingJobId" IS NOT NULL))) OR
  ("scope" = 'UPLOAD_SESSION' AND "channelId" IS NOT NULL AND "uploadSessionId" IS NOT NULL AND "sessionRevision" IS NOT NULL AND "sessionRevision" > 0 AND "processingJobId" IS NULL AND "outputAttemptId" IS NULL) OR
  ("scope" = 'PROCESSING_SOURCE' AND "channelId" IS NOT NULL AND "uploadSessionId" IS NOT NULL AND "sessionRevision" IS NOT NULL AND "sessionRevision" > 0 AND "processingJobId" IS NOT NULL AND "outputAttemptId" IS NULL) OR
  ("scope"::text = 'PROCESSING_OUTPUT' AND "channelId" IS NOT NULL AND "processingJobId" IS NOT NULL AND "outputAttemptId" IS NOT NULL AND "uploadSessionId" IS NULL AND "sessionRevision" IS NULL AND "accountId" IS NULL AND "kind"::text = 'OUTPUT_SETTLEMENT')
);
ALTER TABLE "PrivacyMediaDeletionJob" DROP CONSTRAINT "media_cleanup_durable_done_evidence";
ALTER TABLE "PrivacyMediaDeletionJob" ADD CONSTRAINT "media_cleanup_durable_done_evidence" CHECK (
  "status" <> 'DONE' OR
  ("cleanupContractVersion" = 1 AND ("scope" = 'PRIVACY' OR
    ("settlementProofReference" IS NOT NULL AND length("settlementProofReference") BETWEEN 1 AND 200 AND
     "settlementVerifiedAt" IS NOT NULL AND "settlementLeaseToken" IS NOT NULL AND "completedAt" IS NOT NULL))) OR
  ("cleanupContractVersion" = 2 AND "observedAbsentAt" IS NOT NULL AND "completedAt" IS NOT NULL AND
    "settlementLeaseToken" IS NOT NULL AND "cleanupEvidence" IS NOT NULL AND jsonb_typeof("cleanupEvidence") = 'object' AND
    "cleanupEvidence"->>'version' = 'AYIN_CLEANUP_V2' AND
    "cleanupEvidence"->>'conclusion' = 'FROZEN_ACKNOWLEDGED_AND_OBSERVED_ABSENT' AND
    "cleanupEvidence"->>'operationKey' = "operationKey" AND
    "cleanupEvidence"->>'kind' = "kind"::text AND
    "cleanupEvidence"->>'writeSetDigest' ~ '^[a-f0-9]{64}$') IS TRUE
);
ALTER TABLE "PrivacyMediaDeletionJob" DROP CONSTRAINT "media_cleanup_output_settlement_gate";
ALTER TABLE "PrivacyMediaDeletionJob" ADD CONSTRAINT "media_cleanup_output_settlement_gate" CHECK (
  ("kind"::text <> 'OUTPUT_SETTLEMENT' AND "outputAddresses" IS NULL) OR
  ("kind"::text = 'OUTPUT_SETTLEMENT' AND "scope"::text IN ('PRIVACY','PROCESSING_OUTPUT') AND "processingJobId" IS NOT NULL AND
   "outputAddresses" IS NOT NULL AND jsonb_typeof("outputAddresses") = 'object' AND
   ("status" <> 'DONE' OR "cleanupContractVersion" = 2))
);
-- Guard application evidence at the database boundary too. Legacy binaries may
-- continue their old lane but cannot turn V2 or output obligations DONE by DELETE.
CREATE FUNCTION ayin_finite_cleanup_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source "MediaUploadSession"; output_attempt "MediaProcessingOutputAttempt";
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."cleanupContractVersion" IS DISTINCT FROM OLD."cleanupContractVersion" THEN
    RAISE EXCEPTION 'Cleanup contracts cannot silently upgrade' USING ERRCODE = '23514';
  END IF;
  IF NEW."cleanupContractVersion" <> 2 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND ROW(NEW.id,NEW."operationKey",NEW.scope,NEW.kind,NEW."channelId",NEW."uploadSessionId",NEW."processingJobId",NEW."outputAttemptId") IS DISTINCT FROM
    ROW(OLD.id,OLD."operationKey",OLD.scope,OLD.kind,OLD."channelId",OLD."uploadSessionId",OLD."processingJobId",OLD."outputAttemptId") THEN
    RAISE EXCEPTION 'Finite cleanup ownership is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND ROW(NEW.target,NEW."providerUploadId") IS DISTINCT FROM ROW(OLD.target,OLD."providerUploadId") AND NOT (
    OLD.status = 'DONE' AND NEW.status = 'DONE' AND NEW.target IS NULL AND NEW."providerUploadId" IS NULL AND
    OLD."retainUntil" IS NOT NULL AND OLD."retainUntil" <= (clock_timestamp() AT TIME ZONE 'UTC') AND
    OLD."observedAbsentAt" >= OLD."retainUntil"
  ) THEN RAISE EXCEPTION 'Exact cleanup address may only be minimized after final retained observation' USING ERRCODE = '23514'; END IF;
  IF NEW.status <> 'DONE' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'DONE' THEN
    -- Adoption and final minimization do not manufacture another observation.
    IF ROW(NEW."cleanupEvidence",NEW."observedAbsentAt",NEW."settlementLeaseToken",NEW."completedAt",NEW."retainUntil") IS DISTINCT FROM
       ROW(OLD."cleanupEvidence",OLD."observedAbsentAt",OLD."settlementLeaseToken",OLD."completedAt",OLD."retainUntil") THEN
      RAISE EXCEPTION 'Renewed finite evidence requires a new cleanup claim' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'UPDATE' OR OLD.status <> 'PROCESSING' OR OLD."leaseToken" IS NULL OR OLD."claimedAt" IS NULL OR
    OLD."leaseExpiresAt" IS NULL OR OLD."leaseExpiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC') OR
    NEW."settlementLeaseToken" IS DISTINCT FROM OLD."leaseToken" OR NEW.attempts IS DISTINCT FROM OLD.attempts OR
    NEW."cleanupEvidence"->>'leaseToken' IS DISTINCT FROM OLD."leaseToken"::text OR
    NEW."cleanupEvidence"->>'attempt' IS DISTINCT FROM OLD.attempts::text OR
    NEW."observedAbsentAt" IS NULL OR NEW."observedAbsentAt" < OLD."claimedAt" OR
    NEW."observedAbsentAt" > (clock_timestamp() AT TIME ZONE 'UTC') OR
    NEW."cleanupEvidence"->>'observedAbsentAt' IS DISTINCT FROM to_char(NEW."observedAbsentAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') THEN
    RAISE EXCEPTION 'Finite observation requires the current exact cleanup lease' USING ERRCODE = '23514';
  END IF;
  IF NEW."uploadSessionId" IS NOT NULL THEN
    SELECT * INTO source FROM "MediaUploadSession" WHERE id = NEW."uploadSessionId" FOR SHARE;
    IF source.id IS NULL OR source."sourceProtocolVersion" <> 2 OR source.mode <> 'MULTIPART' OR
      source."grantsRevokedAt" IS NULL OR source."cleanupRequestedAt" IS NULL OR source."objectKey" IS DISTINCT FROM NEW.target OR
      source.revision IS DISTINCT FROM NEW."sessionRevision" OR
      source."channelId" IS DISTINCT FROM NEW."channelId" OR
      source."grantsRevokedAt" > NEW."observedAbsentAt" OR source."cleanupRequestedAt" > NEW."observedAbsentAt" OR
      NEW."cleanupEvidence"->>'sessionId' IS DISTINCT FROM source.id::text OR
      NEW."cleanupEvidence"->>'sessionRevision' IS DISTINCT FROM source.revision::text OR
      (source."lastGrantExpiresAt" IS NULL AND NOT (source."grantReservationCount" = 0 AND source."grantlessReservationId" IS NOT NULL)) OR
      source."lastGrantExpiresAt" > NEW."observedAbsentAt" OR
      EXISTS (SELECT 1 FROM "MediaUploadOperation" o WHERE o."sessionId" = source.id AND o.kind IN ('CREATE','COMPLETE') AND (o."providerOutcome" = 'UNKNOWN' OR (o."dispatchStartedAt" IS NOT NULL AND o."providerOutcome" <> 'ACKNOWLEDGED') OR o."providerTerminalAt" > NEW."observedAbsentAt")) THEN
      RAISE EXCEPTION 'Unaccounted source writes cannot settle' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.kind::text = 'OUTPUT_SETTLEMENT' AND NEW."outputAttemptId" IS NOT NULL THEN
    SELECT * INTO output_attempt FROM "MediaProcessingOutputAttempt" WHERE id = NEW."outputAttemptId" FOR SHARE;
    IF output_attempt.id IS NULL OR output_attempt."processingJobId" IS DISTINCT FROM NEW."processingJobId" OR
      output_attempt."protocolVersion" <> 2 OR output_attempt."writesFrozenAt" IS NULL OR
      output_attempt."channelId" IS DISTINCT FROM NEW."channelId" OR output_attempt."canonicalR2ObjectKey" IS DISTINCT FROM NEW.target OR
      output_attempt."writesFrozenAt" > NEW."observedAbsentAt" OR
      NEW."cleanupEvidence"->>'outputAttemptId' IS DISTINCT FROM output_attempt.id::text OR
      EXISTS (SELECT 1 FROM "MediaProcessingOutputWrite" w WHERE w."outputAttemptId" = output_attempt.id AND (w.status <> 'ACKNOWLEDGED' OR w."acknowledgedAt" > NEW."observedAbsentAt")) THEN
      RAISE EXCEPTION 'Unaccounted output writes cannot settle' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Finite cleanup requires an exact owned source or output attempt' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "finite_cleanup_guard" BEFORE INSERT OR UPDATE ON "PrivacyMediaDeletionJob" FOR EACH ROW EXECUTE FUNCTION ayin_finite_cleanup_guard();
-- Resolved journals can be minimized only after the final retained observation.
-- Current job references conservatively retain lineage even for retired outputs.
CREATE FUNCTION ayin_output_attempt_minimizable(attempt_id UUID) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "MediaProcessingOutputAttempt" a WHERE a.id=attempt_id AND a."protocolVersion"=2 AND a."writesFrozenAt" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "MediaProcessingOutputWrite" w WHERE w."outputAttemptId"=a.id AND w.status <> 'ACKNOWLEDGED')
      AND EXISTS (SELECT 1 FROM "PrivacyMediaDeletionJob" j WHERE j."outputAttemptId"=a.id AND j."cleanupContractVersion"=2
        AND j.status='DONE' AND j.target IS NULL AND j."retainUntil" <= (clock_timestamp() AT TIME ZONE 'UTC') AND j."observedAbsentAt">=j."retainUntil")
      AND NOT EXISTS (SELECT 1 FROM "PrivacyMediaDeletionJob" j WHERE j."outputAttemptId"=a.id AND (j.status <> 'DONE' OR j.target IS NOT NULL))
      AND NOT EXISTS (SELECT 1 FROM "MediaProcessingJob" j WHERE j."currentOutputAttemptId"=a.id OR
        (j.status IN ('INGESTING','QUEUED','INTEGRITY_QUEUED','PROCESSING','UPLOADING','VERIFYING') AND left(j."inputR2ObjectKey",length(a.prefix))=a.prefix))
      AND NOT EXISTS (SELECT 1 FROM "MediaAsset" m WHERE m."removedAt" IS NULL AND m.status <> 'REMOVED' AND left(m."r2ObjectKey",length(a.prefix))=a.prefix)
      AND NOT EXISTS (SELECT 1 FROM "MediaPlaybackGeneration" g WHERE g."outputAttemptId"=a.id)
  );
$$;
CREATE FUNCTION ayin_output_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "MediaProcessingOutputAttempt"; j "MediaProcessingJob";
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF ayin_output_attempt_minimizable(OLD."outputAttemptId") THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Output write evidence cannot be discarded' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id,NEW."outputAttemptId",NEW."processingJobId",NEW."claimToken",NEW.attempt,NEW."objectKey",NEW."expectedSizeBytes",NEW."contentType",NEW."dispatchedAt") IS DISTINCT FROM
       ROW(OLD.id,OLD."outputAttemptId",OLD."processingJobId",OLD."claimToken",OLD.attempt,OLD."objectKey",OLD."expectedSizeBytes",OLD."contentType",OLD."dispatchedAt") OR
       (OLD.status = 'ACKNOWLEDGED' AND NEW IS DISTINCT FROM OLD) OR NEW.status = 'DISPATCHED' THEN
      RAISE EXCEPTION 'Output dispatch identity and acknowledged evidence are immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO j FROM "MediaProcessingJob" WHERE id = NEW."processingJobId" FOR UPDATE;
  SELECT * INTO a FROM "MediaProcessingOutputAttempt" WHERE id = NEW."outputAttemptId" FOR UPDATE;
  IF a.id IS NULL OR a."protocolVersion" <> 2 OR a."writesFrozenAt" IS NOT NULL OR
    a."processingJobId" IS DISTINCT FROM NEW."processingJobId" OR a."claimToken" IS DISTINCT FROM NEW."claimToken" OR a.attempt IS DISTINCT FROM NEW.attempt OR
    left(NEW."objectKey", length(a.prefix)) IS DISTINCT FROM a.prefix OR position('..' in substring(NEW."objectKey" from length(a.prefix)+1)) > 0 OR
    j.id IS NULL OR j."currentOutputAttemptId" IS DISTINCT FROM a.id OR j."leaseOwner" IS DISTINCT FROM a."claimToken" OR
    j.attempt IS DISTINCT FROM a.attempt OR j.status NOT IN ('PROCESSING','UPLOADING','VERIFYING') OR
    (j."leaseExpiresAt" IS NULL OR j."leaseExpiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC')) OR NOT ayin_required_media_job_eligible(j) OR
    NEW.status <> 'DISPATCHED' OR current_setting('ayin.media_output_write_version', true) IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION 'Current unfrozen owned attempt required before dispatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "output_write_guard" BEFORE INSERT OR UPDATE OR DELETE ON "MediaProcessingOutputWrite" FOR EACH ROW EXECUTE FUNCTION ayin_output_write_guard();
CREATE FUNCTION ayin_media_protocol_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'MediaUploadSession' THEN
    IF NEW."sourceProtocolVersion" IS DISTINCT FROM OLD."sourceProtocolVersion" THEN
      RAISE EXCEPTION 'Source protocol history is immutable' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW."outputProtocolVersion" IS DISTINCT FROM OLD."outputProtocolVersion" THEN
      RAISE EXCEPTION 'Output protocol history is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "upload_protocol_immutable" BEFORE UPDATE ON "MediaUploadSession" FOR EACH ROW EXECUTE FUNCTION ayin_media_protocol_immutable();
CREATE TRIGGER "output_protocol_immutable" BEFORE UPDATE ON "MediaProcessingJob" FOR EACH ROW EXECUTE FUNCTION ayin_media_protocol_immutable();

CREATE OR REPLACE FUNCTION ayin_output_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j "MediaProcessingJob"; cid UUID; expected TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF ayin_output_attempt_minimizable(OLD.id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Unminimized output attempts retain custody evidence' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'writesFrozenAt') IS DISTINCT FROM (to_jsonb(OLD) - 'writesFrozenAt') OR
      OLD."writesFrozenAt" IS NOT NULL OR NEW."writesFrozenAt" IS NULL THEN
      RAISE EXCEPTION 'Output attempt permits only a monotonic dispatch freeze' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO j FROM "MediaProcessingJob" WHERE id = NEW."processingJobId" FOR UPDATE;
  SELECT "channelId" INTO cid FROM "Video" WHERE id = j."videoId";
  expected := 'channels/' || cid || '/videos/' || j."videoId" || '/playback/g' || j.generation || '/attempts/' || NEW.id || '/';
  IF j.id IS NULL OR j."inputIntegrityVersion" <> 1 OR (j."outputProtocolVersion" = 2 AND NEW."protocolVersion" <> 2) OR
    (NEW."protocolVersion" = 2 AND current_setting('ayin.media_output_write_version', true) IS DISTINCT FROM '2') OR j.generation < 1 OR j.status <> 'INTEGRITY_QUEUED' OR j."leaseOwner" IS NOT NULL OR NOT ayin_required_media_job_eligible(j) OR
    current_setting('ayin.media_integrity_worker_version', true) IS DISTINCT FROM '2' OR
    NEW.attempt IS DISTINCT FROM j.attempt + 1 OR NEW.id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    NEW."channelId" IS DISTINCT FROM cid OR NEW."videoId" IS DISTINCT FROM j."videoId" OR NEW.generation IS DISTINCT FROM j.generation OR
    length(NEW."claimToken") < 38 OR NEW.prefix IS DISTINCT FROM expected OR
    NEW."canonicalR2ObjectKey" IS DISTINCT FROM expected || 'canonical.mp4' OR
    NEW."hlsR2Prefix" IS DISTINCT FROM expected || 'hls/' OR
    NEW."thumbnailR2ObjectKey" IS DISTINCT FROM expected || 'thumbnail.jpg' OR
    NEW."canonicalR2ObjectKey" IS NOT DISTINCT FROM j."inputR2ObjectKey" THEN
    RAISE EXCEPTION 'Current compatible claim and exact fresh output namespace required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- Acknowledgements can arrive after privacy/revocation, but cannot rewrite
-- immutable request identities or create a second object-creating dispatch.
CREATE FUNCTION ayin_source_operation_v2_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source "MediaUploadSession";
BEGIN
  SELECT * INTO source FROM "MediaUploadSession" WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD."sessionId" ELSE NEW."sessionId" END;
  IF source."sourceProtocolVersion" IS DISTINCT FROM 2 THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD."providerOutcome" = 'UNKNOWN' OR source."cleanupRetainUntil" IS NULL OR
      source."cleanupRetainUntil" > (clock_timestamp() AT TIME ZONE 'UTC') OR
      NOT EXISTS (SELECT 1 FROM "PrivacyMediaDeletionJob" WHERE "uploadSessionId"=source.id) OR
      EXISTS (SELECT 1 FROM "PrivacyMediaDeletionJob" WHERE "uploadSessionId"=source.id AND
        (status <> 'DONE' OR target IS NOT NULL OR "observedAbsentAt" IS NULL OR "observedAbsentAt" < source."cleanupRetainUntil")) THEN
      RAISE EXCEPTION 'Unresolved or unminimized source operation evidence is retained' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id,NEW."sessionId",NEW."requestId",NEW.kind,NEW."requestDigest",NEW."expectedRevision",NEW."createdAt") IS DISTINCT FROM
      ROW(OLD.id,OLD."sessionId",OLD."requestId",OLD.kind,OLD."requestDigest",OLD."expectedRevision",OLD."createdAt") OR
      (OLD."dispatchStartedAt" IS NOT NULL AND NEW."dispatchStartedAt" IS DISTINCT FROM OLD."dispatchStartedAt") OR
      (OLD."providerUploadId" IS NOT NULL AND NEW."providerUploadId" IS DISTINCT FROM OLD."providerUploadId") OR
      (OLD."providerOutcome" = 'ACKNOWLEDGED' AND ROW(NEW."providerOutcome",NEW."providerTerminalAt",NEW."providerUploadId") IS DISTINCT FROM ROW(OLD."providerOutcome",OLD."providerTerminalAt",OLD."providerUploadId")) OR
      (OLD."providerOutcome" = 'UNKNOWN' AND NEW."providerOutcome" = 'NOT_DISPATCHED') THEN
      RAISE EXCEPTION 'Source provider dispatch history is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.kind IN ('CREATE','COMPLETE') AND
    ((NEW."dispatchStartedAt" IS NOT NULL) IS DISTINCT FROM (NEW."providerOutcome" <> 'NOT_DISPATCHED') OR
     (NEW."providerOutcome" = 'ACKNOWLEDGED' AND NEW."providerUploadId" IS NULL)) THEN
    RAISE EXCEPTION 'Finite creating dispatch and provider outcome must agree' USING ERRCODE = '23514';
  END IF;
  IF NEW."providerOutcome" <> 'NOT_DISPATCHED' AND (NEW.kind NOT IN ('CREATE','COMPLETE') OR NEW."dispatchStartedAt" IS NULL) THEN
    RAISE EXCEPTION 'Source provider outcome requires a creating dispatch' USING ERRCODE = '23514';
  END IF;
  IF (TG_OP = 'INSERT' OR OLD."providerOutcome" = 'NOT_DISPATCHED') AND NEW."providerOutcome" <> 'NOT_DISPATCHED' THEN
    IF NEW."providerOutcome" <> 'UNKNOWN' OR source."grantsRevokedAt" IS NOT NULL OR source."cleanupRequestedAt" IS NOT NULL OR
      (NEW.kind = 'CREATE' AND (source.state <> 'PREPARING' OR NEW."providerUploadId" IS NOT NULL)) OR
      (NEW.kind = 'COMPLETE' AND (source.state <> 'FINALIZING' OR NEW."providerUploadId" IS NULL OR NEW."providerUploadId" IS DISTINCT FROM source."providerUploadId")) THEN
      RAISE EXCEPTION 'Source object dispatch requires an unfrozen matching reservation' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "source_operation_v2_guard" BEFORE INSERT OR UPDATE OR DELETE ON "MediaUploadOperation" FOR EACH ROW EXECUTE FUNCTION ayin_source_operation_v2_guard();

CREATE FUNCTION ayin_source_session_v2_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."sourceProtocolVersion" = 2 AND (
      OLD."cleanupRetainUntil" IS NULL OR OLD."cleanupRetainUntil" > (clock_timestamp() AT TIME ZONE 'UTC') OR
      NOT EXISTS (SELECT 1 FROM "PrivacyMediaDeletionJob" WHERE "uploadSessionId"=OLD.id) OR
      EXISTS (SELECT 1 FROM "PrivacyMediaDeletionJob" WHERE "uploadSessionId"=OLD.id AND
        (status <> 'DONE' OR target IS NOT NULL OR "observedAbsentAt" IS NULL OR "observedAbsentAt" < OLD."cleanupRetainUntil"))) THEN
      RAISE EXCEPTION 'Unresolved source custody cannot be detached' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."sourceProtocolVersion" <> 2 THEN RETURN NEW; END IF;
  IF OLD."grantsRevokedAt" IS NOT NULL AND
    (NEW.state NOT IN ('REVOKED','EXPIRED','ABORTED','COMPLETED') OR
     NEW."grantReservationCount" IS DISTINCT FROM OLD."grantReservationCount" OR
     NEW."lastGrantExpiresAt" IS DISTINCT FROM OLD."lastGrantExpiresAt") THEN
    RAISE EXCEPTION 'Frozen finite sources cannot regain grant authority' USING ERRCODE = '23514';
  END IF;
  IF (NEW."initiatingAccountId" IS NOT NULL AND NEW."initiatingAccountId" IS DISTINCT FROM OLD."initiatingAccountId") OR
    (NEW."sourceAssetId" IS NOT NULL AND NEW."sourceAssetId" IS DISTINCT FROM OLD."sourceAssetId") THEN
    RAISE EXCEPTION 'Finite source references allow detachment only' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW."channelId",NEW."objectKey",NEW.mode,NEW."sizeBytes",NEW."partSizeBytes",NEW."mimeType",NEW."creationRequestId",NEW."creationRequestDigest",NEW."grantlessReservationId",NEW."hardExpiresAt") IS DISTINCT FROM
    ROW(OLD."channelId",OLD."objectKey",OLD.mode,OLD."sizeBytes",OLD."partSizeBytes",OLD."mimeType",OLD."creationRequestId",OLD."creationRequestDigest",OLD."grantlessReservationId",OLD."hardExpiresAt") OR
    NEW."grantReservationCount" < OLD."grantReservationCount" OR
    (OLD."lastGrantExpiresAt" IS NOT NULL AND (NEW."lastGrantExpiresAt" IS NULL OR NEW."lastGrantExpiresAt" < OLD."lastGrantExpiresAt")) OR
    (OLD."providerExposureBytes" IS NOT NULL AND (NEW."providerExposureBytes" IS NULL OR NEW."providerExposureBytes" < OLD."providerExposureBytes")) OR
    (OLD."providerUploadId" IS NOT NULL AND NEW."providerUploadId" IS DISTINCT FROM OLD."providerUploadId") OR
    (OLD."grantsRevokedAt" IS NOT NULL AND NEW."grantsRevokedAt" IS DISTINCT FROM OLD."grantsRevokedAt") OR
    (OLD."cleanupRequestedAt" IS NOT NULL AND NEW."cleanupRequestedAt" IS DISTINCT FROM OLD."cleanupRequestedAt") THEN
    RAISE EXCEPTION 'Source custody and granted exposure history are monotonic' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "source_session_v2_guard" BEFORE UPDATE OR DELETE ON "MediaUploadSession" FOR EACH ROW EXECUTE FUNCTION ayin_source_session_v2_guard();

CREATE FUNCTION ayin_output_publication_v2_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "MediaProcessingOutputAttempt";
BEGIN
  IF NEW."outputProtocolVersion" <> 2 THEN RETURN NEW; END IF;
  IF NEW."inputIntegrityVersion" <> 1 THEN
    RAISE EXCEPTION 'Finite output jobs require immutable input integrity' USING ERRCODE = '23514';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status) AND NEW.status IN ('PROCESSING','UPLOADING','VERIFYING','READY') THEN
    SELECT * INTO a FROM "MediaProcessingOutputAttempt" WHERE id=NEW."currentOutputAttemptId";
    IF a.id IS NULL OR a."protocolVersion" <> 2 OR a."writesFrozenAt" IS NOT NULL OR
      current_setting('ayin.media_output_write_version', true) IS DISTINCT FROM '2' THEN
      RAISE EXCEPTION 'Finite output ownership requires a compatible unfrozen journal worker' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "output_publication_v2_guard" BEFORE INSERT OR UPDATE ON "MediaProcessingJob" FOR EACH ROW EXECUTE FUNCTION ayin_output_publication_v2_guard();

CREATE FUNCTION ayin_output_asset_v2_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "MediaProcessingOutputAttempt";
BEGIN
  IF NEW.status = 'VALIDATED' AND (TG_OP = 'INSERT' OR OLD.status <> 'VALIDATED' OR NEW."r2ObjectKey" IS DISTINCT FROM OLD."r2ObjectKey") THEN
    SELECT * INTO a FROM "MediaProcessingOutputAttempt" WHERE prefix = ayin_output_attempt_prefix(NEW."r2ObjectKey");
    IF a."protocolVersion" = 2 AND a."writesFrozenAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Frozen finite output attempts cannot become newly publishable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "output_asset_v2_guard" BEFORE INSERT OR UPDATE ON "MediaAsset" FOR EACH ROW EXECUTE FUNCTION ayin_output_asset_v2_guard();
