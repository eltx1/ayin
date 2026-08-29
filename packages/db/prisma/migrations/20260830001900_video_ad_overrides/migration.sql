CREATE TABLE "VideoAdOverride" (
    "id" UUID NOT NULL,
    "channelId" UUID,
    "videoId" UUID,
    "enabled" BOOLEAN,
    "preRollEnabled" BOOLEAN,
    "midRollEnabled" BOOLEAN,
    "postRollEnabled" BOOLEAN,
    "provider" VARCHAR(40),
    "vastTagUrl" TEXT,
    "midRollEverySec" INTEGER,
    "updatedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VideoAdOverride_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "VideoAdOverride_exactly_one_target" CHECK (("channelId" IS NOT NULL) <> ("videoId" IS NOT NULL)),
    CONSTRAINT "VideoAdOverride_midroll_interval" CHECK ("midRollEverySec" IS NULL OR ("midRollEverySec" >= 60 AND "midRollEverySec" <= 7200))
);
CREATE UNIQUE INDEX "VideoAdOverride_channelId_key" ON "VideoAdOverride"("channelId");
CREATE UNIQUE INDEX "VideoAdOverride_videoId_key" ON "VideoAdOverride"("videoId");
CREATE INDEX "VideoAdOverride_channelId_idx" ON "VideoAdOverride"("channelId");
CREATE INDEX "VideoAdOverride_videoId_idx" ON "VideoAdOverride"("videoId");
ALTER TABLE "VideoAdOverride" ADD CONSTRAINT "VideoAdOverride_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoAdOverride" ADD CONSTRAINT "VideoAdOverride_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoAdOverride" ADD CONSTRAINT "VideoAdOverride_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
