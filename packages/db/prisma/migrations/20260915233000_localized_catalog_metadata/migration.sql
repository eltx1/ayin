ALTER TABLE "MovieLocalization"
  ADD COLUMN "shortDescription" VARCHAR(500),
  ADD COLUMN "posterMediaAssetId" UUID,
  ADD COLUMN "backdropMediaAssetId" UUID;

CREATE INDEX "MovieLocalization_posterMediaAssetId_idx" ON "MovieLocalization"("posterMediaAssetId");
CREATE INDEX "MovieLocalization_backdropMediaAssetId_idx" ON "MovieLocalization"("backdropMediaAssetId");

CREATE TABLE "SeriesLocalization" (
  "id" UUID NOT NULL,
  "seriesId" UUID NOT NULL,
  "locale" VARCHAR(35) NOT NULL,
  "title" VARCHAR(200),
  "synopsis" TEXT,
  "shortDescription" VARCHAR(500),
  "posterMediaAssetId" UUID,
  "backdropMediaAssetId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SeriesLocalization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SeriesLocalization_seriesId_locale_key" ON "SeriesLocalization"("seriesId", "locale");
CREATE INDEX "SeriesLocalization_locale_seriesId_idx" ON "SeriesLocalization"("locale", "seriesId");
CREATE INDEX "SeriesLocalization_posterMediaAssetId_idx" ON "SeriesLocalization"("posterMediaAssetId");
CREATE INDEX "SeriesLocalization_backdropMediaAssetId_idx" ON "SeriesLocalization"("backdropMediaAssetId");

CREATE TABLE "SeriesSeasonLocalization" (
  "id" UUID NOT NULL,
  "seasonId" UUID NOT NULL,
  "locale" VARCHAR(35) NOT NULL,
  "title" VARCHAR(200),
  "shortDescription" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SeriesSeasonLocalization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SeriesSeasonLocalization_seasonId_locale_key" ON "SeriesSeasonLocalization"("seasonId", "locale");
CREATE INDEX "SeriesSeasonLocalization_locale_seasonId_idx" ON "SeriesSeasonLocalization"("locale", "seasonId");

CREATE TABLE "SeriesEpisodeLocalization" (
  "id" UUID NOT NULL,
  "episodeId" UUID NOT NULL,
  "locale" VARCHAR(35) NOT NULL,
  "title" VARCHAR(200),
  "synopsis" TEXT,
  "shortDescription" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SeriesEpisodeLocalization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SeriesEpisodeLocalization_episodeId_locale_key" ON "SeriesEpisodeLocalization"("episodeId", "locale");
CREATE INDEX "SeriesEpisodeLocalization_locale_episodeId_idx" ON "SeriesEpisodeLocalization"("locale", "episodeId");

ALTER TABLE "SeriesLocalization"
  ADD CONSTRAINT "SeriesLocalization_seriesId_fkey"
  FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SeriesSeasonLocalization"
  ADD CONSTRAINT "SeriesSeasonLocalization_seasonId_fkey"
  FOREIGN KEY ("seasonId") REFERENCES "SeriesSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SeriesEpisodeLocalization"
  ADD CONSTRAINT "SeriesEpisodeLocalization_episodeId_fkey"
  FOREIGN KEY ("episodeId") REFERENCES "SeriesEpisode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
