CREATE TYPE "VideoForm" AS ENUM ('LONG_FORM', 'CLIP');

ALTER TABLE "Video" ADD COLUMN "videoForm" "VideoForm" NOT NULL DEFAULT 'LONG_FORM';

CREATE INDEX "Video_videoForm_status_visibility_publishedAt_idx"
ON "Video"("videoForm", "status", "visibility", "publishedAt");
