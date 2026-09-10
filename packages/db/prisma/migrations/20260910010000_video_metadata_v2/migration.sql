CREATE TYPE "VideoCategory" AS ENUM ('ENTERTAINMENT', 'EDUCATION', 'GAMING', 'MUSIC', 'NEWS', 'SPORTS', 'TECHNOLOGY', 'LIFESTYLE', 'FILM_ANIMATION', 'OTHER');
CREATE TYPE "VideoMaturityLevel" AS ENUM ('GENERAL', 'TEEN', 'MATURE');
CREATE TYPE "VideoGeoAvailabilityMode" AS ENUM ('WORLDWIDE', 'INCLUDE_ONLY', 'EXCLUDE');
CREATE TYPE "VideoAdBreakPreference" AS ENUM ('AUTOMATIC', 'DISABLED', 'CUSTOM');

CREATE TABLE "VideoCreatorMetadata" (
  "videoId" UUID NOT NULL,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "category" "VideoCategory",
  "primaryLanguage" VARCHAR(35),
  "recordingDate" DATE,
  "seriesTitle" VARCHAR(120),
  "seasonNumber" INTEGER,
  "episodeNumber" INTEGER,
  "maturityLevel" "VideoMaturityLevel",
  "geoAvailabilityMode" "VideoGeoAvailabilityMode",
  "geoCountries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "chapters" JSONB,
  "adBreakPreference" "VideoAdBreakPreference",
  "adBreakOffsetsSeconds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VideoCreatorMetadata_pkey" PRIMARY KEY ("videoId")
);

CREATE INDEX "VideoCreatorMetadata_category_idx" ON "VideoCreatorMetadata"("category");
CREATE INDEX "VideoCreatorMetadata_primaryLanguage_idx" ON "VideoCreatorMetadata"("primaryLanguage");
CREATE INDEX "VideoCreatorMetadata_tags_gin_idx" ON "VideoCreatorMetadata" USING GIN ("tags");

ALTER TABLE "VideoCreatorMetadata"
  ADD CONSTRAINT "VideoCreatorMetadata_videoId_fkey"
  FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
