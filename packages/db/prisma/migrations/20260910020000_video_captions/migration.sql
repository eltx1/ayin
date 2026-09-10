CREATE TYPE "VideoCaptionTrackKind" AS ENUM ('CAPTIONS', 'SUBTITLES');

CREATE TABLE "VideoCaptionTrack" (
    "id" UUID NOT NULL,
    "videoId" UUID NOT NULL,
    "mediaAssetId" UUID,
    "pendingMediaAssetId" UUID,
    "languageCode" VARCHAR(35) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "kind" "VideoCaptionTrackKind" NOT NULL DEFAULT 'SUBTITLES',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pendingMakeDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VideoCaptionTrack_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VideoCaptionTrack_mediaAssetId_key" ON "VideoCaptionTrack"("mediaAssetId");
CREATE UNIQUE INDEX "VideoCaptionTrack_pendingMediaAssetId_key" ON "VideoCaptionTrack"("pendingMediaAssetId");
CREATE INDEX "VideoCaptionTrack_videoId_isEnabled_idx" ON "VideoCaptionTrack"("videoId", "isEnabled");
CREATE INDEX "VideoCaptionTrack_videoId_languageCode_idx" ON "VideoCaptionTrack"("videoId", "languageCode");
CREATE UNIQUE INDEX "VideoCaptionTrack_one_default_per_video_idx"
  ON "VideoCaptionTrack"("videoId") WHERE "isDefault" = true;

ALTER TABLE "VideoCaptionTrack"
  ADD CONSTRAINT "VideoCaptionTrack_videoId_fkey"
  FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoCaptionTrack"
  ADD CONSTRAINT "VideoCaptionTrack_mediaAssetId_fkey"
  FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VideoCaptionTrack"
  ADD CONSTRAINT "VideoCaptionTrack_pendingMediaAssetId_fkey"
  FOREIGN KEY ("pendingMediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
