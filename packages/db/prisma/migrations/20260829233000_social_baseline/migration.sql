CREATE TABLE "MyListItem" (
  "id" UUID NOT NULL,
  "profileId" UUID NOT NULL,
  "videoId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MyListItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MyListItem_profileId_videoId_key" ON "MyListItem"("profileId", "videoId");
CREATE INDEX "MyListItem_profileId_createdAt_idx" ON "MyListItem"("profileId", "createdAt");
CREATE INDEX "MyListItem_videoId_createdAt_idx" ON "MyListItem"("videoId", "createdAt");

ALTER TABLE "MyListItem" ADD CONSTRAINT "MyListItem_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "ViewerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MyListItem" ADD CONSTRAINT "MyListItem_videoId_fkey"
FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
