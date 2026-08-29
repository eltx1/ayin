CREATE TABLE "CommentControl" (
  "commentId" UUID NOT NULL,
  "creatorHeartedAt" TIMESTAMP(3),
  "pinnedAt" TIMESTAMP(3),
  "pinnedByAccountId" UUID,
  "editedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommentControl_pkey" PRIMARY KEY ("commentId"),
  CONSTRAINT "CommentControl_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommentControl_pinnedByAccountId_fkey" FOREIGN KEY ("pinnedByAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "CommentControl_pinnedAt_idx" ON "CommentControl"("pinnedAt");
CREATE INDEX "CommentControl_creatorHeartedAt_idx" ON "CommentControl"("creatorHeartedAt");

CREATE TABLE "ChannelHiddenProfile" (
  "id" UUID NOT NULL,
  "channelId" UUID NOT NULL,
  "profileId" UUID NOT NULL,
  "hiddenByAccountId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelHiddenProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChannelHiddenProfile_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChannelHiddenProfile_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ViewerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChannelHiddenProfile_hiddenByAccountId_fkey" FOREIGN KEY ("hiddenByAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ChannelHiddenProfile_channelId_profileId_key" ON "ChannelHiddenProfile"("channelId", "profileId");
CREATE INDEX "ChannelHiddenProfile_profileId_idx" ON "ChannelHiddenProfile"("profileId");
CREATE INDEX "ChannelHiddenProfile_hiddenByAccountId_createdAt_idx" ON "ChannelHiddenProfile"("hiddenByAccountId", "createdAt");
