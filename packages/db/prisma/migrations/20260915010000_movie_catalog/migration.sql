CREATE TYPE "MovieCatalogStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "MovieArtworkType" AS ENUM ('POSTER', 'BACKDROP', 'LOGO');
CREATE TYPE "MovieAvailabilityRule" AS ENUM ('ALLOW', 'BLOCK');

CREATE TABLE "Movie" (
  "id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "slug" VARCHAR(160) NOT NULL,
  "synopsis" TEXT NOT NULL,
  "releaseDate" TIMESTAMP(3),
  "releaseYear" INTEGER NOT NULL,
  "runtimeMinutes" INTEGER NOT NULL,
  "maturityRating" VARCHAR(32) NOT NULL,
  "originalLanguage" VARCHAR(16) NOT NULL,
  "status" "MovieCatalogStatus" NOT NULL DEFAULT 'DRAFT',
  "primaryVideoId" UUID,
  "trailerVideoId" UUID,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Movie_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Movie_releaseYear_check" CHECK ("releaseYear" BETWEEN 1888 AND 2200),
  CONSTRAINT "Movie_runtimeMinutes_check" CHECK ("runtimeMinutes" > 0 AND "runtimeMinutes" <= 1440),
  CONSTRAINT "Movie_originalLanguage_check" CHECK (char_length(trim("originalLanguage")) > 0)
);

CREATE UNIQUE INDEX "Movie_slug_key" ON "Movie"("slug");
CREATE INDEX "Movie_status_publishedAt_idx" ON "Movie"("status", "publishedAt");
CREATE INDEX "Movie_releaseYear_status_idx" ON "Movie"("releaseYear", "status");
CREATE INDEX "Movie_primaryVideoId_idx" ON "Movie"("primaryVideoId");
CREATE INDEX "Movie_trailerVideoId_idx" ON "Movie"("trailerVideoId");

ALTER TABLE "Movie"
ADD CONSTRAINT "Movie_primaryVideoId_fkey"
FOREIGN KEY ("primaryVideoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Movie"
ADD CONSTRAINT "Movie_trailerVideoId_fkey"
FOREIGN KEY ("trailerVideoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MovieGenre" (
  "id" UUID NOT NULL,
  "slug" VARCHAR(80) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MovieGenre_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MovieGenre_slug_key" ON "MovieGenre"("slug");
CREATE UNIQUE INDEX "MovieGenre_name_key" ON "MovieGenre"("name");

CREATE TABLE "MovieGenreAssignment" (
  "movieId" UUID NOT NULL,
  "genreId" UUID NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MovieGenreAssignment_pkey" PRIMARY KEY ("movieId", "genreId"),
  CONSTRAINT "MovieGenreAssignment_position_check" CHECK ("position" >= 0)
);

CREATE UNIQUE INDEX "MovieGenreAssignment_movieId_position_key" ON "MovieGenreAssignment"("movieId", "position");
CREATE INDEX "MovieGenreAssignment_genreId_movieId_idx" ON "MovieGenreAssignment"("genreId", "movieId");
ALTER TABLE "MovieGenreAssignment" ADD CONSTRAINT "MovieGenreAssignment_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "Movie"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MovieGenreAssignment" ADD CONSTRAINT "MovieGenreAssignment_genreId_fkey" FOREIGN KEY ("genreId") REFERENCES "MovieGenre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "MovieArtwork" (
  "id" UUID NOT NULL,
  "movieId" UUID NOT NULL,
  "mediaAssetId" UUID NOT NULL,
  "type" "MovieArtworkType" NOT NULL,
  "altText" VARCHAR(240),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MovieArtwork_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MovieArtwork_movieId_type_key" ON "MovieArtwork"("movieId", "type");
CREATE INDEX "MovieArtwork_mediaAssetId_idx" ON "MovieArtwork"("mediaAssetId");
ALTER TABLE "MovieArtwork" ADD CONSTRAINT "MovieArtwork_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "Movie"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MovieArtwork" ADD CONSTRAINT "MovieArtwork_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "MovieLocalization" (
  "id" UUID NOT NULL,
  "movieId" UUID NOT NULL,
  "locale" VARCHAR(35) NOT NULL,
  "title" VARCHAR(200),
  "synopsis" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MovieLocalization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MovieLocalization_movieId_locale_key" ON "MovieLocalization"("movieId", "locale");
CREATE INDEX "MovieLocalization_locale_movieId_idx" ON "MovieLocalization"("locale", "movieId");
ALTER TABLE "MovieLocalization" ADD CONSTRAINT "MovieLocalization_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "Movie"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MovieAvailability" (
  "id" UUID NOT NULL,
  "movieId" UUID NOT NULL,
  "territoryCode" VARCHAR(2) NOT NULL,
  "rule" "MovieAvailabilityRule" NOT NULL DEFAULT 'ALLOW',
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "note" VARCHAR(240),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MovieAvailability_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MovieAvailability_territoryCode_check" CHECK ("territoryCode" = '*' OR "territoryCode" ~ '^[A-Z]{2}$'),
  CONSTRAINT "MovieAvailability_window_check" CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt")
);

CREATE INDEX "MovieAvailability_movieId_territoryCode_rule_startsAt_endsAt_idx" ON "MovieAvailability"("movieId", "territoryCode", "rule", "startsAt", "endsAt");
ALTER TABLE "MovieAvailability" ADD CONSTRAINT "MovieAvailability_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "Movie"("id") ON DELETE CASCADE ON UPDATE CASCADE;
