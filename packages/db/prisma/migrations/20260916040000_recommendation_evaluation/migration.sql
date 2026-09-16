CREATE TABLE "RecommendationExposure" (
    "id" UUID NOT NULL,
    "versionId" VARCHAR(120) NOT NULL,
    "algorithmId" VARCHAR(120) NOT NULL,
    "surface" VARCHAR(32) NOT NULL,
    "mode" VARCHAR(32) NOT NULL,
    "rankingSize" INTEGER NOT NULL,
    "itemIds" JSONB NOT NULL,
    "components" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationExposure_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecommendationExposure_versionId_createdAt_idx"
    ON "RecommendationExposure"("versionId", "createdAt");
CREATE INDEX "RecommendationExposure_surface_createdAt_idx"
    ON "RecommendationExposure"("surface", "createdAt");
CREATE INDEX "RecommendationExposure_createdAt_idx"
    ON "RecommendationExposure"("createdAt");
