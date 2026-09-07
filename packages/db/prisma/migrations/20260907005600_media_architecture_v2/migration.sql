CREATE TYPE "MediaPlaybackGenerationStatus" AS ENUM ('BUILDING', 'READY', 'FAILED', 'SUPERSEDED');
CREATE TYPE "MediaPlaybackOutputStatus" AS ENUM ('PLANNED', 'PROCESSING', 'UPLOADING', 'VERIFYING', 'READY', 'FAILED', 'REMOVED');
CREATE TYPE "MediaPlaybackProtocol" AS ENUM ('PROGRESSIVE', 'HLS');
CREATE TYPE "MediaPlaybackContainer" AS ENUM ('MP4', 'MPEG_TS');
CREATE TYPE "MediaPlaybackVideoCodec" AS ENUM ('H264');
CREATE TYPE "MediaPlaybackAudioCodec" AS ENUM ('AAC');

CREATE TABLE "MediaPlaybackGeneration" (
    "id" UUID NOT NULL,
    "videoId" UUID NOT NULL,
    "sourceMediaAssetId" UUID,
    "processingJobId" UUID,
    "generation" INTEGER NOT NULL,
    "processingVersion" INTEGER NOT NULL DEFAULT 2,
    "status" "MediaPlaybackGenerationStatus" NOT NULL DEFAULT 'BUILDING',
    "fallbackR2ObjectKey" VARCHAR(1024) NOT NULL,
    "fallbackStatus" "MediaPlaybackOutputStatus" NOT NULL DEFAULT 'PLANNED',
    "fallbackProtocol" "MediaPlaybackProtocol" NOT NULL DEFAULT 'PROGRESSIVE',
    "fallbackContainer" "MediaPlaybackContainer" NOT NULL DEFAULT 'MP4',
    "fallbackVideoCodec" "MediaPlaybackVideoCodec" NOT NULL DEFAULT 'H264',
    "fallbackAudioCodec" "MediaPlaybackAudioCodec" NOT NULL DEFAULT 'AAC',
    "fallbackPixelFormat" VARCHAR(32) NOT NULL DEFAULT 'yuv420p',
    "hlsMasterR2ObjectKey" VARCHAR(1024) NOT NULL,
    "hlsMasterStatus" "MediaPlaybackOutputStatus" NOT NULL DEFAULT 'PLANNED',
    "readyAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MediaPlaybackGeneration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MediaPlaybackRendition" (
    "id" UUID NOT NULL,
    "playbackGenerationId" UUID NOT NULL,
    "identity" VARCHAR(32) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "videoBitrateKbps" INTEGER NOT NULL,
    "audioBitrateKbps" INTEGER NOT NULL,
    "videoCodec" "MediaPlaybackVideoCodec" NOT NULL DEFAULT 'H264',
    "audioCodec" "MediaPlaybackAudioCodec" NOT NULL DEFAULT 'AAC',
    "pixelFormat" VARCHAR(32) NOT NULL DEFAULT 'yuv420p',
    "protocol" "MediaPlaybackProtocol" NOT NULL DEFAULT 'HLS',
    "container" "MediaPlaybackContainer" NOT NULL DEFAULT 'MPEG_TS',
    "playlistR2ObjectKey" VARCHAR(1024) NOT NULL,
    "segmentR2Prefix" VARCHAR(1024) NOT NULL,
    "status" "MediaPlaybackOutputStatus" NOT NULL DEFAULT 'PLANNED',
    "readyAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MediaPlaybackRendition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaPlaybackGeneration_processingJobId_key" ON "MediaPlaybackGeneration"("processingJobId");
CREATE UNIQUE INDEX "MediaPlaybackGeneration_fallbackR2ObjectKey_key" ON "MediaPlaybackGeneration"("fallbackR2ObjectKey");
CREATE UNIQUE INDEX "MediaPlaybackGeneration_hlsMasterR2ObjectKey_key" ON "MediaPlaybackGeneration"("hlsMasterR2ObjectKey");
CREATE UNIQUE INDEX "MediaPlaybackGeneration_videoId_generation_key" ON "MediaPlaybackGeneration"("videoId", "generation");
CREATE INDEX "MediaPlaybackGeneration_videoId_status_generation_idx" ON "MediaPlaybackGeneration"("videoId", "status", "generation");
CREATE INDEX "MediaPlaybackGeneration_sourceMediaAssetId_idx" ON "MediaPlaybackGeneration"("sourceMediaAssetId");

CREATE UNIQUE INDEX "MediaPlaybackRendition_playlistR2ObjectKey_key" ON "MediaPlaybackRendition"("playlistR2ObjectKey");
CREATE UNIQUE INDEX "MediaPlaybackRendition_segmentR2Prefix_key" ON "MediaPlaybackRendition"("segmentR2Prefix");
CREATE UNIQUE INDEX "MediaPlaybackRendition_playbackGenerationId_identity_key" ON "MediaPlaybackRendition"("playbackGenerationId", "identity");
CREATE INDEX "MediaPlaybackRendition_playbackGenerationId_status_idx" ON "MediaPlaybackRendition"("playbackGenerationId", "status");

ALTER TABLE "MediaPlaybackRendition" ADD CONSTRAINT "MediaPlaybackRendition_playbackGenerationId_fkey" FOREIGN KEY ("playbackGenerationId") REFERENCES "MediaPlaybackGeneration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
