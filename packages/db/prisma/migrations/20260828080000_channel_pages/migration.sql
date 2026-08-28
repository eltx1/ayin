CREATE TABLE "ChannelAppearance" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "avatarAssetId" UUID,
    "bannerAssetId" UUID,
    "accentColor" VARCHAR(7),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChannelAppearance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChannelHandleRedirect" (
    "oldHandle" VARCHAR(80) NOT NULL,
    "channelId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChannelHandleRedirect_pkey" PRIMARY KEY ("oldHandle")
);

CREATE UNIQUE INDEX "ChannelAppearance_channelId_key" ON "ChannelAppearance"("channelId");
CREATE INDEX "ChannelAppearance_avatarAssetId_idx" ON "ChannelAppearance"("avatarAssetId");
CREATE INDEX "ChannelAppearance_bannerAssetId_idx" ON "ChannelAppearance"("bannerAssetId");
CREATE INDEX "ChannelHandleRedirect_channelId_createdAt_idx" ON "ChannelHandleRedirect"("channelId", "createdAt");

ALTER TABLE "ChannelAppearance"
  ADD CONSTRAINT "ChannelAppearance_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChannelAppearance"
  ADD CONSTRAINT "ChannelAppearance_avatarAssetId_fkey"
  FOREIGN KEY ("avatarAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChannelAppearance"
  ADD CONSTRAINT "ChannelAppearance_bannerAssetId_fkey"
  FOREIGN KEY ("bannerAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChannelHandleRedirect"
  ADD CONSTRAINT "ChannelHandleRedirect_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChannelAppearance"
  ADD CONSTRAINT "ChannelAppearance_accentColor_check"
  CHECK ("accentColor" IS NULL OR "accentColor" ~ '^#[0-9A-Fa-f]{6}$');
