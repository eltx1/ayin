import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@ayin/db";

import { DatabaseService } from "../database/database.service.js";
import {
  MEDIA_STORAGE_ADAPTER,
  MEDIA_STORAGE_CONFIG,
  type MediaStorageAdapter,
} from "../media/media-storage.adapter.js";
import type { MediaStorageConfig } from "../media/media-storage.config.js";
import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";
import { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import type { CommunityPostInput } from "./community.schemas.js";

export class CommunityError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "CommunityError";
  }
}

@Injectable()
export class CommunityService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
    @Inject(MEDIA_STORAGE_ADAPTER) private readonly storage: MediaStorageAdapter,
    @Inject(MEDIA_STORAGE_CONFIG) private readonly storageConfig: MediaStorageConfig,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
  ) {}

  async creatorPosts(accountId: string) {
    const channel = await this.creatorChannel(accountId);
    return this.database.client.communityPost.findMany({
      where: { channelId: channel.id, status: { not: "REMOVED" } },
      orderBy: { createdAt: "desc" },
      include: this.include(),
    });
  }

  async create(accountId: string, input: CommunityPostInput) {
    await this.ensureEnabled();
    const channel = await this.creatorChannel(accountId);
    await this.validateInput(input);
    // Image posts cannot become visible until their separately uploaded object is validated.
    const status = input.scheduledPublishAt && input.type !== "IMAGE" ? "SCHEDULED" : "DRAFT";
    return this.database.client.communityPost.create({
      data: {
        channelId: channel.id,
        authorAccountId: accountId,
        type: input.type,
        status,
        body: input.body ?? null,
        sharedVideoId: input.sharedVideoId ?? null,
        scheduledPublishAt: input.scheduledPublishAt ? new Date(input.scheduledPublishAt) : null,
        ...(input.type === "POLL" && input.pollOptions
          ? {
              pollOptions: {
                create: input.pollOptions.map((label, position) => ({ label, position })),
              },
            }
          : {}),
      },
      include: this.include(),
    });
  }

  async update(accountId: string, postId: string, input: CommunityPostInput) {
    const post = await this.ownedPost(accountId, postId);
    if (post.status === "PUBLISHED")
      throw new CommunityError(
        "POST_ALREADY_PUBLISHED",
        "Published posts cannot change type or poll structure.",
        409,
      );
    await this.validateInput(input);
    return this.database.client.$transaction(async (tx) => {
      if (post.type === "POLL" || input.type === "POLL")
        await tx.communityPollOption.deleteMany({ where: { postId } });
      return tx.communityPost.update({
        where: { id: postId },
        data: {
          type: input.type,
          body: input.body ?? null,
          sharedVideoId: input.sharedVideoId ?? null,
          scheduledPublishAt: input.scheduledPublishAt ? new Date(input.scheduledPublishAt) : null,
          status:
            input.scheduledPublishAt &&
            (input.type !== "IMAGE" || post.imageAsset?.status === "VALIDATED")
              ? "SCHEDULED"
              : "DRAFT",
          ...(input.type === "POLL" && input.pollOptions
            ? {
                pollOptions: {
                  create: input.pollOptions.map((label, position) => ({ label, position })),
                },
              }
            : {}),
        },
        include: this.include(),
      });
    });
  }

  async publish(accountId: string, postId: string) {
    const post = await this.ownedPost(accountId, postId);
    await this.assertPublishable(post);
    return this.database.client.$transaction(async (tx) => {
      const published = await tx.communityPost.update({
        where: { id: postId },
        data: { status: "PUBLISHED", publishedAt: new Date(), scheduledPublishAt: null },
        include: this.include(),
      });
      if (!post.notifiedAt) {
        const subscribers = await tx.subscription.findMany({
          where: { channelId: post.channelId },
          select: { profile: { select: { accountId: true } } },
        });
        const accountIds = [...new Set(subscribers.map((item) => item.profile.accountId))];
        if (accountIds.length)
          await tx.notification.createMany({
            data: accountIds.map((targetAccountId) => ({
              accountId: targetAccountId,
              type: "CHANNEL" as const,
              title: `${post.channel.name} posted`,
              body: post.body?.slice(0, 180) ?? "New community post",
              data: { channelId: post.channelId, communityPostId: post.id },
            })),
          });
        await tx.communityPost.update({ where: { id: postId }, data: { notifiedAt: new Date() } });
      }
      return published;
    });
  }

  async remove(accountId: string, postId: string) {
    await this.ownedPost(accountId, postId);
    await this.database.client.communityPost.update({
      where: { id: postId },
      data: { status: "REMOVED", removedAt: new Date() },
    });
    return { id: postId, status: "REMOVED" as const };
  }

  async authorizeImage(
    accountId: string,
    postId: string,
    input: { mimeType: string; sizeBytes: number },
  ) {
    const post = await this.ownedPost(accountId, postId);
    if (post.type !== "IMAGE")
      throw new CommunityError("IMAGE_POST_REQUIRED", "Only image posts accept an image upload.");
    if (post.status === "PUBLISHED")
      throw new CommunityError(
        "PUBLISHED_IMAGE_IMMUTABLE",
        "Published image posts cannot replace their media. Create a new post instead.",
        409,
      );
    if (!this.storage.available)
      throw new CommunityError(
        "MEDIA_STORAGE_UNAVAILABLE",
        "Community image uploads require configured media storage.",
        503,
      );
    if (
      !(["image/jpeg", "image/png", "image/webp"] as string[]).includes(input.mimeType) ||
      input.sizeBytes < 1 ||
      input.sizeBytes > 10 * 1024 * 1024
    )
      throw new CommunityError(
        "INVALID_COMMUNITY_IMAGE",
        "Use a JPG, PNG or WebP image up to 10 MB.",
      );
    const assetId = randomUUID();
    const key = `channels/${post.channelId}/community/${post.id}/${assetId}`;
    await this.database.client.$transaction(async (tx) => {
      await tx.mediaAsset.create({
        data: {
          id: assetId,
          channelId: post.channelId,
          kind: "COMMUNITY_IMAGE",
          status: "PENDING",
          r2ObjectKey: key,
          mimeType: input.mimeType,
          sizeBytes: BigInt(input.sizeBytes),
        },
      });
      await tx.communityPost.update({
        where: { id: postId },
        data: { imageAssetId: assetId },
      });
      if (post.imageAssetId)
        await tx.mediaAsset.update({
          where: { id: post.imageAssetId },
          data: { status: "REMOVED", removedAt: new Date() },
        });
    });
    const authorization = await this.storage.authorizeSinglePut({
      key,
      contentType: input.mimeType,
      expiresInSeconds: this.storageConfig.uploadUrlTtlSeconds,
    });
    return {
      assetId,
      upload: {
        url: authorization.url,
        method: "PUT" as const,
        headers: { "content-type": input.mimeType },
      },
      expiresAt: authorization.expiresAt.toISOString(),
    };
  }

  async completeImage(
    accountId: string,
    postId: string,
    assetId: string,
    dimensions: { width?: number | undefined; height?: number | undefined } = {},
  ) {
    const post = await this.ownedPost(accountId, postId);
    if (post.imageAssetId !== assetId)
      throw new CommunityError("IMAGE_ASSET_MISMATCH", "This image does not belong to the post.");
    const asset = await this.database.client.mediaAsset.findUniqueOrThrow({
      where: { id: assetId },
    });
    const head = await this.storage.headObject(asset.r2ObjectKey);
    if (
      head.sizeBytes < 1 ||
      head.sizeBytes > 10 * 1024 * 1024 ||
      head.contentType !== asset.mimeType
    )
      throw new CommunityError(
        "INVALID_STORED_IMAGE",
        "The stored image did not match the authorized upload.",
      );
    await this.database.client.$transaction(async (tx) => {
      await tx.mediaAsset.update({
        where: { id: assetId },
        data: {
          status: "VALIDATED",
          sizeBytes: BigInt(head.sizeBytes),
          ...(dimensions.width ? { width: dimensions.width } : {}),
          ...(dimensions.height ? { height: dimensions.height } : {}),
        },
      });
      if (post.scheduledPublishAt)
        await tx.communityPost.update({
          where: { id: postId },
          data: { status: "SCHEDULED" },
        });
    });
    return { assetId, status: "VALIDATED" as const };
  }

  async channelPosts(handle: string, take = 30) {
    await this.ensureEnabled();
    const channel = await this.database.client.channel.findFirst({
      where: { handle, status: "ACTIVE", removedAt: null },
      select: { id: true, handle: true, name: true },
    });
    if (!channel)
      throw new CommunityError("CHANNEL_NOT_FOUND", "This channel is not available.", 404);
    const items = await this.visiblePosts({ channelId: channel.id }, take);
    return { channel, items };
  }

  async subscriberFeed(accountId: string, take = 50) {
    await this.ensureEnabled();
    const profile = await this.profile(accountId);
    const subscriptions = await this.database.client.subscription.findMany({
      where: { profileId: profile.id },
      select: { channelId: true },
    });
    return {
      items: await this.visiblePosts(
        { channelId: { in: subscriptions.map((item) => item.channelId) } },
        take,
      ),
    };
  }

  async react(accountId: string, postId: string, liked: boolean) {
    const profile = await this.profile(accountId);
    await this.publicPost(postId);
    if (liked)
      await this.database.client.communityPostReaction.upsert({
        where: { postId_profileId: { postId, profileId: profile.id } },
        create: { postId, profileId: profile.id, type: "LIKE" },
        update: { type: "LIKE" },
      });
    else
      await this.database.client.communityPostReaction.deleteMany({
        where: { postId, profileId: profile.id },
      });
    return {
      postId,
      liked,
      likeCount: await this.database.client.communityPostReaction.count({
        where: { postId, type: "LIKE" },
      }),
    };
  }

  async vote(accountId: string, postId: string, optionId: string) {
    const profile = await this.profile(accountId);
    const post = await this.publicPost(postId);
    if (post.type !== "POLL" || !post.pollOptions.some((option) => option.id === optionId))
      throw new CommunityError("INVALID_POLL_OPTION", "That poll option is not available.");
    await this.database.client.communityPollVote.upsert({
      where: { postId_profileId: { postId, profileId: profile.id } },
      create: { postId, optionId, profileId: profile.id },
      update: { optionId },
    });
    return this.publicPost(postId);
  }

  async comment(accountId: string, postId: string, body: string, parentId?: string) {
    const profile = await this.profile(accountId);
    await this.publicPost(postId);
    if (parentId) {
      const parent = await this.database.client.communityPostComment.findFirst({
        where: { id: parentId, postId, status: "PUBLISHED" },
        select: { id: true },
      });
      if (!parent)
        throw new CommunityError("COMMENT_PARENT_NOT_FOUND", "The parent comment is unavailable.");
    }
    return this.database.client.communityPostComment.create({
      data: { postId, authorProfileId: profile.id, body, ...(parentId ? { parentId } : {}) },
      select: { id: true, body: true, createdAt: true },
    });
  }

  async report(
    accountId: string,
    postId: string,
    input: { reason: string; details?: string | null | undefined },
  ) {
    const profile = await this.profile(accountId);
    await this.publicPost(postId);
    const report = await this.database.client.communityPostReport.create({
      data: {
        postId,
        reporterProfileId: profile.id,
        reason: input.reason as never,
        details: input.details ?? null,
      },
    });
    return { id: report.id, status: report.status };
  }

  async adminQueue() {
    return this.database.client.communityPostReport.findMany({
      where: { status: { in: ["OPEN", "REVIEWING"] } },
      orderBy: { createdAt: "asc" },
      include: {
        post: { include: { channel: { select: { id: true, name: true, handle: true } } } },
        reporterProfile: { select: { id: true, name: true } },
      },
    });
  }
  async adminModerate(
    actorAccountId: string,
    postId: string,
    action: "HIDE" | "REMOVE" | "RESTORE",
    reason: string,
  ) {
    const status = action === "HIDE" ? "HIDDEN" : action === "REMOVE" ? "REMOVED" : "PUBLISHED";
    return this.database.client.$transaction(async (tx) => {
      const post = await tx.communityPost.update({
        where: { id: postId },
        data: {
          status,
          ...(status === "REMOVED" ? { removedAt: new Date() } : { removedAt: null }),
        },
      });
      await tx.communityPostReport.updateMany({
        where: { postId, status: { in: ["OPEN", "REVIEWING"] } },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: `COMMUNITY_POST_${action}`,
        entityType: "CommunityPost",
        entityId: postId,
        reason,
      });
      return post;
    });
  }

  private include(): Prisma.CommunityPostInclude {
    return {
      channel: { select: { id: true, handle: true, name: true } },
      imageAsset: {
        select: {
          id: true,
          r2ObjectKey: true,
          status: true,
          width: true,
          height: true,
        },
      },
      sharedVideo: { select: { id: true, slug: true, title: true } },
      pollOptions: {
        orderBy: { position: "asc" },
        include: { _count: { select: { votes: true } } },
      },
      _count: { select: { reactions: true, comments: true, reports: true } },
    };
  }
  private async visiblePosts(where: Prisma.CommunityPostWhereInput, take: number) {
    const now = new Date();
    return this.database.client.communityPost.findMany({
      where: {
        ...where,
        removedAt: null,
        AND: [
          {
            OR: [
              { status: "PUBLISHED", publishedAt: { lte: now } },
              { status: "SCHEDULED", scheduledPublishAt: { lte: now } },
            ],
          },
          {
            OR: [{ type: { not: "IMAGE" } }, { imageAsset: { is: { status: "VALIDATED" } } }],
          },
        ],
      },
      orderBy: [{ publishedAt: "desc" }, { scheduledPublishAt: "desc" }, { createdAt: "desc" }],
      take: Math.min(Math.max(take, 1), 100),
      include: this.include(),
    });
  }
  private async creatorChannel(accountId: string) {
    const membership = await this.database.client.channelMember.findFirst({
      where: {
        accountId,
        role: { in: ["OWNER", "ADMIN", "EDITOR"] },
        channel: { status: "ACTIVE", removedAt: null },
      },
      select: { channel: { select: { id: true, name: true } } },
    });
    if (!membership)
      throw new CommunityError(
        "CREATOR_CHANNEL_REQUIRED",
        "An active creator channel is required.",
        403,
      );
    return membership.channel;
  }
  private async ownedPost(accountId: string, postId: string) {
    const post = await this.database.client.communityPost.findFirst({
      where: {
        id: postId,
        channel: { members: { some: { accountId, role: { in: ["OWNER", "ADMIN", "EDITOR"] } } } },
        status: { not: "REMOVED" },
      },
      include: {
        channel: { select: { id: true, name: true } },
        imageAsset: true,
        pollOptions: true,
      },
    });
    if (!post)
      throw new CommunityError("POST_NOT_FOUND", "This community post is unavailable.", 404);
    return post;
  }
  private async profile(accountId: string) {
    const profile = await this.database.client.viewerProfile.findFirst({
      where: { accountId, isDefault: true, deletedAt: null },
      select: { id: true },
    });
    if (!profile)
      throw new CommunityError("PROFILE_REQUIRED", "A viewer profile is required.", 403);
    return profile;
  }
  private async publicPost(postId: string) {
    const now = new Date();
    const post = await this.database.client.communityPost.findFirst({
      where: {
        id: postId,
        removedAt: null,
        channel: { status: "ACTIVE", removedAt: null },
        AND: [
          {
            OR: [
              { status: "PUBLISHED", publishedAt: { lte: now } },
              { status: "SCHEDULED", scheduledPublishAt: { lte: now } },
            ],
          },
          {
            OR: [{ type: { not: "IMAGE" } }, { imageAsset: { is: { status: "VALIDATED" } } }],
          },
        ],
      },
      include: { pollOptions: true },
    });
    if (!post)
      throw new CommunityError("POST_NOT_FOUND", "This community post is unavailable.", 404);
    return post;
  }
  private async ensureEnabled() {
    if (!((await this.settings.get("communityPostsEnabled")) as boolean))
      throw new CommunityError(
        "COMMUNITY_DISABLED",
        "Community posts are currently disabled.",
        404,
      );
  }
  private async validateInput(input: CommunityPostInput) {
    if (input.type === "POLL" && (!input.pollOptions || input.pollOptions.length < 2))
      throw new CommunityError("POLL_OPTIONS_REQUIRED", "Polls require at least two options.");
    if (input.type === "VIDEO_SHARE") {
      if (!input.sharedVideoId)
        throw new CommunityError("SHARED_VIDEO_REQUIRED", "Choose a published video to share.");
      const video = await this.database.client.video.findFirst({
        where: {
          id: input.sharedVideoId,
          status: "PUBLISHED",
          visibility: { in: ["PUBLIC", "UNLISTED"] },
          removedAt: null,
        },
        select: { id: true },
      });
      if (!video)
        throw new CommunityError("SHARED_VIDEO_NOT_FOUND", "The shared video is unavailable.");
    }
    if ((input.type === "TEXT" || input.type === "IMAGE") && !input.body?.trim())
      throw new CommunityError("POST_BODY_REQUIRED", "Add text to the community post.");
  }
  private async assertPublishable(post: Awaited<ReturnType<CommunityService["ownedPost"]>>) {
    if (post.type === "IMAGE" && post.imageAsset?.status !== "VALIDATED")
      throw new CommunityError(
        "COMMUNITY_IMAGE_REQUIRED",
        "Upload and validate the image before publishing.",
      );
    if (post.type === "POLL" && post.pollOptions.length < 2)
      throw new CommunityError("POLL_OPTIONS_REQUIRED", "Polls require at least two options.");
  }
}
