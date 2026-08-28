CREATE TABLE "CreatorTvVideoPreference" (
    "id" UUID NOT NULL,
    "tvChannelId" UUID NOT NULL,
    "videoId" UUID NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorTvVideoPreference_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CreatorTvVideoPreference_priority_check" CHECK ("priority" BETWEEN -100000 AND 100000),
    CONSTRAINT "CreatorTvVideoPreference_sortOrder_check" CHECK ("sortOrder" IS NULL OR "sortOrder" BETWEEN 0 AND 1000000)
);

CREATE UNIQUE INDEX "CreatorTvVideoPreference_tvChannelId_videoId_key"
ON "CreatorTvVideoPreference"("tvChannelId", "videoId");

CREATE INDEX "CreatorTvVideoPreference_tvChannelId_included_priority_sortOrder_idx"
ON "CreatorTvVideoPreference"("tvChannelId", "included", "priority", "sortOrder");

CREATE INDEX "CreatorTvVideoPreference_videoId_idx"
ON "CreatorTvVideoPreference"("videoId");

ALTER TABLE "CreatorTvVideoPreference"
ADD CONSTRAINT "CreatorTvVideoPreference_tvChannelId_fkey"
FOREIGN KEY ("tvChannelId") REFERENCES "CreatorTvChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CreatorTvVideoPreference"
ADD CONSTRAINT "CreatorTvVideoPreference_videoId_fkey"
FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
