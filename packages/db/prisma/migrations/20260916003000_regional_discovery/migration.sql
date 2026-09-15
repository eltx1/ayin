-- CreateEnum
CREATE TYPE "RegionalDiscoverySignal" AS ENUM ('POPULAR_CONTENT', 'CATALOG', 'CREATOR_TV', 'CATEGORY_AFFINITY');

-- CreateTable
CREATE TABLE "HomeRowRegionTarget" (
    "id" UUID NOT NULL,
    "rowId" UUID NOT NULL,
    "regionCode" VARCHAR(2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeRowRegionTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegionalDiscoveryAggregate" (
    "id" UUID NOT NULL,
    "regionCode" VARCHAR(2) NOT NULL,
    "signal" "RegionalDiscoverySignal" NOT NULL,
    "entityKey" VARCHAR(200) NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "cohortSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegionalDiscoveryAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HomeRowRegionTarget_rowId_regionCode_key" ON "HomeRowRegionTarget"("rowId", "regionCode");

-- CreateIndex
CREATE INDEX "HomeRowRegionTarget_regionCode_rowId_idx" ON "HomeRowRegionTarget"("regionCode", "rowId");

-- CreateIndex
CREATE UNIQUE INDEX "RegionalDiscoveryAggregate_regionCode_signal_entityKey_key" ON "RegionalDiscoveryAggregate"("regionCode", "signal", "entityKey");

-- CreateIndex
CREATE INDEX "RegionalDiscoveryAggregate_regionCode_signal_cohortSize_score_idx" ON "RegionalDiscoveryAggregate"("regionCode", "signal", "cohortSize", "score");

-- AddForeignKey
ALTER TABLE "HomeRowRegionTarget" ADD CONSTRAINT "HomeRowRegionTarget_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "HomeRowConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
