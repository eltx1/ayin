-- Required output-key protocol v2. No recovery issuance preceded this slice.
-- Existing required jobs lack provable attempt-write history: refuse those rows
-- rather than manufacture identities or silently reuse a shared output address.
-- Populated legacy (version 0) jobs/assets/generations are not rewritten.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "MediaProcessingJob" WHERE "inputIntegrityVersion" <> 0) THEN
    RAISE EXCEPTION 'Output-attempt migration requires no unsupported pre-attempt integrity jobs' USING ERRCODE = '23514';
  END IF;
END $$;

ALTER TABLE "MediaProcessingJob" ADD COLUMN "currentOutputAttemptId" UUID;
ALTER TABLE "MediaPlaybackGeneration" ADD COLUMN "outputAttemptId" UUID;
CREATE TABLE "MediaProcessingOutputAttempt" (
  id UUID PRIMARY KEY,
  "processingJobId" UUID NOT NULL,
  "channelId" UUID NOT NULL,
  "videoId" UUID NOT NULL,
  generation INTEGER NOT NULL,
  "claimToken" VARCHAR(255) NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  prefix VARCHAR(1024) NOT NULL UNIQUE,
  "canonicalR2ObjectKey" VARCHAR(1024) NOT NULL UNIQUE,
  "hlsR2Prefix" VARCHAR(1024) NOT NULL UNIQUE,
  "thumbnailR2ObjectKey" VARCHAR(1024) NOT NULL UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("processingJobId", "claimToken")
);
CREATE INDEX "MediaProcessingOutputAttempt_processingJobId_createdAt_idx" ON "MediaProcessingOutputAttempt" ("processingJobId", "createdAt");
CREATE INDEX "MediaProcessingOutputAttempt_channelId_idx" ON "MediaProcessingOutputAttempt" ("channelId");
CREATE INDEX "MediaProcessingOutputAttempt_videoId_idx" ON "MediaProcessingOutputAttempt" ("videoId");
-- Read-only queue prefilter. The shared ordered Account/membership/generation/
-- asset/job/video/session fence revalidates this state before allocating an
-- attempt. Stale recovery commits its job locks before any such owner locking.
CREATE FUNCTION ayin_required_media_job_eligible(j "MediaProcessingJob") RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT j."inputIntegrityVersion" = 1 AND j."inputIntegrityRedactedAt" IS NULL
    AND ayin_media_job_has_custody(j)
    AND EXISTS (
      SELECT 1 FROM "Video" v JOIN "Channel" c ON c.id = v."channelId"
      JOIN "MediaAsset" a ON a.id = j."inputIntegritySourceAssetId"
      WHERE v.id = j."videoId" AND v.status <> 'REMOVED' AND v."removedAt" IS NULL
        AND c.status <> 'REMOVED' AND c."removedAt" IS NULL
        AND a."videoId" = v.id AND a."channelId" = c.id AND a."r2ObjectKey" = j."inputR2ObjectKey"
        AND a."sizeBytes" = j."sourceSizeBytes" AND a.status <> 'REMOVED' AND a."removedAt" IS NULL
        AND (j."inputIntegrityParentJobId" IS NOT NULL OR EXISTS (
          SELECT 1 FROM "MediaUploadSession" s WHERE s.id = j."inputIntegritySessionId"
            AND s.state = 'COMPLETED' AND s."cleanupRequestedAt" IS NULL
            AND s."objectKey" = j."inputR2ObjectKey" AND s."sizeBytes" = j."sourceSizeBytes"
            AND s."videoId" = v.id AND s."channelId" = c.id
            AND (s."sourceAssetId" IS NULL OR s."sourceAssetId" = a.id)
        ))
    )
    AND NOT EXISTS (SELECT 1 FROM "MediaProcessingJob" newer WHERE newer."videoId" = j."videoId" AND newer.generation > j.generation)
    AND NOT EXISTS (SELECT 1 FROM "MediaPlaybackGeneration" newer WHERE newer."videoId" = j."videoId" AND newer.generation > j.generation);
$$;

-- Extract only the exact canonical address prefix. Do not lowercase, cast UUID
-- segments, collapse separators or interpret the arbitrary suffix. Equality on
-- the unique prefix index replaces a historical-ledger scan for legacy inputs.
CREATE FUNCTION ayin_output_attempt_prefix(object_key TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT substring(object_key FROM '^(channels/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/videos/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/playback/g[1-9][0-9]*/attempts/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/)');
$$;

-- Address snapshots survive job/video detachment. No cascading FK may erase an
-- unresolved losing attempt. Future physical settlement/retention is gated.
CREATE FUNCTION ayin_output_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j "MediaProcessingJob"; cid UUID; expected TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Media output attempts are append-only until a reviewed settlement protocol exists' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO j FROM "MediaProcessingJob" WHERE id = NEW."processingJobId" FOR UPDATE;
  SELECT "channelId" INTO cid FROM "Video" WHERE id = j."videoId";
  expected := 'channels/' || cid || '/videos/' || j."videoId" || '/playback/g' || j.generation || '/attempts/' || NEW.id || '/';
  IF j.id IS NULL OR j."inputIntegrityVersion" <> 1 OR j.generation < 1 OR j.status <> 'INTEGRITY_QUEUED' OR j."leaseOwner" IS NOT NULL OR NOT ayin_required_media_job_eligible(j) OR
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
CREATE TRIGGER "output_attempt_guard" BEFORE INSERT OR UPDATE OR DELETE ON "MediaProcessingOutputAttempt" FOR EACH ROW EXECUTE FUNCTION ayin_output_attempt_guard();

CREATE OR REPLACE FUNCTION ayin_media_job_integrity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE output_attempt "MediaProcessingOutputAttempt";
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."inputIntegrityVersion" IS DISTINCT FROM OLD."inputIntegrityVersion" OR
      (OLD."inputIntegrityVersion" <> 0 AND ROW(NEW."videoId", NEW."generation", NEW."sourceMimeType", NEW."sourceSizeBytes", NEW."stagingKey", NEW."inputR2ObjectKey", NEW."inputIntegritySessionId", NEW."inputIntegritySourceAssetId", NEW."inputIntegrityAccountId", NEW."inputIntegrityOwnerlessPlatform", NEW."inputIntegrityParentJobId", NEW."inputIntegrityAlgorithm") IS DISTINCT FROM ROW(OLD."videoId", OLD."generation", OLD."sourceMimeType", OLD."sourceSizeBytes", OLD."stagingKey", OLD."inputR2ObjectKey", OLD."inputIntegritySessionId", OLD."inputIntegritySourceAssetId", OLD."inputIntegrityAccountId", OLD."inputIntegrityOwnerlessPlatform", OLD."inputIntegrityParentJobId", OLD."inputIntegrityAlgorithm")) THEN
      RAISE EXCEPTION 'Media job input integrity contract is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD."inputIntegrityVersion" <> 0 THEN
      IF OLD."inputIntegrityRedactedAt" IS NOT NULL AND
        (NEW.status <> 'CANCELLED' OR NEW."inputIntegrityRedactedAt" IS DISTINCT FROM OLD."inputIntegrityRedactedAt" OR NEW."inputIntegrityDigest" IS NOT NULL OR NEW."outputIntegrityDigest" IS NOT NULL OR NEW."inputVerifiedAt" IS NOT NULL) THEN
        RAISE EXCEPTION 'Redacted media integrity jobs cannot restart or restore identity' USING ERRCODE = '23514';
      END IF;
      IF (NEW."inputIntegrityDigest" IS DISTINCT FROM OLD."inputIntegrityDigest" OR NEW."inputIntegrityRedactedAt" IS DISTINCT FROM OLD."inputIntegrityRedactedAt") AND NOT
        (OLD."inputIntegrityRedactedAt" IS NULL AND OLD."inputIntegrityDigest" IS NOT NULL AND NEW.status = 'CANCELLED' AND NEW."inputIntegrityDigest" IS NULL AND NEW."inputIntegrityRedactedAt" IS NOT NULL AND NEW."outputIntegrityDigest" IS NULL AND NEW."inputVerifiedAt" IS NULL) THEN
        RAISE EXCEPTION 'Input identity allows only terminal cancellation redaction' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  IF NEW."inputIntegrityVersion" = 0 THEN RETURN NEW; END IF;
  -- Old queue binaries only select QUEUED. Keep their legacy lane usable, even
  -- when an old stale-recovery UPDATE requeues an integrity job.
  IF NEW.status = 'QUEUED' THEN
    NEW.status := 'INTEGRITY_QUEUED';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."currentOutputAttemptId" IS NOT NULL THEN
    RAISE EXCEPTION 'Output attempts may only be assigned by an owned claim' USING ERRCODE = '23514';
  END IF;
  IF NEW."currentOutputAttemptId" IS NOT NULL THEN
    SELECT * INTO output_attempt FROM "MediaProcessingOutputAttempt" WHERE id = NEW."currentOutputAttemptId";
    IF output_attempt.id IS NULL OR output_attempt."processingJobId" IS DISTINCT FROM NEW.id OR
      (NEW.status IN ('PROCESSING', 'UPLOADING', 'VERIFYING', 'READY') AND output_attempt.attempt IS DISTINCT FROM NEW.attempt) OR output_attempt."canonicalR2ObjectKey" IS DISTINCT FROM NEW."outputR2ObjectKey" THEN
      RAISE EXCEPTION 'Media output attempt does not match the job namespace' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."currentOutputAttemptId" IS DISTINCT FROM OLD."currentOutputAttemptId" OR NEW."outputR2ObjectKey" IS DISTINCT FROM OLD."outputR2ObjectKey" OR NEW.attempt IS DISTINCT FROM OLD.attempt) AND NOT (
    OLD.status = 'INTEGRITY_QUEUED' AND OLD."leaseOwner" IS NULL AND NEW.status = 'PROCESSING' AND NEW."leaseOwner" IS NOT NULL AND
    NEW.attempt = OLD.attempt + 1 AND NEW."currentOutputAttemptId" IS NOT NULL AND NEW."currentOutputAttemptId" IS DISTINCT FROM OLD."currentOutputAttemptId" AND
    output_attempt."claimToken" = NEW."leaseOwner" AND current_setting('ayin.media_integrity_worker_version', true) = '2'
  ) AND NOT (
    -- Preserve the existing bounded operator retry budget. The numeric counter
    -- may reset; UUID/token addresses never reset or repeat, and the ledger's
    -- original count remains immutable. No queued row is eligible for writes.
    OLD.status = 'FAILED' AND NEW.status = 'INTEGRITY_QUEUED' AND NEW.attempt = 0 AND NEW."leaseOwner" IS NULL AND
    NEW."currentOutputAttemptId" IS NOT DISTINCT FROM OLD."currentOutputAttemptId" AND NEW."outputR2ObjectKey" IS NOT DISTINCT FROM OLD."outputR2ObjectKey"
  ) THEN
    RAISE EXCEPTION 'Output addresses may change only to a fresh compatible claim attempt' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('PROCESSING', 'UPLOADING', 'VERIFYING', 'READY') AND (
    NEW."currentOutputAttemptId" IS NULL OR output_attempt."claimToken" IS DISTINCT FROM CASE WHEN NEW.status = 'READY' THEN OLD."leaseOwner" ELSE NEW."leaseOwner" END
  ) THEN
    RAISE EXCEPTION 'Captured output attempt required for processing and readiness' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('PROCESSING', 'UPLOADING', 'VERIFYING', 'READY') AND
    (TG_OP = 'INSERT' OR NEW."leaseOwner" IS DISTINCT FROM OLD."leaseOwner" OR NEW.status = 'READY') AND
    current_setting('ayin.media_integrity_worker_version', true) IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION 'Compatible integrity worker required' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'READY' THEN
    IF NOT ayin_media_job_has_custody(NEW) OR TG_OP = 'INSERT' OR OLD."leaseOwner" IS NULL OR OLD."leaseExpiresAt" IS NULL OR OLD."leaseExpiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC') OR
      NEW."inputVerifiedAt" IS NULL OR NEW."inputVerifiedLeaseOwner" IS DISTINCT FROM OLD."leaseOwner" OR
      NEW."inputVerifiedAttempt" IS DISTINCT FROM OLD.attempt OR
      NEW."outputIntegrityDigest" IS NULL OR NEW."outputIntegritySizeBytes" IS DISTINCT FROM NEW."outputSizeBytes" OR NEW."outputVerifiedAt" IS NULL OR
      (NEW."inputIntegrityParentJobId" IS NULL AND NOT EXISTS (SELECT 1 FROM "MediaUploadSession" s WHERE s.id = NEW."inputIntegritySessionId" AND s.state = 'COMPLETED' AND s."cleanupRequestedAt" IS NULL)) THEN
      RAISE EXCEPTION 'Current owned byte verification required before READY' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION ayin_adaptive_integrity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE aid UUID; output_attempt "MediaProcessingOutputAttempt"; jid UUID; vid UUID; gen INTEGER; fallback TEXT; master TEXT; cid UUID; j "MediaProcessingJob";
BEGIN
  IF TG_TABLE_NAME = 'MediaPlaybackGeneration' THEN
    aid := NEW."outputAttemptId"; jid := NEW."processingJobId"; vid := NEW."videoId"; gen := NEW.generation; fallback := NEW."fallbackR2ObjectKey"; master := NEW."hlsMasterR2ObjectKey";
    IF NEW.status <> 'READY' AND NEW."fallbackStatus" <> 'READY' AND NEW."hlsMasterStatus" <> 'READY' THEN RETURN NEW; END IF;
    -- Privacy removal may leave historical generation.status=READY while
    -- tombstoning its outputs. Guard eligibility increases, never block removal.
    IF TG_OP = 'UPDATE' AND NOT (
      (NEW.status = 'READY' AND NEW.status IS DISTINCT FROM OLD.status) OR
      (NEW."fallbackStatus" = 'READY' AND NEW."fallbackStatus" IS DISTINCT FROM OLD."fallbackStatus") OR
      (NEW."hlsMasterStatus" = 'READY' AND NEW."hlsMasterStatus" IS DISTINCT FROM OLD."hlsMasterStatus") OR
      ROW(NEW."processingJobId", NEW."videoId", NEW.generation, NEW."outputAttemptId", NEW."fallbackR2ObjectKey", NEW."hlsMasterR2ObjectKey") IS DISTINCT FROM ROW(OLD."processingJobId", OLD."videoId", OLD.generation, OLD."outputAttemptId", OLD."fallbackR2ObjectKey", OLD."hlsMasterR2ObjectKey")) THEN RETURN NEW; END IF;
  ELSE
    IF NEW.status <> 'READY' OR (TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status AND ROW(NEW."playbackGenerationId", NEW.identity, NEW."playlistR2ObjectKey", NEW."segmentR2Prefix") IS NOT DISTINCT FROM ROW(OLD."playbackGenerationId", OLD.identity, OLD."playlistR2ObjectKey", OLD."segmentR2Prefix")) THEN RETURN NEW; END IF;
    SELECT "processingJobId", "videoId", generation, "fallbackR2ObjectKey", "hlsMasterR2ObjectKey", "outputAttemptId" INTO jid, vid, gen, fallback, master, aid FROM "MediaPlaybackGeneration" WHERE id = NEW."playbackGenerationId";
  END IF;
  -- Namespace identity is authoritative even if an old sidecar is unbound or
  -- incorrectly points at a legacy job from another generation.
  SELECT * INTO j FROM "MediaProcessingJob" WHERE "videoId" = vid AND generation = gen;
  IF j.id IS NULL THEN SELECT * INTO j FROM "MediaProcessingJob" WHERE id = jid; END IF;
  IF j."inputIntegrityVersion" IS NULL OR j."inputIntegrityVersion" = 0 THEN RETURN NEW; END IF;
  SELECT "channelId" INTO cid FROM "Video" WHERE id = j."videoId";
  SELECT * INTO output_attempt FROM "MediaProcessingOutputAttempt" WHERE id = aid;
  IF TG_TABLE_NAME = 'MediaPlaybackRendition' THEN
    IF output_attempt.id IS NULL OR NEW."playlistR2ObjectKey" IS DISTINCT FROM output_attempt."hlsR2Prefix" || NEW.identity || '/index.m3u8' OR NEW."segmentR2Prefix" IS DISTINCT FROM output_attempt."hlsR2Prefix" || NEW.identity || '/segment-' THEN
      RAISE EXCEPTION 'Adaptive rendition keys must match the captured output attempt' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF output_attempt.id IS NULL OR aid IS DISTINCT FROM j."currentOutputAttemptId" OR output_attempt."processingJobId" IS DISTINCT FROM j.id OR output_attempt."claimToken" IS DISTINCT FROM j."leaseOwner" OR output_attempt.attempt IS DISTINCT FROM j.attempt OR NOT ayin_media_job_has_custody(j) OR jid IS DISTINCT FROM j.id OR j."videoId" IS DISTINCT FROM vid OR j.generation IS DISTINCT FROM gen OR
    fallback IS DISTINCT FROM j."outputR2ObjectKey" OR master IS DISTINCT FROM output_attempt."hlsR2Prefix" || 'master.m3u8'  OR current_setting('ayin.media_integrity_worker_version', true) IS DISTINCT FROM '2' OR
    j.status NOT IN ('PROCESSING','UPLOADING','VERIFYING') OR j."leaseOwner" IS NULL OR
    j."leaseExpiresAt" IS NULL OR j."leaseExpiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC') OR
    j."inputVerifiedAt" IS NULL OR j."inputVerifiedLeaseOwner" IS DISTINCT FROM j."leaseOwner" OR
    j."inputVerifiedAttempt" IS DISTINCT FROM j.attempt OR j."outputVerifiedAt" IS NULL OR
    (j."inputIntegrityParentJobId" IS NULL AND NOT EXISTS (SELECT 1 FROM "MediaUploadSession" s WHERE s.id = j."inputIntegritySessionId" AND s.state = 'COMPLETED' AND s."cleanupRequestedAt" IS NULL)) THEN
    RAISE EXCEPTION 'Current byte verification required for adaptive readiness' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER "adaptive_generation_integrity_guard" ON "MediaPlaybackGeneration";
CREATE TRIGGER "adaptive_generation_integrity_guard" BEFORE INSERT OR UPDATE OF status, "fallbackStatus", "hlsMasterStatus", "processingJobId", "videoId", generation, "outputAttemptId", "fallbackR2ObjectKey", "hlsMasterR2ObjectKey" ON "MediaPlaybackGeneration" FOR EACH ROW EXECUTE FUNCTION ayin_adaptive_integrity_guard();
DROP TRIGGER "adaptive_rendition_integrity_guard" ON "MediaPlaybackRendition";
CREATE TRIGGER "adaptive_rendition_integrity_guard" BEFORE INSERT OR UPDATE OF status, "playbackGenerationId", identity, "playlistR2ObjectKey", "segmentR2Prefix" ON "MediaPlaybackRendition" FOR EACH ROW EXECUTE FUNCTION ayin_adaptive_integrity_guard();


CREATE OR REPLACE FUNCTION ayin_upload_integrity_marker() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_key TEXT;
BEGIN
  IF NEW."sourceAssetId" IS NULL OR (TG_OP = 'UPDATE' AND NEW."sourceAssetId" IS NOT DISTINCT FROM OLD."sourceAssetId") THEN RETURN NEW; END IF;
  -- A new recovery declaration cannot retrofit an already-processing legacy
  -- source/canonical. SHARE in the job-insert guard serializes both race orders.
  SELECT "r2ObjectKey" INTO source_key FROM "MediaAsset" WHERE id = NEW."sourceAssetId" FOR NO KEY UPDATE;
  IF EXISTS (SELECT 1 FROM "MediaProcessingJob" WHERE "inputR2ObjectKey" = source_key OR "stagingKey" = source_key OR "outputR2ObjectKey" = source_key OR "finalAssetId" = NEW."sourceAssetId") THEN
    RAISE EXCEPTION 'Recovery cannot be attached to an existing processing identity' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "MediaProcessingOutputAttempt" WHERE prefix = ayin_output_attempt_prefix(source_key)) THEN
    RAISE EXCEPTION 'Recovery cannot be attached to an existing output attempt identity' USING ERRCODE = '23514';
  END IF;
  UPDATE "MediaAsset" SET "uploadIntegrityRequired" = true WHERE id = NEW."sourceAssetId";
  RETURN NEW;
END $$;


CREATE OR REPLACE FUNCTION ayin_reject_legacy_integrity_input() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_record RECORD;
BEGIN
  IF NEW."inputIntegrityVersion" = 0 THEN
    IF EXISTS (SELECT 1 FROM "MediaProcessingOutputAttempt" WHERE prefix IN (ayin_output_attempt_prefix(NEW."inputR2ObjectKey"), ayin_output_attempt_prefix(NEW."stagingKey"))) THEN
      RAISE EXCEPTION 'Required output attempt cannot enter a legacy job' USING ERRCODE = '23514';
    END IF;
    FOR source_record IN SELECT id, "uploadIntegrityRequired" FROM "MediaAsset"
      WHERE "r2ObjectKey" IN (NEW."inputR2ObjectKey", NEW."stagingKey") ORDER BY id FOR SHARE
    LOOP
      IF source_record."uploadIntegrityRequired" THEN RAISE EXCEPTION 'Required-integrity source cannot enter a legacy job' USING ERRCODE = '23514'; END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
