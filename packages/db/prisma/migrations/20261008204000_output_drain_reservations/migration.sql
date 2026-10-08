-- Additive only: no V1 or previously dispatched byte history is relabelled.
CREATE TABLE "MediaProcessingOutputReservation" (
  id UUID NOT NULL PRIMARY KEY,
  "uploadSessionId" UUID UNIQUE,
  "processingJobId" UUID UNIQUE,
  "accountId" UUID NOT NULL,
  "channelId" UUID NOT NULL,
  "envelopeBytes" BIGINT NOT NULL CHECK ("envelopeBytes" > 0),
  "dispatchedBytes" BIGINT NOT NULL DEFAULT 0 CHECK ("dispatchedBytes" >= 0 AND "dispatchedBytes" <= "envelopeBytes"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("uploadSessionId" IS NOT NULL OR "processingJobId" IS NOT NULL)
);
-- These are immutable identity snapshots, not cascading lifecycle FKs.
CREATE INDEX "MediaProcessingOutputReservation_accountId_idx" ON "MediaProcessingOutputReservation" ("accountId");
CREATE INDEX "MediaProcessingOutputReservation_channelId_idx" ON "MediaProcessingOutputReservation" ("channelId");

-- Minimize identity snapshots only after every possible writer/reference and
-- exact retained address is gone. A cancelled grantless/no-output lineage may
-- finish; UNKNOWN, retryable jobs and retained attempts always keep the counter.
CREATE FUNCTION ayin_output_reservation_minimizable(reservation_id UUID) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "MediaProcessingOutputReservation" r WHERE r.id=reservation_id
      AND NOT EXISTS (SELECT 1 FROM "MediaUploadSession" s WHERE s.id=r."uploadSessionId")
      AND NOT EXISTS (SELECT 1 FROM "MediaProcessingJob" j WHERE j.id=r."processingJobId")
      AND NOT EXISTS (SELECT 1 FROM "MediaProcessingOutputAttempt" a WHERE a."processingJobId"=r."processingJobId")
      AND NOT EXISTS (SELECT 1 FROM "MediaProcessingOutputWrite" w WHERE w."processingJobId"=r."processingJobId")
      AND (CASE WHEN r."uploadSessionId" IS NOT NULL THEN EXISTS (
        SELECT 1 FROM "PrivacyMediaDeletionJob" c WHERE c."uploadSessionId"=r."uploadSessionId"
      ) ELSE r."dispatchedBytes"=0 OR EXISTS (
        SELECT 1 FROM "PrivacyMediaDeletionJob" c WHERE c."processingJobId"=r."processingJobId"
      ) END)
      AND NOT EXISTS (
        SELECT 1 FROM "PrivacyMediaDeletionJob" c WHERE
          (c."uploadSessionId"=r."uploadSessionId" OR c."processingJobId"=r."processingJobId") AND
          (c."cleanupContractVersion"<>2 OR c.status<>'DONE' OR c.target IS NOT NULL OR
            c."providerUploadId" IS NOT NULL OR c."retainUntil" IS NULL OR
            c."retainUntil">(clock_timestamp() AT TIME ZONE 'UTC') OR c."observedAbsentAt" IS NULL OR
            c."observedAbsentAt"<c."retainUntil" OR c."recheckAt" IS NOT NULL OR
            c."cleanupEvidence"->>'retentionCheckedAt' IS NULL)
      )
  );
$$;

CREATE FUNCTION ayin_output_reservation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "MediaUploadSession"; j "MediaProcessingJob"; cid UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF ayin_output_reservation_minimizable(OLD.id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Output envelope identity and cumulative spend must be retained' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW."uploadSessionId", NEW."accountId", NEW."channelId", NEW."envelopeBytes", NEW."createdAt") IS DISTINCT FROM
       ROW(OLD.id, OLD."uploadSessionId", OLD."accountId", OLD."channelId", OLD."envelopeBytes", OLD."createdAt") OR
      (OLD."processingJobId" IS NOT NULL AND NEW."processingJobId" IS DISTINCT FROM OLD."processingJobId") OR
      (NEW."dispatchedBytes" IS DISTINCT FROM OLD."dispatchedBytes" AND
        (pg_trigger_depth() < 2 OR NEW."dispatchedBytes" <= OLD."dispatchedBytes")) THEN
      RAISE EXCEPTION 'Output envelope identity is immutable; only journal inserts spend capacity' USING ERRCODE='23514';
    END IF;
    IF NEW."processingJobId" IS NOT DISTINCT FROM OLD."processingJobId" THEN RETURN NEW; END IF;
  ELSIF NEW."dispatchedBytes" <> 0 THEN
    RAISE EXCEPTION 'New output envelopes start with zero dispatched bytes' USING ERRCODE='23514';
  END IF;
  IF NEW."uploadSessionId" IS NOT NULL THEN
    SELECT * INTO s FROM "MediaUploadSession" WHERE id=NEW."uploadSessionId";
    IF s.id IS NULL OR s."sourceProtocolVersion" <> 2 OR s."channelId" IS DISTINCT FROM NEW."channelId" OR
      s."initiatingAccountId" IS DISTINCT FROM NEW."accountId" THEN
      RAISE EXCEPTION 'Output envelope must match its exact finite source' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW."processingJobId" IS NOT NULL THEN
    SELECT * INTO j FROM "MediaProcessingJob" WHERE id=NEW."processingJobId";
    SELECT "channelId" INTO cid FROM "Video" WHERE id=j."videoId";
    IF j.id IS NULL OR j."outputProtocolVersion" <> 2 OR cid IS DISTINCT FROM NEW."channelId" OR
      (NEW."uploadSessionId" IS NOT NULL AND (j."inputIntegrityParentJobId" IS NOT NULL OR
        j."inputIntegritySessionId" IS DISTINCT FROM NEW."uploadSessionId")) OR
      (NEW."uploadSessionId" IS NULL AND j."inputIntegrityParentJobId" IS NULL) OR
      EXISTS (SELECT 1 FROM "MediaProcessingOutputWrite" w WHERE w."processingJobId"=j.id) THEN
      RAISE EXCEPTION 'Output envelope requires the exact unwritten finite job lineage' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "output_reservation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "MediaProcessingOutputReservation"
  FOR EACH ROW EXECUTE FUNCTION ayin_output_reservation_guard();

CREATE FUNCTION ayin_source_output_reservation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."sourceProtocolVersion"=2 AND NEW."grantsRevokedAt" IS NULL AND
    NEW."grantReservationCount">(CASE WHEN TG_OP='INSERT' THEN 0 ELSE OLD."grantReservationCount" END) AND NOT EXISTS (
    SELECT 1 FROM "MediaProcessingOutputReservation" r WHERE r."uploadSessionId"=NEW.id
      AND r."channelId"=NEW."channelId" AND r."accountId"=NEW."initiatingAccountId"
      AND r."processingJobId" IS NULL AND r."dispatchedBytes"=0
  ) THEN
    RAISE EXCEPTION 'Finite source grants require an atomic output drain reservation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "source_output_reservation_guard" BEFORE INSERT OR UPDATE ON "MediaUploadSession"
  FOR EACH ROW EXECUTE FUNCTION ayin_source_output_reservation_guard();

-- AFTER insert runs only after the existing ownership/lease/address guard.
-- A duplicate key or failed insert rolls back this consumption as well.
CREATE FUNCTION ayin_output_reservation_consume() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "MediaProcessingOutputReservation" SET "dispatchedBytes"="dispatchedBytes"+NEW."expectedSizeBytes"
    WHERE "processingJobId"=NEW."processingJobId" AND
      "dispatchedBytes" <= "envelopeBytes" - NEW."expectedSizeBytes";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Measured output exceeds or lacks its fixed job envelope' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "output_reservation_consume" AFTER INSERT ON "MediaProcessingOutputWrite"
  FOR EACH ROW EXECUTE FUNCTION ayin_output_reservation_consume();
