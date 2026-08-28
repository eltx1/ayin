-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');
CREATE TYPE "ChannelStatus" AS ENUM ('ACTIVE', 'HIDDEN', 'SUSPENDED', 'REMOVED');
CREATE TYPE "ChannelMemberRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR');
CREATE TYPE "VideoStatus" AS ENUM ('DRAFT', 'UPLOADING', 'VALIDATING', 'SCHEDULED', 'PUBLISHED', 'REMOVED');
CREATE TYPE "VideoVisibility" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');
CREATE TYPE "MediaAssetKind" AS ENUM ('SOURCE_VIDEO', 'THUMBNAIL', 'CAPTION', 'CHANNEL_AVATAR', 'CHANNEL_BANNER', 'CREATIVE');
CREATE TYPE "MediaAssetStatus" AS ENUM ('PENDING', 'UPLOADED', 'VALIDATED', 'REJECTED', 'REMOVED');
CREATE TYPE "PlaylistSystemKey" AS ENUM ('UPLOADS');
CREATE TYPE "CreatorTvStatus" AS ENUM ('ACTIVE', 'OFF_AIR', 'DISABLED');
CREATE TYPE "TvScheduleSource" AS ENUM ('AUTO', 'MANUAL', 'ADMIN');
CREATE TYPE "TvScheduleStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED');
CREATE TYPE "SubscriptionNotificationLevel" AS ENUM ('NONE', 'PERSONALIZED', 'ALL');
CREATE TYPE "ReactionType" AS ENUM ('LIKE', 'DISLIKE');
CREATE TYPE "CommentStatus" AS ENUM ('PUBLISHED', 'HIDDEN', 'REMOVED');
CREATE TYPE "NotificationType" AS ENUM ('SYSTEM', 'CHANNEL', 'VIDEO', 'COMMENT', 'SUBSCRIPTION', 'MODERATION', 'MONETIZATION');
CREATE TYPE "RightsBasis" AS ENUM ('OWNED', 'LICENSED', 'AUTHORIZED', 'PUBLIC_DOMAIN', 'OTHER');
CREATE TYPE "RightsDeclarationStatus" AS ENUM ('CONFIRMED', 'REVOKED');
CREATE TYPE "ReportReason" AS ENUM ('COPYRIGHT', 'SPAM', 'HARASSMENT', 'HATE', 'SEXUAL_CONTENT', 'VIOLENCE', 'MISLEADING', 'OTHER');
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED');
CREATE TYPE "ModerationCaseStatus" AS ENUM ('OPEN', 'REVIEWING', 'ACTIONED', 'DISMISSED', 'CLOSED');
CREATE TYPE "PlatformSettingNamespace" AS ENUM ('CREATOR', 'UPLOAD', 'TV', 'DISCOVERY', 'ADVERTISING', 'MONETIZATION', 'MODERATION', 'PLATFORM');
CREATE TYPE "PlatformSettingValueType" AS ENUM ('BOOLEAN', 'INTEGER', 'DECIMAL', 'STRING', 'JSON');
CREATE TYPE "AdInventoryFamily" AS ENUM ('IN_PLAYER_VIDEO', 'OUTSIDE_PLAYER');
CREATE TYPE "AdPlacementFormat" AS ENUM ('PRE_ROLL', 'MID_ROLL', 'POST_ROLL', 'DISPLAY', 'NATIVE');
CREATE TYPE "AdvertiserStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "CreativeType" AS ENUM ('VIDEO', 'DISPLAY', 'NATIVE', 'VAST_TAG');
CREATE TYPE "CreativeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'REJECTED', 'ARCHIVED');
CREATE TYPE "AdEventType" AS ENUM ('REQUEST', 'FILL', 'IMPRESSION', 'START', 'QUARTILE_25', 'MIDPOINT', 'QUARTILE_75', 'COMPLETE', 'CLICK', 'ERROR');
CREATE TYPE "CreatorContractStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'ENDED');
CREATE TYPE "EarningsEntryType" AS ENUM ('AD_REVENUE', 'ADJUSTMENT', 'REVERSAL', 'PAYOUT');
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "passwordHash" VARCHAR(255),
    "displayName" VARCHAR(120) NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Account_email_key" UNIQUE ("email")
);

CREATE TABLE "ViewerProfile" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT FALSE,
    "isKids" BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "ViewerProfile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ViewerProfile_accountId_slug_key" UNIQUE ("accountId", "slug")
);

CREATE TABLE "Channel" (
    "id" UUID NOT NULL,
    "handle" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "status" "ChannelStatus" NOT NULL DEFAULT 'ACTIVE',
    "primaryTvChannelId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),
    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Channel_handle_key" UNIQUE ("handle"),
    CONSTRAINT "Channel_primaryTvChannelId_key" UNIQUE ("primaryTvChannelId")
);

CREATE TABLE "ChannelMember" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "role" "ChannelMemberRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChannelMember_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ChannelMember_channelId_accountId_key" UNIQUE ("channelId", "accountId")
);

CREATE TABLE "ChannelSettings" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "defaultVideoVisibility" "VideoVisibility" NOT NULL DEFAULT 'PUBLIC',
    "defaultCommentsEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "autoAddPublishedToUploads" BOOLEAN NOT NULL DEFAULT TRUE,
    "autoAddPublishedToTv" BOOLEAN NOT NULL DEFAULT TRUE,
    "tvAutoScheduleEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChannelSettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ChannelSettings_channelId_key" UNIQUE ("channelId")
);

CREATE TABLE "Video" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "status" "VideoStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" "VideoVisibility" NOT NULL DEFAULT 'PUBLIC',
    "commentsEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "durationMs" INTEGER,
    "scheduledPublishAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Video_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Video_slug_key" UNIQUE ("slug")
);

CREATE TABLE "MediaAsset" (
    "id" UUID NOT NULL,
    "videoId" UUID,
    "channelId" UUID,
    "kind" "MediaAssetKind" NOT NULL,
    "status" "MediaAssetStatus" NOT NULL DEFAULT 'PENDING',
    "r2ObjectKey" VARCHAR(1024) NOT NULL,
    "mimeType" VARCHAR(255) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "checksum" VARCHAR(128),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),
    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MediaAsset_r2ObjectKey_key" UNIQUE ("r2ObjectKey")
);

CREATE TABLE "Playlist" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "systemKey" "PlaylistSystemKey",
    "isProtected" BOOLEAN NOT NULL DEFAULT FALSE,
    "isPublic" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Playlist_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Playlist_channelId_slug_key" UNIQUE ("channelId", "slug"),
    CONSTRAINT "Playlist_channelId_systemKey_key" UNIQUE ("channelId", "systemKey")
);

CREATE TABLE "PlaylistItem" (
    "id" UUID NOT NULL,
    "playlistId" UUID NOT NULL,
    "videoId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlaylistItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlaylistItem_playlistId_videoId_key" UNIQUE ("playlistId", "videoId"),
    CONSTRAINT "PlaylistItem_playlistId_position_key" UNIQUE ("playlistId", "position")
);

CREATE TABLE "CreatorTvChannel" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "sourcePlaylistId" UUID,
    "slug" VARCHAR(160) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "CreatorTvStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "disabledAt" TIMESTAMP(3),
    CONSTRAINT "CreatorTvChannel_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CreatorTvChannel_slug_key" UNIQUE ("slug")
);

CREATE TABLE "TvScheduleItem" (
    "id" UUID NOT NULL,
    "tvChannelId" UUID NOT NULL,
    "videoId" UUID NOT NULL,
    "source" "TvScheduleSource" NOT NULL DEFAULT 'AUTO',
    "status" "TvScheduleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TvScheduleItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WatchProgress" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "videoId" UUID NOT NULL,
    "positionMs" INTEGER NOT NULL DEFAULT 0,
    "lastWatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WatchProgress_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WatchProgress_profileId_videoId_key" UNIQUE ("profileId", "videoId")
);

CREATE TABLE "WatchHistory" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "videoId" UUID NOT NULL,
    "firstWatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastWatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WatchHistory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WatchHistory_profileId_videoId_key" UNIQUE ("profileId", "videoId")
);

CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "notificationLevel" "SubscriptionNotificationLevel" NOT NULL DEFAULT 'PERSONALIZED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Subscription_profileId_channelId_key" UNIQUE ("profileId", "channelId")
);

CREATE TABLE "Reaction" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "videoId" UUID,
    "commentId" UUID,
    "type" "ReactionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Reaction_profileId_videoId_key" UNIQUE ("profileId", "videoId"),
    CONSTRAINT "Reaction_profileId_commentId_key" UNIQUE ("profileId", "commentId")
);

CREATE TABLE "Comment" (
    "id" UUID NOT NULL,
    "videoId" UUID NOT NULL,
    "authorProfileId" UUID NOT NULL,
    "parentId" UUID,
    "body" TEXT NOT NULL,
    "status" "CommentStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),
    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentRightsDeclaration" (
    "id" UUID NOT NULL,
    "videoId" UUID NOT NULL,
    "declaredByAccountId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "basis" "RightsBasis" NOT NULL,
    "status" "RightsDeclarationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "statement" TEXT,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "ContentRightsDeclaration_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ContentRightsDeclaration_videoId_version_key" UNIQUE ("videoId", "version")
);

CREATE TABLE "Report" (
    "id" UUID NOT NULL,
    "reporterProfileId" UUID NOT NULL,
    "moderationCaseId" UUID,
    "channelId" UUID,
    "videoId" UUID,
    "commentId" UUID,
    "reason" "ReportReason" NOT NULL,
    "details" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModerationCase" (
    "id" UUID NOT NULL,
    "assignedToAccountId" UUID,
    "status" "ModerationCaseStatus" NOT NULL DEFAULT 'OPEN',
    "summary" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "ModerationCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformSetting" (
    "id" UUID NOT NULL,
    "namespace" "PlatformSettingNamespace" NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "valueType" "PlatformSettingValueType" NOT NULL,
    "value" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "description" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlatformSetting_namespace_key_key" UNIQUE ("namespace", "key")
);

CREATE TABLE "FeatureFlag" (
    "id" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
    "rolloutPercentage" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FeatureFlag_key_key" UNIQUE ("key")
);

CREATE TABLE "AdminAuditLog" (
    "id" UUID NOT NULL,
    "actorAccountId" UUID,
    "action" VARCHAR(120) NOT NULL,
    "entityType" VARCHAR(120) NOT NULL,
    "entityId" VARCHAR(120),
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdPlacement" (
    "id" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "inventoryFamily" "AdInventoryFamily" NOT NULL,
    "format" "AdPlacementFormat" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdPlacement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AdPlacement_key_key" UNIQUE ("key")
);

CREATE TABLE "Advertiser" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "AdvertiserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Advertiser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Campaign" (
    "id" UUID NOT NULL,
    "advertiserId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "budget" DECIMAL(20,6),
    "currency" CHAR(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Creative" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "mediaAssetId" UUID,
    "name" VARCHAR(160) NOT NULL,
    "type" "CreativeType" NOT NULL,
    "status" "CreativeStatus" NOT NULL DEFAULT 'DRAFT',
    "destinationUrl" TEXT,
    "vastTagUrl" TEXT,
    "headline" VARCHAR(200),
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Creative_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdEvent" (
    "id" UUID NOT NULL,
    "placementId" UUID NOT NULL,
    "campaignId" UUID,
    "creativeId" UUID,
    "videoId" UUID,
    "profileId" UUID,
    "eventType" "AdEventType" NOT NULL,
    "requestId" VARCHAR(120),
    "sessionId" VARCHAR(120),
    "revenue" DECIMAL(20,6),
    "currency" CHAR(3),
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorContract" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "status" "CreatorContractStatus" NOT NULL DEFAULT 'PENDING',
    "revenueShareBps" INTEGER,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "termsVersion" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreatorContract_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EarningsLedgerEntry" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "contractId" UUID,
    "campaignId" UUID,
    "videoId" UUID,
    "payoutId" UUID,
    "type" "EarningsEntryType" NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "memo" VARCHAR(500),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EarningsLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Payout" (
    "id" UUID NOT NULL,
    "channelId" UUID NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(20,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "externalReference" VARCHAR(255),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);
