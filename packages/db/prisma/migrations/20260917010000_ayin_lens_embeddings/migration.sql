CREATE TABLE "CatalogSearchEmbedding" (
    "id" UUID NOT NULL,
    "entityType" VARCHAR(16) NOT NULL,
    "entityId" UUID NOT NULL,
    "slug" VARCHAR(160),
    "providerKey" VARCHAR(80) NOT NULL,
    "model" VARCHAR(120) NOT NULL,
    "modelVersion" VARCHAR(80) NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "embedding" DOUBLE PRECISION[] NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "embeddedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogSearchEmbedding_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CatalogSearchEmbedding_dimensions_check"
      CHECK ("dimensions" > 0 AND cardinality("embedding") = "dimensions")
);

CREATE UNIQUE INDEX "CatalogSearchEmbedding_entityType_entityId_provider_model_version_key"
ON "CatalogSearchEmbedding"("entityType", "entityId", "providerKey", "model", "modelVersion");

CREATE INDEX "CatalogSearchEmbedding_provider_model_version_dimensions_embeddedAt_idx"
ON "CatalogSearchEmbedding"("providerKey", "model", "modelVersion", "dimensions", "embeddedAt");

CREATE INDEX "CatalogSearchEmbedding_entityType_entityId_idx"
ON "CatalogSearchEmbedding"("entityType", "entityId");

CREATE INDEX "CatalogSearchEmbedding_contentHash_idx"
ON "CatalogSearchEmbedding"("contentHash");
