-- Align the deployed community tables with the Prisma schema. These nullable campaign links are
-- attribution metadata only; existing community records remain valid with NULL campaignId values.
ALTER TABLE "CommunityPollVote"
  ADD COLUMN "campaignId" UUID;
ALTER TABLE "CommunityPostReaction"
  ADD COLUMN "campaignId" UUID;
ALTER TABLE "CommunityPostComment"
  ADD COLUMN "campaignId" UUID;
ALTER TABLE "CommunityPostReport"
  ADD COLUMN "campaignId" UUID;

ALTER TABLE "CommunityPollVote"
  ADD CONSTRAINT "CommunityPollVote_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommunityPostReaction"
  ADD CONSTRAINT "CommunityPostReaction_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommunityPostComment"
  ADD CONSTRAINT "CommunityPostComment_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommunityPostReport"
  ADD CONSTRAINT "CommunityPostReport_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
