CREATE TYPE "HomeRowSource" AS ENUM (
  'CONTINUE_WATCHING',
  'TRENDING_WORLDWIDE',
  'POPULAR_NOW',
  'NEW_ON_AYIN',
  'BECAUSE_YOU_WATCHED',
  'POPULAR_REGION',
  'MOVIES',
  'SERIES',
  'CREATOR_TV',
  'CREATORS_YOU_FOLLOW',
  'RECENTLY_ADDED',
  'EDITOR_PICKS'
);

CREATE TYPE "HomeRowAudience" AS ENUM ('ALL', 'AUTHENTICATED', 'ANONYMOUS');
CREATE TYPE "HomeManualItemType" AS ENUM ('VIDEO', 'CREATOR_TV', 'CHANNEL', 'PLAYLIST');

CREATE TABLE "HomeRowConfig" (
  "id" UUID NOT NULL,
  "key" VARCHAR(80) NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "source" "HomeRowSource" NOT NULL,
  "audience" "HomeRowAudience" NOT NULL DEFAULT 'ALL',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "position" INTEGER NOT NULL,
  "maxItems" INTEGER NOT NULL DEFAULT 24,
  "regionPersonalizationRequired" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HomeRowConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HomeRowConfig_position_check" CHECK ("position" >= 0),
  CONSTRAINT "HomeRowConfig_maxItems_check" CHECK ("maxItems" BETWEEN 1 AND 40)
);

CREATE UNIQUE INDEX "HomeRowConfig_key_key" ON "HomeRowConfig"("key");
CREATE INDEX "HomeRowConfig_enabled_position_idx" ON "HomeRowConfig"("enabled", "position");
CREATE INDEX "HomeRowConfig_audience_enabled_position_idx" ON "HomeRowConfig"("audience", "enabled", "position");

CREATE TABLE "HomeRowManualItem" (
  "id" UUID NOT NULL,
  "rowId" UUID NOT NULL,
  "entityType" "HomeManualItemType" NOT NULL,
  "entityId" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HomeRowManualItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HomeRowManualItem_position_check" CHECK ("position" >= 0)
);

CREATE UNIQUE INDEX "HomeRowManualItem_rowId_position_key" ON "HomeRowManualItem"("rowId", "position");
CREATE UNIQUE INDEX "HomeRowManualItem_rowId_entityType_entityId_key" ON "HomeRowManualItem"("rowId", "entityType", "entityId");
CREATE INDEX "HomeRowManualItem_entityType_entityId_idx" ON "HomeRowManualItem"("entityType", "entityId");

ALTER TABLE "HomeRowManualItem"
ADD CONSTRAINT "HomeRowManualItem_rowId_fkey"
FOREIGN KEY ("rowId") REFERENCES "HomeRowConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
