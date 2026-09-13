CREATE TYPE "VideoAgeRestriction" AS ENUM ('NONE', 'AGE_13_PLUS', 'AGE_18_PLUS');
CREATE TYPE "VideoPolicyOverrideDisposition" AS ENUM ('FORCE_ALLOW', 'FORCE_BLOCK');

CREATE TABLE "VideoPolicy" (
  "videoId" UUID NOT NULL,
  "maturityLevel" "VideoMaturityLevel",
  "allowedTerritories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "blockedTerritories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "rightsExpiresAt" TIMESTAMP(3),
  "ageRestriction" "VideoAgeRestriction" NOT NULL DEFAULT 'NONE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VideoPolicy_pkey" PRIMARY KEY ("videoId")
);

CREATE TABLE "VideoPolicyOverride" (
  "videoId" UUID NOT NULL,
  "disposition" "VideoPolicyOverrideDisposition" NOT NULL,
  "reason" TEXT NOT NULL,
  "actorAccountId" UUID NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VideoPolicyOverride_pkey" PRIMARY KEY ("videoId")
);

CREATE INDEX "VideoPolicy_maturityLevel_idx" ON "VideoPolicy"("maturityLevel");
CREATE INDEX "VideoPolicy_rightsExpiresAt_idx" ON "VideoPolicy"("rightsExpiresAt");
CREATE INDEX "VideoPolicy_allowedTerritories_gin_idx" ON "VideoPolicy" USING GIN ("allowedTerritories");
CREATE INDEX "VideoPolicy_blockedTerritories_gin_idx" ON "VideoPolicy" USING GIN ("blockedTerritories");
CREATE INDEX "VideoPolicyOverride_disposition_expiresAt_idx" ON "VideoPolicyOverride"("disposition", "expiresAt");
CREATE INDEX "VideoPolicyOverride_actorAccountId_updatedAt_idx" ON "VideoPolicyOverride"("actorAccountId", "updatedAt");

ALTER TABLE "VideoPolicy"
  ADD CONSTRAINT "VideoPolicy_videoId_fkey"
  FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoPolicyOverride"
  ADD CONSTRAINT "VideoPolicyOverride_videoId_fkey"
  FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoPolicyOverride"
  ADD CONSTRAINT "VideoPolicyOverride_actorAccountId_fkey"
  FOREIGN KEY ("actorAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Task 51 stored maturity/geography as non-enforcing metadata hooks. Preserve
-- those creator choices while promoting them into the authoritative policy
-- domain. Videos that never used advanced policy metadata keep no policy row.
INSERT INTO "VideoPolicy" (
  "videoId",
  "maturityLevel",
  "allowedTerritories",
  "blockedTerritories",
  "createdAt",
  "updatedAt"
)
SELECT
  "videoId",
  "maturityLevel",
  CASE
    WHEN "geoAvailabilityMode"::text = 'INCLUDE_ONLY' THEN "geoCountries"
    ELSE ARRAY[]::TEXT[]
  END,
  CASE
    WHEN "geoAvailabilityMode"::text = 'EXCLUDE' THEN "geoCountries"
    ELSE ARRAY[]::TEXT[]
  END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "VideoCreatorMetadata"
WHERE "maturityLevel" IS NOT NULL
   OR "geoAvailabilityMode" IS NOT NULL
   OR cardinality("geoCountries") > 0
ON CONFLICT ("videoId") DO NOTHING;
