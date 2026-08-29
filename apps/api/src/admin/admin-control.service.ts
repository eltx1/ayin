import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { AdminAuditLogService } from "./admin-audit-log.service.js";
import { adminBadRequest } from "./admin.errors.js";

interface PageInput {
  page?: number | undefined;
  take?: number | undefined;
  query?: string | undefined;
}

interface UserFilters extends PageInput {
  status?: "ACTIVE" | "SUSPENDED" | "CLOSED" | undefined;
}

interface ChannelFilters extends PageInput {
  status?: "ACTIVE" | "HIDDEN" | "SUSPENDED" | "REMOVED" | undefined;
}

interface VideoFilters extends PageInput {
  status?: "DRAFT" | "UPLOADING" | "VALIDATING" | "SCHEDULED" | "PUBLISHED" | "REMOVED" | undefined;
  visibility?: "PUBLIC" | "UNLISTED" | "PRIVATE" | undefined;
  channelId?: string | undefined;
}

interface TvFilters extends PageInput {
  status?: "ACTIVE" | "OFF_AIR" | "DISABLED" | undefined;
}

export interface AdminAccountPatch {
  displayName?: string | undefined;
  status?: "ACTIVE" | "SUSPENDED" | undefined;
  reason?: string | undefined;
}

export interface AdminChannelPatch {
  name?: string | undefined;
  description?: string | null | undefined;
  status?: "ACTIVE" | "HIDDEN" | "SUSPENDED" | undefined;
  contractStatus?: "PENDING" | "ACTIVE" | "SUSPENDED" | "ENDED" | undefined;
  revenueShareBps?: number | null | undefined;
  reason?: string | undefined;
}

export interface AdminVideoPatch {
  title?: string | undefined;
  description?: string | null | undefined;
  status?: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "REMOVED" | undefined;
  visibility?: "PUBLIC" | "UNLISTED" | "PRIVATE" | undefined;
  commentsEnabled?: boolean | undefined;
  tvIncluded?: boolean | undefined;
  reason?: string | undefined;
}

@Injectable()
export class AdminControlService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
  ) {}

  async dashboard() {
    const [accounts, activeAccounts, channels, videos, publishedVideos, tvChannels, openReports, openCases] =
      await Promise.all([
        this.database.client.account.count(),
        this.database.client.account.count({ where: { status: "ACTIVE" } }),
        this.database.client.channel.count({ where: { status: { not: "REMOVED" } } }),
        this.database.client.video.count({ where: { status: { not: "REMOVED" } } }),
        this.database.client.video.count({ where: { status: "PUBLISHED" } }),
        this.database.client.creatorTvChannel.count(),
        this.database.client.report.count({ where: { status: { in: ["OPEN", "REVIEWING"] } } }),
        this.database.client.moderationCase.count({ where: { status: { in: ["OPEN", "REVIEWING"] } } }),
      ]);

    return {
      accounts,
      activeAccounts,
      channels,
      videos,
      publishedVideos,
      tvChannels,
      openReports,
      openCases,
      analytics: {
        watchTimeMs: null,
        revenue: null,
        available: false,
        reason: "Watch-time and revenue totals become available from the analytics and revenue pipelines.",
      },
    };
  }

  async users(input: UserFilters) {
    const { page, take, skip } = this.page(input);
    const query = input.query?.trim();
    const where = {
      ...(input.status ? { status: input.status } : {}),
      ...(query
        ? {
            OR: [
              { email: { contains: query, mode: "insensitive" as const } },
              { displayName: { contains: query, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.database.client.account.count({ where }),
      this.database.client.account.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          displayName: true,
          status: true,
          emailVerifiedAt: true,
          createdAt: true,
          updatedAt: true,
          channelMemberships: {
            where: { role: "OWNER" },
            take: 3,
            select: { channel: { select: { id: true, handle: true, name: true, status: true } } },
          },
        },
      }),
    ]);
    return { items, pagination: this.pagination(total, page, take) };
  }

  async updateAccount(actorAccountId: string, accountId: string, patch: AdminAccountPatch) {
    if (actorAccountId === accountId && patch.status === "SUSPENDED") {
      throw adminBadRequest("SELF_SUSPEND_BLOCKED", "Use another administrator to suspend this account.");
    }
    const displayName = patch.displayName?.trim();
    if (patch.displayName !== undefined && !displayName) {
      throw adminBadRequest("INVALID_DISPLAY_NAME", "Display name cannot be empty.");
    }
    return this.database.client.$transaction(async (tx) => {
      const account = await tx.account.update({
        where: { id: accountId },
        data: {
          ...(displayName !== undefined ? { displayName } : {}),
          ...(patch.status !== undefined
            ? {
                status: patch.status,
                authVersion: { increment: 1 },
              }
            : {}),
        },
        select: { id: true, email: true, displayName: true, status: true, authVersion: true, updatedAt: true },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: patch.status ? "account.status_updated" : "account.updated",
        entityType: "Account",
        entityId: accountId,
        reason: patch.reason,
        metadata: { status: account.status, displayName: account.displayName },
      });
      return account;
    });
  }

  async channels(input: ChannelFilters) {
    const { page, take, skip } = this.page(input);
    const query = input.query?.trim();
    const where = {
      ...(input.status ? { status: input.status } : { status: { not: "REMOVED" as const } }),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" as const } },
              { handle: { contains: query, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.database.client.channel.count({ where }),
      this.database.client.channel.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          handle: true,
          name: true,
          description: true,
          status: true,
          createdAt: true,
          members: {
            where: { role: "OWNER" },
            take: 1,
            select: { account: { select: { id: true, email: true, displayName: true, status: true } } },
          },
          creatorContracts: {
            orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
            take: 1,
            select: { id: true, status: true, revenueShareBps: true, effectiveFrom: true },
          },
          primaryTvChannel: { select: { id: true, name: true, status: true } },
          _count: { select: { videos: true, subscriptions: true, playlists: true } },
        },
      }),
    ]);
    return { items, pagination: this.pagination(total, page, take) };
  }

  async updateChannel(actorAccountId: string, channelId: string, patch: AdminChannelPatch) {
    const name = patch.name?.trim();
    if (patch.name !== undefined && !name) {
      throw adminBadRequest("INVALID_CHANNEL_NAME", "Channel name cannot be empty.");
    }
    if (patch.revenueShareBps !== undefined && patch.revenueShareBps !== null && (patch.revenueShareBps < 0 || patch.revenueShareBps > 10_000)) {
      throw adminBadRequest("INVALID_REVENUE_SHARE", "Revenue share must be between 0 and 10000 basis points.");
    }
    return this.database.client.$transaction(async (tx) => {
      const channel = await tx.channel.update({
        where: { id: channelId },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
        },
        select: { id: true, handle: true, name: true, description: true, status: true, updatedAt: true },
      });

      if (patch.contractStatus !== undefined || patch.revenueShareBps !== undefined) {
        const contract = await tx.creatorContract.findFirst({
          where: { channelId },
          orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
        });
        if (!contract) {
          await tx.creatorContract.create({
            data: {
              channelId,
              status: patch.contractStatus ?? "PENDING",
              ...(patch.revenueShareBps !== undefined ? { revenueShareBps: patch.revenueShareBps } : {}),
              effectiveFrom: patch.contractStatus === "ACTIVE" ? new Date() : null,
            },
          });
        } else {
          await tx.creatorContract.update({
            where: { id: contract.id },
            data: {
              ...(patch.contractStatus !== undefined ? { status: patch.contractStatus } : {}),
              ...(patch.revenueShareBps !== undefined ? { revenueShareBps: patch.revenueShareBps } : {}),
              ...(patch.contractStatus === "ACTIVE" && !contract.effectiveFrom ? { effectiveFrom: new Date() } : {}),
            },
          });
        }
      }

      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "channel.admin_updated",
        entityType: "Channel",
        entityId: channelId,
        reason: patch.reason,
        metadata: {
          status: channel.status,
          ...(patch.contractStatus !== undefined ? { contractStatus: patch.contractStatus } : {}),
          ...(patch.revenueShareBps !== undefined ? { revenueShareBps: patch.revenueShareBps } : {}),
        },
      });
      return channel;
    });
  }

  async videos(input: VideoFilters) {
    const { page, take, skip } = this.page(input);
    const query = input.query?.trim();
    const where = {
      ...(input.channelId ? { channelId: input.channelId } : {}),
      ...(input.status ? { status: input.status } : { status: { not: "REMOVED" as const } }),
      ...(input.visibility ? { visibility: input.visibility } : {}),
      ...(query
        ? {
            OR: [
              { title: { contains: query, mode: "insensitive" as const } },
              { slug: { contains: query, mode: "insensitive" as const } },
              { channel: { name: { contains: query, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.database.client.video.count({ where }),
      this.database.client.video.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          slug: true,
          title: true,
          description: true,
          status: true,
          visibility: true,
          commentsEnabled: true,
          publishedAt: true,
          updatedAt: true,
          channel: { select: { id: true, handle: true, name: true, status: true } },
          tvPreferences: { select: { tvChannelId: true, included: true, priority: true, sortOrder: true } },
          _count: { select: { comments: true, reports: true } },
        },
      }),
    ]);
    return { items, pagination: this.pagination(total, page, take) };
  }

  async updateVideo(actorAccountId: string, videoId: string, patch: AdminVideoPatch) {
    const title = patch.title?.trim();
    if (patch.title !== undefined && !title) {
      throw adminBadRequest("INVALID_VIDEO_TITLE", "Video title cannot be empty.");
    }
    return this.database.client.$transaction(async (tx) => {
      const existing = await tx.video.findUniqueOrThrow({
        where: { id: videoId },
        select: { id: true, channelId: true, status: true },
      });
      const nextStatus = patch.status;
      const video = await tx.video.update({
        where: { id: videoId },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
          ...(patch.commentsEnabled !== undefined ? { commentsEnabled: patch.commentsEnabled } : {}),
          ...(nextStatus !== undefined
            ? {
                status: nextStatus,
                ...(nextStatus === "PUBLISHED" ? { publishedAt: new Date(), removedAt: null } : {}),
                ...(nextStatus === "DRAFT" ? { publishedAt: null, scheduledPublishAt: null } : {}),
                ...(nextStatus === "REMOVED" ? { removedAt: new Date(), publishedAt: null } : {}),
              }
            : {}),
        },
        select: { id: true, title: true, status: true, visibility: true, commentsEnabled: true, updatedAt: true },
      });
      if (patch.tvIncluded !== undefined) {
        const tv = await tx.creatorTvChannel.findFirst({
          where: { channelId: existing.channelId },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        if (tv) {
          await tx.creatorTvVideoPreference.upsert({
            where: { tvChannelId_videoId: { tvChannelId: tv.id, videoId } },
            create: { tvChannelId: tv.id, videoId, included: patch.tvIncluded, priority: 0 },
            update: { included: patch.tvIncluded },
          });
        }
      }
      if (nextStatus === "REMOVED") {
        await tx.creatorTvVideoPreference.updateMany({ where: { videoId }, data: { included: false } });
      }
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "video.admin_updated",
        entityType: "Video",
        entityId: videoId,
        reason: patch.reason,
        metadata: {
          status: video.status,
          visibility: video.visibility,
          commentsEnabled: video.commentsEnabled,
          ...(patch.tvIncluded !== undefined ? { tvIncluded: patch.tvIncluded } : {}),
        },
      });
      return video;
    });
  }

  async bulkVideos(
    actorAccountId: string,
    input: { ids: string[]; action: "UNPUBLISH" | "DISABLE_COMMENTS" | "ENABLE_COMMENTS"; reason: string },
  ) {
    const ids = [...new Set(input.ids)];
    if (!ids.length || ids.length > 100) {
      throw adminBadRequest("INVALID_BULK_SELECTION", "Select between 1 and 100 videos.");
    }
    return this.database.client.$transaction(async (tx) => {
      const existing = await tx.video.findMany({ where: { id: { in: ids } }, select: { id: true } });
      if (existing.length !== ids.length) {
        throw adminBadRequest("VIDEO_NOT_FOUND", "One or more selected videos no longer exist.");
      }
      const data =
        input.action === "UNPUBLISH"
          ? { status: "DRAFT" as const, publishedAt: null, scheduledPublishAt: null }
          : { commentsEnabled: input.action === "ENABLE_COMMENTS" };
      const result = await tx.video.updateMany({ where: { id: { in: ids }, status: { not: "REMOVED" } }, data });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "video.bulk_updated",
        entityType: "Video",
        reason: input.reason,
        metadata: { action: input.action, ids, affected: result.count },
      });
      return { affected: result.count, action: input.action };
    });
  }

  async tvChannels(input: TvFilters) {
    const { page, take, skip } = this.page(input);
    const query = input.query?.trim();
    const where = {
      ...(input.status ? { status: input.status } : {}),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" as const } },
              { slug: { contains: query, mode: "insensitive" as const } },
              { channel: { name: { contains: query, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    };
    const now = new Date();
    const [total, items] = await Promise.all([
      this.database.client.creatorTvChannel.count({ where }),
      this.database.client.creatorTvChannel.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          disabledAt: true,
          updatedAt: true,
          channel: { select: { id: true, handle: true, name: true, status: true } },
          scheduleItems: {
            where: { endsAt: { gt: now }, status: { in: ["SCHEDULED", "ACTIVE"] } },
            orderBy: { startsAt: "asc" },
            take: 2,
            select: { id: true, startsAt: true, endsAt: true, status: true, video: { select: { id: true, title: true } } },
          },
        },
      }),
    ]);
    return { items, pagination: this.pagination(total, page, take) };
  }

  async updateTv(
    actorAccountId: string,
    tvChannelId: string,
    input: { status: "ACTIVE" | "OFF_AIR" | "DISABLED"; reason?: string | undefined },
  ) {
    return this.database.client.$transaction(async (tx) => {
      const tv = await tx.creatorTvChannel.update({
        where: { id: tvChannelId },
        data: {
          status: input.status,
          disabledAt: input.status === "DISABLED" ? new Date() : null,
        },
        select: { id: true, name: true, status: true, disabledAt: true, updatedAt: true },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "creator_tv.status_updated",
        entityType: "CreatorTvChannel",
        entityId: tvChannelId,
        reason: input.reason,
        metadata: { status: tv.status },
      });
      return tv;
    });
  }

  async moderation(input: PageInput & { status?: "OPEN" | "REVIEWING" | "RESOLVED" | "DISMISSED" | undefined }) {
    const { page, take, skip } = this.page(input);
    const where = { ...(input.status ? { status: input.status } : { status: { in: ["OPEN" as const, "REVIEWING" as const] } }) };
    const [total, reports] = await Promise.all([
      this.database.client.report.count({ where }),
      this.database.client.report.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          reason: true,
          details: true,
          status: true,
          createdAt: true,
          reporterProfile: { select: { id: true, name: true, slug: true } },
          channel: { select: { id: true, handle: true, name: true } },
          video: { select: { id: true, title: true } },
          comment: { select: { id: true, body: true } },
          moderationCase: { select: { id: true, status: true, summary: true } },
        },
      }),
    ]);
    return { reports, pagination: this.pagination(total, page, take) };
  }

  private page(input: PageInput) {
    const page = Math.max(input.page ?? 1, 1);
    const take = Math.min(Math.max(input.take ?? 25, 1), 100);
    return { page, take, skip: (page - 1) * take };
  }

  private pagination(total: number, page: number, take: number) {
    return { total, page, take, pages: Math.max(1, Math.ceil(total / take)) };
  }
}
