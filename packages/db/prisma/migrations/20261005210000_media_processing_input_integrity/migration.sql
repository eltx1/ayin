ALTER TYPE "MediaProcessingJobStatus" ADD VALUE 'INTEGRITY_QUEUED';
-- Additive, dormant worker prerequisite. Existing jobs remain explicit legacy.
ALTER TABLE "MediaProcessingJob"
  ADD COLUMN "inputIntegrityVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "inputIntegritySessionId" UUID,
  ADD COLUMN "inputIntegritySourceAssetId" UUID,
  ADD COLUMN "inputIntegrityAccountId" UUID,
  ADD COLUMN "inputIntegrityOwnerlessPlatform" BOOLEAN,
  ADD COLUMN "inputIntegrityParentJobId" UUID,
  ADD COLUMN "inputIntegrityAlgorithm" VARCHAR(32),
  ADD COLUMN "inputIntegrityDigest" CHAR(64),
  ADD COLUMN "inputIntegrityRedactedAt" TIMESTAMP(3),
  ADD COLUMN "inputVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "inputVerifiedLeaseOwner" VARCHAR(255),
  ADD COLUMN "inputVerifiedAttempt" INTEGER,
  ADD COLUMN "outputIntegrityDigest" CHAR(64),
  ADD COLUMN "outputIntegritySizeBytes" BIGINT,
  ADD COLUMN "outputVerifiedAt" TIMESTAMP(3),
  ADD CONSTRAINT "media_job_input_integrity_shape" CHECK (
    ("inputIntegrityVersion" = 0 AND "inputIntegritySessionId" IS NULL AND
      "inputIntegritySourceAssetId" IS NULL AND "inputIntegrityAccountId" IS NULL AND "inputIntegrityOwnerlessPlatform" IS NULL AND
      "inputIntegrityParentJobId" IS NULL AND "inputIntegrityAlgorithm" IS NULL AND
      "inputIntegrityDigest" IS NULL AND "inputIntegrityRedactedAt" IS NULL) OR
    ("inputIntegrityVersion" = 1 AND "inputIntegritySessionId" IS NOT NULL AND
      "inputIntegritySourceAssetId" IS NOT NULL AND "inputIntegrityAccountId" IS NOT NULL AND "inputIntegrityOwnerlessPlatform" IS NOT NULL AND
      "inputIntegrityAlgorithm" IS NOT NULL AND "inputIntegrityAlgorithm" = 'AYIN_SHA256_CHUNKS_V1' AND
      (("inputIntegrityDigest" IS NOT NULL AND "inputIntegrityDigest" ~ '^[0-9a-f]{64}$' AND "inputIntegrityRedactedAt" IS NULL) OR ("inputIntegrityDigest" IS NULL AND "inputIntegrityRedactedAt" IS NOT NULL AND status = 'CANCELLED')) AND
      "inputR2ObjectKey" IS NOT NULL AND length(btrim("inputR2ObjectKey")) > 0 AND
      "sourceSizeBytes" BETWEEN 1 AND 53687091200)
  ),
  ADD CONSTRAINT "media_job_output_integrity_shape" CHECK (
    ("outputIntegrityDigest" IS NULL AND "outputIntegritySizeBytes" IS NULL AND "outputVerifiedAt" IS NULL) OR
    ("outputIntegrityDigest" IS NOT NULL AND "outputIntegrityDigest" ~ '^[0-9a-f]{64}$' AND
      "outputIntegritySizeBytes" IS NOT NULL AND "outputIntegritySizeBytes" BETWEEN 1 AND 53687091200 AND "outputVerifiedAt" IS NOT NULL)
  );

-- Accepted custody is server-derived, never inferred from missing memberships.
CREATE FUNCTION ayin_media_job_has_custody(j "MediaProcessingJob") RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT j."inputIntegrityVersion" = 0 OR EXISTS (
    SELECT 1 FROM "Video" v JOIN "ChannelMember" m ON m."channelId" = v."channelId"
      JOIN "Account" a ON a.id = m."accountId"
    WHERE v.id = j."videoId" AND m.role = 'OWNER' AND a.status = 'ACTIVE'
  ) OR (j."inputIntegrityOwnerlessPlatform" = true AND EXISTS (
    SELECT 1 FROM "Video" v JOIN "Channel" c ON c.id = v."channelId"
    WHERE v.id = j."videoId" AND c."isPlatformOwned" = true AND NOT EXISTS (
      SELECT 1 FROM "ChannelMember" m WHERE m."channelId" = c.id AND m.role = 'OWNER'
    )
  ));
$$;

-- No FKs to mutable sidecars: detachment/deletion cannot silently downgrade a job.
CREATE FUNCTION ayin_media_job_integrity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."inputIntegrityVersion" IS DISTINCT FROM OLD."inputIntegrityVersion" OR
      (OLD."inputIntegrityVersion" <> 0 AND ROW(NEW."videoId", NEW."generation", NEW."sourceMimeType", NEW."sourceSizeBytes", NEW."stagingKey", NEW."inputR2ObjectKey", NEW."outputR2ObjectKey", NEW."inputIntegritySessionId", NEW."inputIntegritySourceAssetId", NEW."inputIntegrityAccountId", NEW."inputIntegrityOwnerlessPlatform", NEW."inputIntegrityParentJobId", NEW."inputIntegrityAlgorithm") IS DISTINCT FROM ROW(OLD."videoId", OLD."generation", OLD."sourceMimeType", OLD."sourceSizeBytes", OLD."stagingKey", OLD."inputR2ObjectKey", OLD."outputR2ObjectKey", OLD."inputIntegritySessionId", OLD."inputIntegritySourceAssetId", OLD."inputIntegrityAccountId", OLD."inputIntegrityOwnerlessPlatform", OLD."inputIntegrityParentJobId", OLD."inputIntegrityAlgorithm")) THEN
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
  IF NEW.status IN ('PROCESSING', 'UPLOADING', 'VERIFYING', 'READY') AND
    (TG_OP = 'INSERT' OR NEW."leaseOwner" IS DISTINCT FROM OLD."leaseOwner" OR NEW.status = 'READY') AND
    current_setting('ayin.media_integrity_worker_version', true) IS DISTINCT FROM '1' THEN
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
CREATE TRIGGER "media_job_integrity_guard" BEFORE INSERT OR UPDATE ON "MediaProcessingJob" FOR EACH ROW EXECUTE FUNCTION ayin_media_job_integrity_guard();

-- Remember that an asset entered the protocol independently of its mutable
-- session sidecar. This prevents a deletion/detachment before enqueue downgrade.
ALTER TABLE "MediaAsset" ADD COLUMN "uploadIntegrityRequired" BOOLEAN NOT NULL DEFAULT false;
UPDATE "MediaAsset" SET "uploadIntegrityRequired" = true
  WHERE id IN (SELECT "sourceAssetId" FROM "MediaUploadSession" WHERE "sourceAssetId" IS NOT NULL);
CREATE FUNCTION ayin_upload_integrity_marker() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_key TEXT;
BEGIN
  IF NEW."sourceAssetId" IS NULL OR (TG_OP = 'UPDATE' AND NEW."sourceAssetId" IS NOT DISTINCT FROM OLD."sourceAssetId") THEN RETURN NEW; END IF;
  -- A new recovery declaration cannot retrofit an already-processing legacy
  -- source/canonical. SHARE in the job-insert guard serializes both race orders.
  SELECT "r2ObjectKey" INTO source_key FROM "MediaAsset" WHERE id = NEW."sourceAssetId" FOR NO KEY UPDATE;
  IF EXISTS (SELECT 1 FROM "MediaProcessingJob" WHERE "inputR2ObjectKey" = source_key OR "stagingKey" = source_key OR "outputR2ObjectKey" = source_key OR "finalAssetId" = NEW."sourceAssetId") THEN
    RAISE EXCEPTION 'Recovery cannot be attached to an existing processing identity' USING ERRCODE = '23514';
  END IF;
  UPDATE "MediaAsset" SET "uploadIntegrityRequired" = true WHERE id = NEW."sourceAssetId";
  RETURN NEW;
END $$;
CREATE TRIGGER "upload_integrity_marker" BEFORE INSERT OR UPDATE OF "sourceAssetId" ON "MediaUploadSession" FOR EACH ROW EXECUTE FUNCTION ayin_upload_integrity_marker();
CREATE FUNCTION ayin_preserve_upload_integrity_marker() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."uploadIntegrityRequired" AND NOT NEW."uploadIntegrityRequired" THEN
    RAISE EXCEPTION 'Upload integrity requirement cannot be downgraded' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "preserve_upload_integrity_marker" BEFORE UPDATE OF "uploadIntegrityRequired" ON "MediaAsset" FOR EACH ROW EXECUTE FUNCTION ayin_preserve_upload_integrity_marker();
CREATE FUNCTION ayin_reject_legacy_integrity_input() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_record RECORD;
BEGIN
  IF NEW."inputIntegrityVersion" = 0 THEN
    FOR source_record IN SELECT id, "uploadIntegrityRequired" FROM "MediaAsset"
      WHERE "r2ObjectKey" IN (NEW."inputR2ObjectKey", NEW."stagingKey") ORDER BY id FOR SHARE
    LOOP
      IF source_record."uploadIntegrityRequired" THEN RAISE EXCEPTION 'Required-integrity source cannot enter a legacy job' USING ERRCODE = '23514'; END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "reject_legacy_integrity_input" BEFORE INSERT OR UPDATE OF "inputR2ObjectKey", "stagingKey" ON "MediaProcessingJob" FOR EACH ROW EXECUTE FUNCTION ayin_reject_legacy_integrity_input();

-- The readiness boundary is also guarded at storage level. Older binaries do
-- not set this transaction-local capability and cannot claim or ready V1 jobs.
CREATE FUNCTION ayin_adaptive_integrity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE jid UUID; vid UUID; gen INTEGER; fallback TEXT; master TEXT; cid UUID; j "MediaProcessingJob";
BEGIN
  IF TG_TABLE_NAME = 'MediaPlaybackGeneration' THEN
    jid := NEW."processingJobId"; vid := NEW."videoId"; gen := NEW.generation; fallback := NEW."fallbackR2ObjectKey"; master := NEW."hlsMasterR2ObjectKey";
    IF NEW.status <> 'READY' AND NEW."fallbackStatus" <> 'READY' AND NEW."hlsMasterStatus" <> 'READY' THEN RETURN NEW; END IF;
    -- Privacy removal may leave historical generation.status=READY while
    -- tombstoning its outputs. Guard eligibility increases, never block removal.
    IF TG_OP = 'UPDATE' AND NOT (
      (NEW.status = 'READY' AND NEW.status IS DISTINCT FROM OLD.status) OR
      (NEW."fallbackStatus" = 'READY' AND NEW."fallbackStatus" IS DISTINCT FROM OLD."fallbackStatus") OR
      (NEW."hlsMasterStatus" = 'READY' AND NEW."hlsMasterStatus" IS DISTINCT FROM OLD."hlsMasterStatus")) THEN RETURN NEW; END IF;
  ELSE
    IF NEW.status <> 'READY' OR (TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status) THEN RETURN NEW; END IF;
    SELECT "processingJobId", "videoId", generation, "fallbackR2ObjectKey", "hlsMasterR2ObjectKey" INTO jid, vid, gen, fallback, master FROM "MediaPlaybackGeneration" WHERE id = NEW."playbackGenerationId";
  END IF;
  -- Namespace identity is authoritative even if an old sidecar is unbound or
  -- incorrectly points at a legacy job from another generation.
  SELECT * INTO j FROM "MediaProcessingJob" WHERE "videoId" = vid AND generation = gen;
  IF j.id IS NULL THEN SELECT * INTO j FROM "MediaProcessingJob" WHERE id = jid; END IF;
  IF j."inputIntegrityVersion" IS NULL OR j."inputIntegrityVersion" = 0 THEN RETURN NEW; END IF;
  SELECT "channelId" INTO cid FROM "Video" WHERE id = j."videoId";
  IF NOT ayin_media_job_has_custody(j) OR jid IS DISTINCT FROM j.id OR j."videoId" IS DISTINCT FROM vid OR j.generation IS DISTINCT FROM gen OR
    fallback IS DISTINCT FROM j."outputR2ObjectKey" OR master IS DISTINCT FROM ('channels/' || cid || '/videos/' || vid || '/playback/g' || gen || '/hls/master.m3u8') OR current_setting('ayin.media_integrity_worker_version', true) IS DISTINCT FROM '1' OR
    j.status NOT IN ('PROCESSING','UPLOADING','VERIFYING') OR j."leaseOwner" IS NULL OR
    j."leaseExpiresAt" IS NULL OR j."leaseExpiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC') OR
    j."inputVerifiedAt" IS NULL OR j."inputVerifiedLeaseOwner" IS DISTINCT FROM j."leaseOwner" OR
    j."inputVerifiedAttempt" IS DISTINCT FROM j.attempt OR j."outputVerifiedAt" IS NULL OR
    (j."inputIntegrityParentJobId" IS NULL AND NOT EXISTS (SELECT 1 FROM "MediaUploadSession" s WHERE s.id = j."inputIntegritySessionId" AND s.state = 'COMPLETED' AND s."cleanupRequestedAt" IS NULL)) THEN
    RAISE EXCEPTION 'Current byte verification required for adaptive readiness' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "adaptive_generation_integrity_guard" BEFORE INSERT OR UPDATE OF status, "fallbackStatus", "hlsMasterStatus" ON "MediaPlaybackGeneration" FOR EACH ROW EXECUTE FUNCTION ayin_adaptive_integrity_guard();
CREATE TRIGGER "adaptive_rendition_integrity_guard" BEFORE INSERT OR UPDATE OF status ON "MediaPlaybackRendition" FOR EACH ROW EXECUTE FUNCTION ayin_adaptive_integrity_guard();

CREATE FUNCTION ayin_media_input_lineage_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source "MediaAsset"; session "MediaUploadSession"; parent "MediaProcessingJob";
BEGIN
  IF NEW."inputIntegrityVersion" = 0 THEN RETURN NEW; END IF;
  -- Every new accepted job, including explicit canonical reprocessing, captures
  -- acceptance while ownerless AND explicitly platform-owned. A platform flag
  -- alone is insufficient when OWNER memberships exist. Caller values are ignored.
  SELECT c."isPlatformOwned" AND NOT EXISTS (SELECT 1 FROM "ChannelMember" m WHERE m."channelId" = c.id AND m.role = 'OWNER')
    INTO NEW."inputIntegrityOwnerlessPlatform" FROM "Channel" c
    JOIN "Video" v ON v."channelId" = c.id WHERE v.id = NEW."videoId" FOR SHARE OF c;
  SELECT * INTO source FROM "MediaAsset" WHERE id = NEW."inputIntegritySourceAssetId" FOR SHARE;
  IF source.id IS NULL OR NOT source."uploadIntegrityRequired" OR source."removedAt" IS NOT NULL OR
    source.status = 'REMOVED' OR source."videoId" IS DISTINCT FROM NEW."videoId" OR
    source."r2ObjectKey" IS DISTINCT FROM NEW."inputR2ObjectKey" OR source."sizeBytes" IS DISTINCT FROM NEW."sourceSizeBytes" THEN
    RAISE EXCEPTION 'The integrity input source no longer matches the job' USING ERRCODE = '23514';
  END IF;
  IF NEW."inputIntegrityParentJobId" IS NULL THEN
    SELECT * INTO session FROM "MediaUploadSession" WHERE id = NEW."inputIntegritySessionId" FOR SHARE;
    IF session.id IS NULL OR session.state <> 'COMPLETED' OR
      session."sourceAssetId" IS DISTINCT FROM source.id OR session."videoId" IS DISTINCT FROM NEW."videoId" OR
      session."initiatingAccountId" IS DISTINCT FROM NEW."inputIntegrityAccountId" OR
      session."objectKey" IS DISTINCT FROM NEW."inputR2ObjectKey" OR session."sizeBytes" IS DISTINCT FROM NEW."sourceSizeBytes" OR
      session."contentIdentityAlgorithm" IS DISTINCT FROM NEW."inputIntegrityAlgorithm" OR
      session."contentIdentityDigest" IS DISTINCT FROM NEW."inputIntegrityDigest" THEN
      RAISE EXCEPTION 'The original source integrity declaration no longer matches' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO parent FROM "MediaProcessingJob" WHERE id = NEW."inputIntegrityParentJobId" FOR SHARE;
    IF parent.id IS NULL OR parent.status <> 'READY' OR parent."inputIntegrityVersion" <> 1 OR
      parent."videoId" IS DISTINCT FROM NEW."videoId" OR parent.generation >= NEW.generation OR
      parent."finalAssetId" IS DISTINCT FROM source.id OR parent."outputVerifiedAt" IS NULL OR
      parent."inputIntegritySessionId" IS DISTINCT FROM NEW."inputIntegritySessionId" OR
      parent."inputIntegrityAccountId" IS DISTINCT FROM NEW."inputIntegrityAccountId" OR
      parent."outputR2ObjectKey" IS DISTINCT FROM NEW."inputR2ObjectKey" OR
      parent."outputIntegritySizeBytes" IS DISTINCT FROM NEW."sourceSizeBytes" OR
      parent."outputIntegrityDigest" IS DISTINCT FROM NEW."inputIntegrityDigest" THEN
      RAISE EXCEPTION 'Trusted transformed canonical lineage is required' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "media_input_lineage_guard" BEFORE INSERT ON "MediaProcessingJob" FOR EACH ROW EXECUTE FUNCTION ayin_media_input_lineage_guard();

CREATE FUNCTION ayin_reset_required_job_namespace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."inputIntegrityVersion" <> 0 THEN
    UPDATE "MediaPlaybackGeneration" SET status = 'BUILDING', "readyAt" = NULL, "fallbackStatus" = 'PLANNED', "hlsMasterStatus" = 'PLANNED' WHERE "videoId" = NEW."videoId" AND generation = NEW.generation;
    UPDATE "MediaPlaybackRendition" SET status = 'PLANNED', "readyAt" = NULL WHERE "playbackGenerationId" IN (SELECT id FROM "MediaPlaybackGeneration" WHERE "videoId" = NEW."videoId" AND generation = NEW.generation);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "reset_required_job_namespace" AFTER INSERT ON "MediaProcessingJob" FOR EACH ROW EXECUTE FUNCTION ayin_reset_required_job_namespace();
