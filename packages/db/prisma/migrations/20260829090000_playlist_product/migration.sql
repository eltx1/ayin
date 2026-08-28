CREATE TYPE "PlaylistVisibility" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');

ALTER TABLE "Playlist"
  ADD COLUMN "visibility" "PlaylistVisibility" NOT NULL DEFAULT 'PUBLIC';

UPDATE "Playlist"
SET "visibility" = CASE
  WHEN "isPublic" THEN 'PUBLIC'::"PlaylistVisibility"
  ELSE 'PRIVATE'::"PlaylistVisibility"
END;

ALTER TABLE "Playlist"
  ADD CONSTRAINT "Playlist_visibility_projection_check"
  CHECK (
    ("visibility" = 'PUBLIC' AND "isPublic" = true)
    OR ("visibility" <> 'PUBLIC' AND "isPublic" = false)
  );

CREATE INDEX "Playlist_channelId_visibility_createdAt_idx"
  ON "Playlist"("channelId", "visibility", "createdAt");

CREATE TABLE "WatchLaterItem" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "videoId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WatchLaterItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WatchLaterItem_profileId_videoId_key"
  ON "WatchLaterItem"("profileId", "videoId");
CREATE INDEX "WatchLaterItem_profileId_createdAt_idx"
  ON "WatchLaterItem"("profileId", "createdAt");
CREATE INDEX "WatchLaterItem_videoId_createdAt_idx"
  ON "WatchLaterItem"("videoId", "createdAt");

ALTER TABLE "WatchLaterItem"
  ADD CONSTRAINT "WatchLaterItem_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "ViewerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WatchLaterItem"
  ADD CONSTRAINT "WatchLaterItem_videoId_fkey"
  FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
