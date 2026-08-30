CREATE TYPE "VideoContentType" AS ENUM ('CREATOR_VIDEO', 'MOVIE', 'DOCUMENTARY');
CREATE TYPE "ContentSeedBatchStatus" AS ENUM ('DRAFT', 'READY', 'ROLLED_BACK');
CREATE TYPE "ContentSeedItemStatus" AS ENUM ('DRAFT', 'UPLOADING', 'READY', 'PUBLISHED', 'FAILED', 'ROLLED_BACK');

ALTER TABLE "Channel" ADD COLUMN "isPlatformOwned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Video" ADD COLUMN "contentType" "VideoContentType" NOT NULL DEFAULT 'CREATOR_VIDEO';

CREATE TABLE "ContentSeedBatch" (
  "id" UUID NOT NULL,
  "createdByAccountId" UUID NOT NULL,
  "channelId" UUID NOT NULL,
  "sourceLabel" VARCHAR(200) NOT NULL,
  "status" "ContentSeedBatchStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "rolledBackAt" TIMESTAMP(3),
  CONSTRAINT "ContentSeedBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentSeedItem" (
  "id" UUID NOT NULL,
  "batchId" UUID NOT NULL,
  "videoId" UUID NOT NULL,
  "sourceNotes" TEXT NOT NULL,
  "rightsBasis" "RightsBasis" NOT NULL,
  "status" "ContentSeedItemStatus" NOT NULL DEFAULT 'DRAFT',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentSeedItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentSeedItem_videoId_key" ON "ContentSeedItem"("videoId");
CREATE INDEX "ContentSeedBatch_channelId_status_createdAt_idx" ON "ContentSeedBatch"("channelId", "status", "createdAt");
CREATE INDEX "ContentSeedBatch_createdByAccountId_createdAt_idx" ON "ContentSeedBatch"("createdByAccountId", "createdAt");
CREATE INDEX "ContentSeedItem_batchId_status_idx" ON "ContentSeedItem"("batchId", "status");

ALTER TABLE "ContentSeedBatch" ADD CONSTRAINT "ContentSeedBatch_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentSeedBatch" ADD CONSTRAINT "ContentSeedBatch_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentSeedItem" ADD CONSTRAINT "ContentSeedItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ContentSeedBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentSeedItem" ADD CONSTRAINT "ContentSeedItem_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
