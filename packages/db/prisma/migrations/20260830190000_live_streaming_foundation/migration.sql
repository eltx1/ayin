CREATE TYPE "LiveStreamStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'READY', 'LIVE', 'ENDED', 'CANCELLED', 'FAILED');
CREATE TYPE "LiveChatMessageStatus" AS ENUM ('PUBLISHED', 'HIDDEN', 'REMOVED');
CREATE TYPE "LiveModerationActionType" AS ENUM ('HIDE_MESSAGE', 'REMOVE_MESSAGE', 'DISABLE_CHAT', 'ENABLE_CHAT');

CREATE TABLE "LiveStream" (
  "id" UUID NOT NULL,
  "channelId" UUID NOT NULL,
  "createdByAccountId" UUID NOT NULL,
  "slug" VARCHAR(160) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "description" TEXT,
  "status" "LiveStreamStatus" NOT NULL DEFAULT 'DRAFT',
  "providerKey" VARCHAR(80) NOT NULL DEFAULT 'unconfigured',
  "providerStreamId" VARCHAR(255),
  "streamKeyHash" VARCHAR(128),
  "ingestEndpoint" TEXT,
  "playbackUrl" TEXT,
  "scheduledStartAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "chatEnabled" BOOLEAN NOT NULL DEFAULT true,
  "adBreaksEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LiveStream_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveChatMessage" (
  "id" UUID NOT NULL,
  "liveStreamId" UUID NOT NULL,
  "authorProfileId" UUID NOT NULL,
  "body" TEXT NOT NULL,
  "status" "LiveChatMessageStatus" NOT NULL DEFAULT 'PUBLISHED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "removedAt" TIMESTAMP(3),
  CONSTRAINT "LiveChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveModerationAction" (
  "id" UUID NOT NULL,
  "liveStreamId" UUID NOT NULL,
  "messageId" UUID,
  "actorAccountId" UUID NOT NULL,
  "action" "LiveModerationActionType" NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LiveModerationAction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveStream_slug_key" ON "LiveStream"("slug");
CREATE INDEX "LiveStream_channelId_status_scheduledStartAt_idx" ON "LiveStream"("channelId", "status", "scheduledStartAt");
CREATE INDEX "LiveStream_status_scheduledStartAt_idx" ON "LiveStream"("status", "scheduledStartAt");
CREATE INDEX "LiveChatMessage_liveStreamId_status_createdAt_idx" ON "LiveChatMessage"("liveStreamId", "status", "createdAt");
CREATE INDEX "LiveChatMessage_authorProfileId_createdAt_idx" ON "LiveChatMessage"("authorProfileId", "createdAt");
CREATE INDEX "LiveModerationAction_liveStreamId_createdAt_idx" ON "LiveModerationAction"("liveStreamId", "createdAt");
CREATE INDEX "LiveModerationAction_messageId_createdAt_idx" ON "LiveModerationAction"("messageId", "createdAt");
CREATE INDEX "LiveModerationAction_actorAccountId_createdAt_idx" ON "LiveModerationAction"("actorAccountId", "createdAt");

ALTER TABLE "LiveStream" ADD CONSTRAINT "LiveStream_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveStream" ADD CONSTRAINT "LiveStream_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LiveChatMessage" ADD CONSTRAINT "LiveChatMessage_liveStreamId_fkey" FOREIGN KEY ("liveStreamId") REFERENCES "LiveStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveChatMessage" ADD CONSTRAINT "LiveChatMessage_authorProfileId_fkey" FOREIGN KEY ("authorProfileId") REFERENCES "ViewerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveModerationAction" ADD CONSTRAINT "LiveModerationAction_liveStreamId_fkey" FOREIGN KEY ("liveStreamId") REFERENCES "LiveStream"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveModerationAction" ADD CONSTRAINT "LiveModerationAction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "LiveChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LiveModerationAction" ADD CONSTRAINT "LiveModerationAction_actorAccountId_fkey" FOREIGN KEY ("actorAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
