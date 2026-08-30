CREATE TYPE "CreatorTrustLevel" AS ENUM ('NEW','STANDARD','TRUSTED','RESTRICTED');
CREATE TYPE "ModerationActionKind" AS ENUM ('WARN','STRIKE','SUSPEND_ACCOUNT','SUSPEND_CHANNEL','UNPUBLISH_VIDEO','REMOVE_VIDEO');
CREATE TYPE "AppealStatus" AS ENUM ('OPEN','REVIEWING','UPHELD','OVERTURNED');
CREATE TYPE "TakedownStatus" AS ENUM ('OPEN','REVIEWING','ACTIONED','DISMISSED');
CREATE TABLE "CreatorTrustState" (
  "id" UUID PRIMARY KEY, "channelId" UUID NOT NULL UNIQUE, "level" "CreatorTrustLevel" NOT NULL DEFAULT 'NEW',
  "strikeCount" INTEGER NOT NULL DEFAULT 0, "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "ModerationAction" (
  "id" UUID PRIMARY KEY, "caseId" UUID, "actorAccountId" UUID NOT NULL, "targetAccountId" UUID, "channelId" UUID, "videoId" UUID,
  "kind" "ModerationActionKind" NOT NULL, "reason" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "ModerationAppeal" (
  "id" UUID PRIMARY KEY, "actionId" UUID NOT NULL, "accountId" UUID NOT NULL, "status" "AppealStatus" NOT NULL DEFAULT 'OPEN',
  "message" TEXT NOT NULL, "resolution" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "TakedownRequest" (
  "id" UUID PRIMARY KEY, "requesterId" UUID NOT NULL, "videoId" UUID, "claimantName" VARCHAR(160) NOT NULL, "contactEmail" VARCHAR(320) NOT NULL,
  "rightsBasis" VARCHAR(120) NOT NULL, "details" TEXT NOT NULL, "status" "TakedownStatus" NOT NULL DEFAULT 'OPEN', "resolution" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
ALTER TABLE "CreatorTrustState" ADD CONSTRAINT "CreatorTrustState_channel_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE;
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_case_fkey" FOREIGN KEY ("caseId") REFERENCES "ModerationCase"("id") ON DELETE SET NULL;
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_actor_fkey" FOREIGN KEY ("actorAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT;
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_account_fkey" FOREIGN KEY ("targetAccountId") REFERENCES "Account"("id") ON DELETE SET NULL;
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_channel_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL;
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_video_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL;
ALTER TABLE "ModerationAppeal" ADD CONSTRAINT "ModerationAppeal_action_fkey" FOREIGN KEY ("actionId") REFERENCES "ModerationAction"("id") ON DELETE CASCADE;
ALTER TABLE "ModerationAppeal" ADD CONSTRAINT "ModerationAppeal_account_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE;
ALTER TABLE "TakedownRequest" ADD CONSTRAINT "TakedownRequest_requester_fkey" FOREIGN KEY ("requesterId") REFERENCES "Account"("id") ON DELETE RESTRICT;
ALTER TABLE "TakedownRequest" ADD CONSTRAINT "TakedownRequest_video_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE SET NULL;
CREATE INDEX "CreatorTrustState_level_reviewRequired_idx" ON "CreatorTrustState"("level","reviewRequired");
CREATE INDEX "ModerationAction_channelId_createdAt_idx" ON "ModerationAction"("channelId","createdAt");
CREATE INDEX "ModerationAction_targetAccountId_createdAt_idx" ON "ModerationAction"("targetAccountId","createdAt");
CREATE INDEX "ModerationAction_videoId_createdAt_idx" ON "ModerationAction"("videoId","createdAt");
CREATE INDEX "ModerationAppeal_accountId_status_createdAt_idx" ON "ModerationAppeal"("accountId","status","createdAt");
CREATE INDEX "ModerationAppeal_status_createdAt_idx" ON "ModerationAppeal"("status","createdAt");
CREATE INDEX "TakedownRequest_status_createdAt_idx" ON "TakedownRequest"("status","createdAt");
CREATE INDEX "TakedownRequest_videoId_createdAt_idx" ON "TakedownRequest"("videoId","createdAt");
