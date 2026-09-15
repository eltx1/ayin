-- Task 58 catalog administration hardening.
-- Normalize legacy ordering deterministically before enforcing unique sibling positions.
WITH ranked AS (
  SELECT
    "id",
    (ROW_NUMBER() OVER (
      PARTITION BY "seriesId"
      ORDER BY "sortOrder", "seasonNumber", "id"
    ) - 1) * 10 AS next_order
  FROM "SeriesSeason"
)
UPDATE "SeriesSeason" AS season
SET "sortOrder" = ranked.next_order
FROM ranked
WHERE season."id" = ranked."id";

WITH ranked AS (
  SELECT
    "id",
    (ROW_NUMBER() OVER (
      PARTITION BY "seasonId"
      ORDER BY "sortOrder", "episodeNumber", "id"
    ) - 1) * 10 AS next_order
  FROM "SeriesEpisode"
)
UPDATE "SeriesEpisode" AS episode
SET "sortOrder" = ranked.next_order
FROM ranked
WHERE episode."id" = ranked."id";

CREATE UNIQUE INDEX "SeriesSeason_seriesId_sortOrder_key"
  ON "SeriesSeason"("seriesId", "sortOrder");
CREATE UNIQUE INDEX "SeriesEpisode_seasonId_sortOrder_key"
  ON "SeriesEpisode"("seasonId", "sortOrder");

-- Prevent accidental parent deletion from silently cascading through catalog identity.
ALTER TABLE "SeriesSeason" DROP CONSTRAINT "SeriesSeason_seriesId_fkey";
ALTER TABLE "SeriesSeason"
  ADD CONSTRAINT "SeriesSeason_seriesId_fkey"
  FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SeriesEpisode" DROP CONSTRAINT "SeriesEpisode_seasonId_fkey";
ALTER TABLE "SeriesEpisode"
  ADD CONSTRAINT "SeriesEpisode_seasonId_fkey"
  FOREIGN KEY ("seasonId") REFERENCES "SeriesSeason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Optional trailer references existing Video media. Deleting a Video never deletes a Series.
ALTER TABLE "Series" ADD COLUMN "trailerVideoId" UUID;
CREATE INDEX "Series_trailerVideoId_idx" ON "Series"("trailerVideoId");
ALTER TABLE "Series"
  ADD CONSTRAINT "Series_trailerVideoId_fkey"
  FOREIGN KEY ("trailerVideoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TYPE "SeriesAvailabilityRule" AS ENUM ('ALLOW', 'BLOCK');

CREATE TABLE "SeriesAvailability" (
  "id" UUID NOT NULL,
  "seriesId" UUID NOT NULL,
  "territoryCode" VARCHAR(2) NOT NULL,
  "rule" "SeriesAvailabilityRule" NOT NULL DEFAULT 'ALLOW',
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "note" VARCHAR(240),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SeriesAvailability_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SeriesAvailability_territoryCode_check"
    CHECK ("territoryCode" = '*' OR "territoryCode" ~ '^[A-Z]{2}$'),
  CONSTRAINT "SeriesAvailability_window_check"
    CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt")
);

CREATE INDEX "SeriesAvailability_seriesId_territoryCode_rule_startsAt_endsAt_idx"
  ON "SeriesAvailability"("seriesId", "territoryCode", "rule", "startsAt", "endsAt");
ALTER TABLE "SeriesAvailability"
  ADD CONSTRAINT "SeriesAvailability_seriesId_fkey"
  FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Deliberately no availability backfill: no rows preserves existing global Series behavior.
