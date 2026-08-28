-- CreateIndex
CREATE INDEX "Account_status_createdAt_idx" ON "Account"("status", "createdAt");
CREATE INDEX "ViewerProfile_accountId_isDefault_idx" ON "ViewerProfile"("accountId", "isDefault");
CREATE INDEX "Channel_status_createdAt_idx" ON "Channel"("status", "createdAt");
CREATE INDEX "ChannelMember_accountId_role_idx" ON "ChannelMember"("accountId", "role");
CREATE INDEX "ChannelMember_channelId_role_idx" ON "ChannelMember"("channelId", "role");
CREATE INDEX "Video_channelId_status_publishedAt_idx" ON "Video"("channelId", "status", "publishedAt");
CREATE INDEX "Video_status_visibility_publishedAt_idx" ON "Video"("status", "visibility", "publishedAt");
CREATE INDEX "Video_scheduledPublishAt_status_idx" ON "Video"("scheduledPublishAt", "status");
CREATE INDEX "MediaAsset_videoId_kind_status_idx" ON "MediaAsset"("videoId", "kind", "status");
CREATE INDEX "MediaAsset_channelId_kind_idx" ON "MediaAsset"("channelId", "kind");
CREATE INDEX "Playlist_channelId_createdAt_idx" ON "Playlist"("channelId", "createdAt");
CREATE INDEX "PlaylistItem_videoId_idx" ON "PlaylistItem"("videoId");
CREATE INDEX "CreatorTvChannel_channelId_status_idx" ON "CreatorTvChannel"("channelId", "status");
CREATE INDEX "CreatorTvChannel_sourcePlaylistId_idx" ON "CreatorTvChannel"("sourcePlaylistId");
CREATE INDEX "TvScheduleItem_tvChannelId_startsAt_idx" ON "TvScheduleItem"("tvChannelId", "startsAt");
CREATE INDEX "TvScheduleItem_status_startsAt_idx" ON "TvScheduleItem"("status", "startsAt");
CREATE INDEX "TvScheduleItem_videoId_startsAt_idx" ON "TvScheduleItem"("videoId", "startsAt");
CREATE INDEX "WatchProgress_profileId_lastWatchedAt_idx" ON "WatchProgress"("profileId", "lastWatchedAt");
CREATE INDEX "WatchProgress_videoId_lastWatchedAt_idx" ON "WatchProgress"("videoId", "lastWatchedAt");
CREATE INDEX "WatchHistory_profileId_lastWatchedAt_idx" ON "WatchHistory"("profileId", "lastWatchedAt");
CREATE INDEX "Subscription_channelId_createdAt_idx" ON "Subscription"("channelId", "createdAt");
CREATE INDEX "Subscription_profileId_createdAt_idx" ON "Subscription"("profileId", "createdAt");
CREATE INDEX "Reaction_videoId_type_idx" ON "Reaction"("videoId", "type");
CREATE INDEX "Reaction_commentId_type_idx" ON "Reaction"("commentId", "type");
CREATE INDEX "Comment_videoId_status_createdAt_idx" ON "Comment"("videoId", "status", "createdAt");
CREATE INDEX "Comment_parentId_createdAt_idx" ON "Comment"("parentId", "createdAt");
CREATE INDEX "Comment_authorProfileId_createdAt_idx" ON "Comment"("authorProfileId", "createdAt");
CREATE INDEX "Notification_accountId_readAt_createdAt_idx" ON "Notification"("accountId", "readAt", "createdAt");
CREATE INDEX "ContentRightsDeclaration_declaredByAccountId_declaredAt_idx" ON "ContentRightsDeclaration"("declaredByAccountId", "declaredAt");
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");
CREATE INDEX "Report_moderationCaseId_createdAt_idx" ON "Report"("moderationCaseId", "createdAt");
CREATE INDEX "Report_videoId_status_idx" ON "Report"("videoId", "status");
CREATE INDEX "Report_channelId_status_idx" ON "Report"("channelId", "status");
CREATE INDEX "Report_commentId_status_idx" ON "Report"("commentId", "status");
CREATE INDEX "ModerationCase_status_createdAt_idx" ON "ModerationCase"("status", "createdAt");
CREATE INDEX "ModerationCase_assignedToAccountId_status_idx" ON "ModerationCase"("assignedToAccountId", "status");
CREATE INDEX "PlatformSetting_namespace_idx" ON "PlatformSetting"("namespace");
CREATE INDEX "FeatureFlag_enabled_key_idx" ON "FeatureFlag"("enabled", "key");
CREATE INDEX "AdminAuditLog_actorAccountId_createdAt_idx" ON "AdminAuditLog"("actorAccountId", "createdAt");
CREATE INDEX "AdminAuditLog_entityType_entityId_createdAt_idx" ON "AdminAuditLog"("entityType", "entityId", "createdAt");
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt");
CREATE INDEX "AdPlacement_inventoryFamily_enabled_idx" ON "AdPlacement"("inventoryFamily", "enabled");
CREATE INDEX "Advertiser_status_createdAt_idx" ON "Advertiser"("status", "createdAt");
CREATE INDEX "Campaign_advertiserId_status_idx" ON "Campaign"("advertiserId", "status");
CREATE INDEX "Campaign_status_startsAt_endsAt_idx" ON "Campaign"("status", "startsAt", "endsAt");
CREATE INDEX "Creative_campaignId_status_idx" ON "Creative"("campaignId", "status");
CREATE INDEX "Creative_mediaAssetId_idx" ON "Creative"("mediaAssetId");
CREATE INDEX "AdEvent_placementId_occurredAt_idx" ON "AdEvent"("placementId", "occurredAt");
CREATE INDEX "AdEvent_campaignId_occurredAt_idx" ON "AdEvent"("campaignId", "occurredAt");
CREATE INDEX "AdEvent_creativeId_occurredAt_idx" ON "AdEvent"("creativeId", "occurredAt");
CREATE INDEX "AdEvent_videoId_occurredAt_idx" ON "AdEvent"("videoId", "occurredAt");
CREATE INDEX "AdEvent_profileId_occurredAt_idx" ON "AdEvent"("profileId", "occurredAt");
CREATE INDEX "AdEvent_eventType_occurredAt_idx" ON "AdEvent"("eventType", "occurredAt");
CREATE INDEX "CreatorContract_channelId_status_effectiveFrom_idx" ON "CreatorContract"("channelId", "status", "effectiveFrom");
CREATE INDEX "EarningsLedgerEntry_channelId_occurredAt_idx" ON "EarningsLedgerEntry"("channelId", "occurredAt");
CREATE INDEX "EarningsLedgerEntry_contractId_occurredAt_idx" ON "EarningsLedgerEntry"("contractId", "occurredAt");
CREATE INDEX "EarningsLedgerEntry_payoutId_idx" ON "EarningsLedgerEntry"("payoutId");
CREATE INDEX "EarningsLedgerEntry_type_occurredAt_idx" ON "EarningsLedgerEntry"("type", "occurredAt");
CREATE INDEX "Payout_channelId_status_requestedAt_idx" ON "Payout"("channelId", "status", "requestedAt");
CREATE INDEX "Payout_status_requestedAt_idx" ON "Payout"("status", "requestedAt");

-- AddCheckConstraint
ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_exactly_one_target_check" CHECK (num_nonnulls("videoId", "commentId") = 1);
ALTER TABLE "Report" ADD CONSTRAINT "Report_exactly_one_target_check" CHECK (num_nonnulls("channelId", "videoId", "commentId") = 1);
ALTER TABLE "Playlist" ADD CONSTRAINT "Playlist_system_playlist_protected_check" CHECK ("systemKey" IS NULL OR "isProtected" = TRUE);
ALTER TABLE "PlatformSetting" ADD CONSTRAINT "PlatformSetting_declared_type_check" CHECK (
  "valueType" = 'JSON'
  OR ("valueType" = 'BOOLEAN' AND jsonb_typeof("value") = 'boolean')
  OR ("valueType" IN ('INTEGER', 'DECIMAL') AND jsonb_typeof("value") = 'number')
  OR ("valueType" = 'STRING' AND jsonb_typeof("value") = 'string')
);
ALTER TABLE "AdPlacement" ADD CONSTRAINT "AdPlacement_inventory_format_check" CHECK (
  ("inventoryFamily" = 'IN_PLAYER_VIDEO' AND "format" IN ('PRE_ROLL', 'MID_ROLL', 'POST_ROLL'))
  OR ("inventoryFamily" = 'OUTSIDE_PLAYER' AND "format" IN ('DISPLAY', 'NATIVE'))
);
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_rolloutPercentage_check" CHECK ("rolloutPercentage" BETWEEN 0 AND 100);
ALTER TABLE "TvScheduleItem" ADD CONSTRAINT "TvScheduleItem_time_range_check" CHECK ("endsAt" > "startsAt");
ALTER TABLE "WatchProgress" ADD CONSTRAINT "WatchProgress_positionMs_check" CHECK ("positionMs" >= 0);
ALTER TABLE "WatchHistory" ADD CONSTRAINT "WatchHistory_viewCount_check" CHECK ("viewCount" >= 1);
ALTER TABLE "PlaylistItem" ADD CONSTRAINT "PlaylistItem_position_check" CHECK ("position" >= 0);
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_sizeBytes_check" CHECK ("sizeBytes" >= 0);
ALTER TABLE "Video" ADD CONSTRAINT "Video_durationMs_check" CHECK ("durationMs" IS NULL OR "durationMs" >= 0);
ALTER TABLE "CreatorContract" ADD CONSTRAINT "CreatorContract_revenueShareBps_check" CHECK ("revenueShareBps" IS NULL OR "revenueShareBps" BETWEEN 0 AND 10000);
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_time_range_check" CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt");
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_amount_check" CHECK ("amount" > 0);
