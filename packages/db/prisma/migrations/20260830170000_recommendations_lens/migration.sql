CREATE TYPE "RecommendationFeedbackType" AS ENUM ('NOT_INTERESTED', 'DISMISSED');

CREATE TABLE "RecommendationProfileState" (
  "profileId" UUID NOT NULL,
  "resetAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecommendationProfileState_pkey" PRIMARY KEY ("profileId")
);

CREATE TABLE "RecommendationFeedback" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "profileId" UUID NOT NULL,
  "videoId" UUID NOT NULL,
  "type" "RecommendationFeedbackType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecommendationFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecommendationFeedback_profileId_videoId_key"
ON "RecommendationFeedback"("profileId", "videoId");
CREATE INDEX "RecommendationFeedback_profileId_type_createdAt_idx"
ON "RecommendationFeedback"("profileId", "type", "createdAt");
CREATE INDEX "RecommendationFeedback_videoId_type_idx"
ON "RecommendationFeedback"("videoId", "type");

ALTER TABLE "RecommendationProfileState"
ADD CONSTRAINT "RecommendationProfileState_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "ViewerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecommendationFeedback"
ADD CONSTRAINT "RecommendationFeedback_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "ViewerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecommendationFeedback"
ADD CONSTRAINT "RecommendationFeedback_videoId_fkey"
FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
