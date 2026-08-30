CREATE TABLE "DirectCampaignConfig" (
  "id" UUID NOT NULL,
  "campaignId" UUID NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "pricing" JSONB NOT NULL,
  "impressionGoal" BIGINT,
  "frequencyCap" INTEGER NOT NULL DEFAULT 3,
  "pacing" VARCHAR(20) NOT NULL DEFAULT 'EVEN',
  "targeting" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DirectCampaignConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DirectCampaignConfig_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DirectCampaignConfig_priority_check" CHECK ("priority" BETWEEN 1 AND 1000),
  CONSTRAINT "DirectCampaignConfig_frequencyCap_check" CHECK ("frequencyCap" BETWEEN 0 AND 100),
  CONSTRAINT "DirectCampaignConfig_pacing_check" CHECK ("pacing" IN ('EVEN','ASAP'))
);

CREATE UNIQUE INDEX "DirectCampaignConfig_campaignId_key" ON "DirectCampaignConfig"("campaignId");
CREATE INDEX "DirectCampaignConfig_priority_updatedAt_idx" ON "DirectCampaignConfig"("priority", "updatedAt");

CREATE TABLE "DirectCreativeConfig" (
  "id" UUID NOT NULL,
  "creativeId" UUID NOT NULL,
  "assetUrl" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "approvedReference" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DirectCreativeConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DirectCreativeConfig_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "Creative"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DirectCreativeConfig_width_check" CHECK ("width" IS NULL OR "width" BETWEEN 1 AND 4096),
  CONSTRAINT "DirectCreativeConfig_height_check" CHECK ("height" IS NULL OR "height" BETWEEN 1 AND 4096)
);

CREATE UNIQUE INDEX "DirectCreativeConfig_creativeId_key" ON "DirectCreativeConfig"("creativeId");
