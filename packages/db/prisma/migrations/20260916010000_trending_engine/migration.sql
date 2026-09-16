CREATE TABLE "TrendingScoreSnapshot" (
    "id" UUID NOT NULL,
    "scopeKey" VARCHAR(16) NOT NULL,
    "regionCode" VARCHAR(2),
    "videoId" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "audienceCount" INTEGER NOT NULL,
    "components" JSONB NOT NULL,
    "sampledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrendingScoreSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrendingScoreSnapshot_scopeKey_videoId_key"
ON "TrendingScoreSnapshot"("scopeKey", "videoId");

CREATE INDEX "TrendingScoreSnapshot_scopeKey_score_idx"
ON "TrendingScoreSnapshot"("scopeKey", "score");

CREATE INDEX "TrendingScoreSnapshot_sampledAt_idx"
ON "TrendingScoreSnapshot"("sampledAt");
