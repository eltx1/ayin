import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { canEditComment, defaultCommentPolicy, normalizeCommentBody, type CommentPolicy } from "./comment-policy.js";
import { CommentRateLimiter } from "./comment-rate-limiter.js";

export class CommentsError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "CommentsError";
  }
}

@Injectable()
export class CommentsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CommentRateLimiter) private readonly rateLimiter: CommentRateLimiter,
  ) {}

  async list(videoId: string, cursor = 0, limit = 30) {
    const video = await this.database.client.video.findUnique({
      where: { id: videoId },
      select: { id: true, commentsEnabled: true, status: true, visibility: true },
    });
    if (!video || video.status !== "PUBLISHED" || video.visibility !== "PUBLIC") {
      throw new CommentsError("VIDEO_NOT_FOUND", "Video not found.", 404);
    }
    if (!video.commentsEnabled) return { enabled: false, items: [], nextCursor: null };
    const rows = await this.database.client.comment.findMany({
      where: { videoId, parentId: null, status: "PUBLISHED" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: cursor,
      take: limit + 1,
      select: {
        id: true,
        body: true,
        createdAt: true,
        updatedAt: true,
        authorProfileId: true,
        authorProfile: { select: { name: true, slug: true } },
        reactions: { where: { type: "LIKE" }, select: { id: true } },
        replies: {
          where: { status: "PUBLISHED" },
          orderBy: { createdAt: "asc" },
          take: 20,
          select: {
            id: true,
            body: true,
            createdAt: true,
            updatedAt: true,
            authorProfileId: true,
            authorProfile: { select: { name: true, slug: true } },
            reactions: { where: { type: "LIKE" }, select: { id: true } },
          },
        },
      },
    });
    const ids = rows.flatMap((row) => [row.id, ...row.replies.map((reply) => reply.id)]);
    const controls = ids.length
      ? await this.database.client.commentControl.findMany({ where: { commentId: { in: ids } } })
      : [];
    const state = new Map(controls.map((item) => [item.commentId, item]));
    const page = rows.slice(0, limit).map((row) => ({
      ...row,
      likeCount: row.reactions.length,
      reactions: undefined,
      creatorHearted: Boolean(state.get(row.id)?.creatorHeartedAt),
      pinned: Boolean(state.get(row.id)?.pinnedAt),
      edited: Boolean(state.get(row.id)?.editedAt),
      replies: row.replies.map((reply) => ({
        ...reply,
        likeCount: reply.reactions.length,
        reactions: undefined,
        creatorHearted: Boolean(state.get(reply.id)?.creatorHeartedAt),
        edited: Boolean(state.get(reply.id)?.editedAt),
      })),
    }));
    page.sort((a, b) => Number(b.pinned) - Number(a.pinned));
    return { enabled: true, items: page, nextCursor: rows.length > limit ? cursor + limit : null };
  }

  async create(accountId: string, videoId: string, body: string, parentId?: string, requestedProfileId?: string) {
    this.rateLimiter.consume(`write:${accountId}`);
    const [profile, video, policy] = await Promise.all([
      this.resolveProfile(accountId, requestedProfileId),
      this.database.client.video.findUnique({ where: { id: videoId }, select: { id: true, channelId: true, commentsEnabled: true, status: true, visibility: true } }),
      this.policy(),
    ]);
    if (!video || video.status !== "PUBLISHED" || video.visibility === "PRIVATE") throw new CommentsError("VIDEO_NOT_FOUND", "Video not found.", 404);
    if (!video.commentsEnabled) throw new CommentsError("COMMENTS_DISABLED", "Comments are disabled for this video.", 409);
    const hidden = await this.database.client.channelHiddenProfile.findUnique({ where: { channelId_profileId: { channelId: video.channelId, profileId: profile.id } }, select: { id: true } });
    if (hidden) throw new CommentsError("PROFILE_HIDDEN", "You cannot comment on this channel.", 403);
    if (parentId) {
      const parent = await this.database.client.comment.findUnique({ where: { id: parentId }, select: { videoId: true, parentId: true, status: true } });
      if (!parent || parent.videoId !== videoId || parent.status !== "PUBLISHED") throw new CommentsError("PARENT_NOT_FOUND", "Reply target not found.", 404);
      if (parent.parentId) throw new CommentsError("THREAD_DEPTH_LIMIT", "Replies are limited to one nested level.", 409);
    }
    let normalized: string;
    try { normalized = normalizeCommentBody(body, policy); } catch (error) { throw this.policyError(error); }
    return this.database.client.comment.create({ data: { videoId, authorProfileId: profile.id, parentId, body: normalized }, select: { id: true, body: true, parentId: true, createdAt: true } });
  }

  async edit(accountId: string, commentId: string, body: string) {
    this.rateLimiter.consume(`write:${accountId}`);
    const [comment, policy] = await Promise.all([
      this.database.client.comment.findUnique({ where: { id: commentId }, select: { id: true, authorProfile: { select: { accountId: true } }, createdAt: true, status: true } }),
      this.policy(),
    ]);
    if (!comment || comment.status !== "PUBLISHED") throw new CommentsError("COMMENT_NOT_FOUND", "Comment not found.", 404);
    if (comment.authorProfile.accountId !== accountId) throw new CommentsError("COMMENT_FORBIDDEN", "You can edit only your own comment.", 403);
    if (!canEditComment(comment.createdAt, new Date(), policy)) throw new CommentsError("EDIT_WINDOW_EXPIRED", "The comment edit window has expired.", 409);
    let normalized: string;
    try { normalized = normalizeCommentBody(body, policy); } catch (error) { throw this.policyError(error); }
    return this.database.client.$transaction(async (tx) => {
      const updated = await tx.comment.update({ where: { id: commentId }, data: { body: normalized }, select: { id: true, body: true, updatedAt: true } });
      await tx.commentControl.upsert({ where: { commentId }, update: { editedAt: new Date() }, create: { commentId, editedAt: new Date() } });
      return updated;
    });
  }

  async remove(accountId: string, commentId: string) {
    const comment = await this.ownedOrModeratable(accountId, commentId);
    return this.database.client.comment.update({ where: { id: comment.id }, data: { status: "REMOVED", removedAt: new Date(), body: "[removed]" }, select: { id: true, status: true } });
  }

  async setLike(accountId: string, commentId: string, enabled: boolean, requestedProfileId?: string) {
    this.rateLimiter.consume(`reaction:${accountId}`, 90);
    const profile = await this.resolveProfile(accountId, requestedProfileId);
    await this.assertPublishedComment(commentId);
    if (enabled) {
      await this.database.client.reaction.upsert({ where: { profileId_commentId: { profileId: profile.id, commentId } }, update: { type: "LIKE" }, create: { profileId: profile.id, commentId, type: "LIKE" } });
    } else {
      await this.database.client.reaction.deleteMany({ where: { profileId: profile.id, commentId } });
    }
    return { commentId, liked: enabled };
  }

  async creatorMark(accountId: string, commentId: string, kind: "heart" | "pin", enabled: boolean) {
    const comment = await this.ownedOrModeratable(accountId, commentId, true);
    const now = enabled ? new Date() : null;
    await this.database.client.commentControl.upsert({
      where: { commentId },
      create: { commentId, creatorHeartedAt: kind === "heart" ? now : null, pinnedAt: kind === "pin" ? now : null, pinnedByAccountId: kind === "pin" && enabled ? accountId : null },
      update: kind === "heart" ? { creatorHeartedAt: now } : { pinnedAt: now, pinnedByAccountId: enabled ? accountId : null },
    });
    return { commentId, [kind === "heart" ? "creatorHearted" : "pinned"]: enabled, channelId: comment.video.channelId };
  }

  async report(accountId: string, commentId: string, reason: "SPAM" | "HARASSMENT" | "HATE" | "SEXUAL_CONTENT" | "VIOLENCE" | "MISLEADING" | "OTHER", details?: string, requestedProfileId?: string) {
    this.rateLimiter.consume(`report:${accountId}`, 10);
    const profile = await this.resolveProfile(accountId, requestedProfileId);
    await this.assertPublishedComment(commentId);
    return this.database.client.report.create({ data: { reporterProfileId: profile.id, commentId, reason, details: details?.trim().slice(0, 2_000) || null }, select: { id: true, status: true, createdAt: true } });
  }

  async setVideoComments(accountId: string, videoId: string, enabled: boolean) {
    const video = await this.database.client.video.findUnique({ where: { id: videoId }, select: { id: true, channelId: true } });
    if (!video || !(await this.canModerateChannel(accountId, video.channelId))) throw new CommentsError("VIDEO_FORBIDDEN", "You cannot change comments for this video.", 403);
    await this.database.client.video.update({ where: { id: videoId }, data: { commentsEnabled: enabled } });
    return { videoId, commentsEnabled: enabled };
  }

  async hideProfile(accountId: string, channelId: string, profileId: string, hidden: boolean) {
    if (!(await this.canModerateChannel(accountId, channelId))) throw new CommentsError("CHANNEL_FORBIDDEN", "You cannot moderate this channel.", 403);
    if (hidden) {
      await this.database.client.channelHiddenProfile.upsert({ where: { channelId_profileId: { channelId, profileId } }, update: { hiddenByAccountId: accountId }, create: { channelId, profileId, hiddenByAccountId: accountId } });
      await this.database.client.comment.updateMany({ where: { authorProfileId: profileId, video: { channelId }, status: "PUBLISHED" }, data: { status: "HIDDEN" } });
    } else {
      await this.database.client.channelHiddenProfile.deleteMany({ where: { channelId, profileId } });
    }
    return { channelId, profileId, hidden };
  }

  async moderate(accountId: string, commentId: string, status: "PUBLISHED" | "HIDDEN" | "REMOVED", reason?: string) {
    const comment = await this.ownedOrModeratable(accountId, commentId, true);
    await this.database.client.$transaction([
      this.database.client.comment.update({ where: { id: commentId }, data: { status, removedAt: status === "REMOVED" ? new Date() : null } }),
      this.database.client.adminAuditLog.create({ data: { actorAccountId: accountId, action: "COMMENT_MODERATE", entityType: "Comment", entityId: commentId, reason: reason?.trim().slice(0, 1_000) || null, metadata: { status, channelId: comment.video.channelId } } }),
    ]);
    return { commentId, status };
  }

  private async ownedOrModeratable(accountId: string, commentId: string, moderatorOnly = false) {
    const comment = await this.database.client.comment.findUnique({ where: { id: commentId }, select: { id: true, authorProfile: { select: { accountId: true } }, video: { select: { channelId: true } } } });
    if (!comment) throw new CommentsError("COMMENT_NOT_FOUND", "Comment not found.", 404);
    const own = comment.authorProfile.accountId === accountId;
    const moderator = await this.canModerateChannel(accountId, comment.video.channelId);
    if ((moderatorOnly && !moderator) || (!moderatorOnly && !own && !moderator)) throw new CommentsError("COMMENT_FORBIDDEN", "You cannot moderate this comment.", 403);
    return comment;
  }

  private async canModerateChannel(accountId: string, channelId: string) {
    const [member, admin] = await Promise.all([
      this.database.client.channelMember.findFirst({ where: { accountId, channelId, role: { in: ["OWNER", "ADMIN"] } }, select: { id: true } }),
      this.database.client.adminRoleAssignment.findFirst({ where: { accountId }, select: { id: true } }),
    ]);
    return Boolean(member || admin);
  }

  private async assertPublishedComment(commentId: string) {
    const comment = await this.database.client.comment.findUnique({ where: { id: commentId }, select: { status: true } });
    if (!comment || comment.status !== "PUBLISHED") throw new CommentsError("COMMENT_NOT_FOUND", "Comment not found.", 404);
  }

  private async resolveProfile(accountId: string, requestedProfileId?: string) {
    const profile = requestedProfileId
      ? await this.database.client.viewerProfile.findFirst({ where: { id: requestedProfileId, accountId, deletedAt: null }, select: { id: true } })
      : await this.database.client.viewerProfile.findFirst({ where: { accountId, deletedAt: null }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: { id: true } });
    if (!profile) throw new CommentsError("PROFILE_NOT_FOUND", "A viewer profile is required.", 403);
    return profile;
  }

  private async policy(): Promise<CommentPolicy> {
    const rows = await this.database.client.platformSetting.findMany({
      where: { namespace: "MODERATION", key: { in: ["commentMaxLength", "commentBlockedTerms", "commentEditWindowMinutes"] } },
      select: { key: true, value: true },
    });
    const values = new Map(rows.map((row) => [row.key, row.value]));
    const maxLength = Number(values.get("commentMaxLength"));
    const editWindowMinutes = Number(values.get("commentEditWindowMinutes"));
    const blocked = values.get("commentBlockedTerms");
    return {
      maxLength: Number.isInteger(maxLength) && maxLength >= 100 && maxLength <= 10_000 ? maxLength : defaultCommentPolicy.maxLength,
      editWindowMinutes: Number.isInteger(editWindowMinutes) && editWindowMinutes >= 1 && editWindowMinutes <= 1_440 ? editWindowMinutes : defaultCommentPolicy.editWindowMinutes,
      blockedTerms: Array.isArray(blocked) ? blocked.filter((value): value is string => typeof value === "string").slice(0, 500) : [],
    };
  }

  private policyError(error: unknown) {
    const code = error instanceof Error ? error.message : "COMMENT_INVALID";
    const messages: Record<string, string> = { COMMENT_EMPTY: "Comment cannot be empty.", COMMENT_TOO_LONG: "Comment is too long.", COMMENT_BLOCKED_TERM: "Comment contains a blocked term." };
    return new CommentsError(code, messages[code] ?? "Comment is invalid.", code === "COMMENT_BLOCKED_TERM" ? 422 : 400);
  }
}
