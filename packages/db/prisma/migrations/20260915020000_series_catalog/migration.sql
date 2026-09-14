CREATE TYPE "SeriesCatalogStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "SeriesEpisodeStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "SeriesArtworkType" AS ENUM ('POSTER', 'BACKDROP', 'LOGO');

CREATE TABLE "Series" (
  "id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "slug" VARCHAR(160) NOT NULL,
  "synopsis" TEXT NOT NULL,
  "releaseYear" INTEGER,
  "maturityRating" VARCHAR(32) NOT NULL,
  "originalLanguage" VARCHAR(16) NOT NULL,
  "status" "SeriesCatalogStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Series_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Series_releaseYear_check" CHECK ("releaseYear" IS NULL OR "releaseYear" BETWEEN 1888 AND 2200),
  CONSTRAINT "Series_originalLanguage_check" CHECK (char_length(trim("originalLanguage")) > 0)
);

CREATE UNIQUE INDEX "Series_slug_key" ON "Series"("slug");
CREATE INDEX "Series_status_publishedAt_idx" ON "Series"("status", "publishedAt");
CREATE INDEX "Series_releaseYear_status_idx" ON "Series"("releaseYear", "status");

CREATE TABLE "SeriesGenre" (
  "id" UUID NOT NULL,
  "slug" VARCHAR(80) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SeriesGenre_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SeriesGenre_slug_key" ON "SeriesGenre"("slug");
CREATE UNIQUE INDEX "SeriesGenre_name_key" ON "SeriesGenre"("name");

CREATE TABLE "SeriesGenreAssignment" (
  "seriesId" UUID NOT NULL,
  "genreId" UUID NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeriesGenreAssignment_pkey" PRIMARY KEY ("seriesId", "genreId"),
  CONSTRAINT "SeriesGenreAssignment_position_check" CHECK ("position" >= 0)
);

CREATE UNIQUE INDEX "SeriesGenreAssignment_seriesId_position_key" ON "SeriesGenreAssignment"("seriesId", "position");
CREATE INDEX "SeriesGenreAssignment_genreId_seriesId_idx" ON "SeriesGenreAssignment"("genreId", "seriesId");
ALTER TABLE "SeriesGenreAssignment" ADD CONSTRAINT "SeriesGenreAssignment_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeriesGenreAssignment" ADD CONSTRAINT "SeriesGenreAssignment_genreId_fkey" FOREIGN KEY ("genreId") REFERENCES "SeriesGenre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SeriesArtwork" (
  "id" UUID NOT NULL,
  "seriesId" UUID NOT NULL,
  "mediaAssetId" UUID NOT NULL,
  "type" "SeriesArtworkType" NOT NULL,
  "altText" VARCHAR(240),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SeriesArtwork_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SeriesArtwork_seriesId_type_key" ON "SeriesArtwork"("seriesId", "type");
CREATE INDEX "SeriesArtwork_mediaAssetId_idx" ON "SeriesArtwork"("mediaAssetId");
ALTER TABLE "SeriesArtwork" ADD CONSTRAINT "SeriesArtwork_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeriesArtwork" ADD CONSTRAINT "SeriesArtwork_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SeriesSeason" (
  "id" UUID NOT NULL,
  "seriesId" UUID NOT NULL,
  "seasonNumber" INTEGER NOT NULL,
  "title" VARCHAR(200),
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SeriesSeason_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SeriesSeason_seasonNumber_check" CHECK ("seasonNumber" >= 0),
  CONSTRAINT "SeriesSeason_sortOrder_check" CHECK ("sortOrder" >= 0)
);

CREATE UNIQUE INDEX "SeriesSeason_seriesId_seasonNumber_key" ON "SeriesSeason"("seriesId", "seasonNumber");
CREATE INDEX "SeriesSeason_seriesId_sortOrder_seasonNumber_id_idx" ON "SeriesSeason"("seriesId", "sortOrder", "seasonNumber", "id");
ALTER TABLE "SeriesSeason" ADD CONSTRAINT "SeriesSeason_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SeriesSeasonArtwork" (
  "id" UUID NOT NULL,
  "seasonId" UUID NOT NULL,
  "mediaAssetId" UUID NOT NULL,
  "type" "SeriesArtworkType" NOT NULL,
  "altText" VARCHAR(240),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SeriesSeasonArtwork_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SeriesSeasonArtwork_seasonId_type_key" ON "SeriesSeasonArtwork"("seasonId", "type");
CREATE INDEX "SeriesSeasonArtwork_mediaAssetId_idx" ON "SeriesSeasonArtwork"("mediaAssetId");
ALTER TABLE "SeriesSeasonArtwork" ADD CONSTRAINT "SeriesSeasonArtwork_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "SeriesSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeriesSeasonArtwork" ADD CONSTRAINT "SeriesSeasonArtwork_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SeriesEpisode" (
  "id" UUID NOT NULL,
  "seasonId" UUID NOT NULL,
  "episodeNumber" INTEGER NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "synopsis" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "releaseDate" TIMESTAMP(3),
  "status" "SeriesEpisodeStatus" NOT NULL DEFAULT 'DRAFT',
  "videoId" UUID,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SeriesEpisode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SeriesEpisode_episodeNumber_check" CHECK ("episodeNumber" >= 0),
  CONSTRAINT "SeriesEpisode_sortOrder_check" CHECK ("sortOrder" >= 0)
);

CREATE UNIQUE INDEX "SeriesEpisode_seasonId_episodeNumber_key" ON "SeriesEpisode"("seasonId", "episodeNumber");
CREATE INDEX "SeriesEpisode_seasonId_status_sortOrder_episodeNumber_id_idx" ON "SeriesEpisode"("seasonId", "status", "sortOrder", "episodeNumber", "id");
CREATE INDEX "SeriesEpisode_videoId_idx" ON "SeriesEpisode"("videoId");
CREATE INDEX "SeriesEpisode_status_publishedAt_idx" ON "SeriesEpisode"("status", "publishedAt");
ALTER TABLE "SeriesEpisode" ADD CONSTRAINT "SeriesEpisode_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "SeriesSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeriesEpisode" ADD CONSTRAINT "SeriesEpisode_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Deliberately no INSERT/backfill: existing creator videos and movie catalog rows remain unchanged.
