import { Prisma } from "@ayin/db";

import { ConflictException, NotFoundException, Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { AdminAuditLogService } from "./admin-audit-log.service.js";
import {
  lockAdminAccountWrite,
  nextAccountVersion,
  type AccountWriteActor,
} from "./admin-account-write-authority.js";
import { adminBadRequest } from "./admin.errors.js";

const accountReadSelection = {
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
} as const;

const videoReadSelection = {
  id: true,
  slug: true,
  title: true,
  description: true,
  status: true,
  visibility: true,
  videoForm: true,
  commentsEnabled: true,
  publishedAt: true,
  updatedAt: true,
  channel: {
    select: {
      id: true,
      handle: true,
      name: true,
      status: true,
      creatorTvChannels: {
        take: 1,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, name: true, status: true },
      },
    },
  },
  tvPreferences: {
    select: { tvChannelId: true, included: true, priority: true, sortOrder: true, updatedAt: true },
  },
  _count: { select: { comments: true, reports: true } },
} satisfies Prisma.VideoSelect;

type SafeVideoRow = Prisma.VideoGetPayload<{ select: typeof videoReadSelection }>;
function videoProjection(row: SafeVideoRow) {
  const { creatorTvChannels, ...channel } = row.channel;
  const tv = creatorTvChannels[0];
  const preference = tv
    ? row.tvPreferences.find((entry) => entry.tvChannelId === tv.id)
    : undefined;
  return {
    ...row,
    channel,
    tvControl: tv
      ? {
          id: tv.id,
          name: tv.name,
          status: tv.status,
          included: preference?.included ?? true,
          origin: preference ? "EXPLICIT" : "DEFAULT",
          updatedAt: preference?.updatedAt ?? null,
        }
      : null,
  };
}

const MAX_ADMIN_PAGE = 1_000;

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
  expectedUpdatedAt?: string | undefined;
  displayName?: string | undefined;
  status?: "ACTIVE" | "SUSPENDED" | undefined;
  reason?: string | undefined;
}

export interface AdminChannelPatch {
  expectedUpdatedAt?: string | undefined;
  name?: string | undefined;
  description?: string | null | undefined;
  status?: "ACTIVE" | "HIDDEN" | "SUSPENDED" | undefined;
  contractStatus?: "PENDING" | "ACTIVE" | "SUSPENDED" | "ENDED" | undefined;
  revenueShareBps?: number | null | undefined;
  isPlatformOwned?: boolean | undefined;
  reason?: string | undefined;
}

export interface AdminVideoPatch {
  expectedTvPreference?: { tvChannelId: string; updatedAt: string | null } | undefined;
  expectedUpdatedAt?: string | undefined;
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
    const [
      accounts,
      activeAccounts,
      channels,
      videos,
      publishedVideos,
      tvChannels,
      openReports,
      openCases,
    ] = await Promise.all([
      this.database.client.account.count(),
      this.database.client.account.count({ where: { status: "ACTIVE" } }),
      this.database.client.channel.count({ where: { status: { not: "REMOVED" } } }),
      this.database.client.video.count({ where: { status: { not: "REMOVED" } } }),
      this.database.client.video.count({ where: { status: "PUBLISHED" } }),
      this.database.client.creatorTvChannel.count(),
      this.database.client.report.count({ where: { status: { in: ["OPEN", "REVIEWING"] } } }),
      this.database.client.moderationCase.count({
        where: { status: { in: ["OPEN", "REVIEWING"] } },
      }),
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
        reason:
          "Watch-time and revenue totals become available from the analytics and revenue pipelines.",
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
    const [total, items] = await this.database.client.$transaction(
      async (tx) =>
        Promise.all([
          tx.account.count({ where }),
          tx.account.findMany({
            where,
            skip,
            take,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: accountReadSelection,
          }),
        ]),
      { isolationLevel: "RepeatableRead" },
    );
    return { items, pagination: this.pagination(total, page, take) };
  }

  async userRecord(accountId: string) {
    const record = await this.database.client.account.findUnique({
      where: { id: accountId },
      select: accountReadSelection,
    });
    if (!record) throw new NotFoundException("Account record unavailable.");
    return record;
  }

  async updateAccount(actor: AccountWriteActor, accountId: string, patch: AdminAccountPatch) {
    const actorAccountId = actor.accountId;
    if (actorAccountId === accountId && patch.status === "SUSPENDED") {
      throw adminBadRequest(
        "SELF_SUSPEND_BLOCKED",
        "Use another administrator to suspend this account.",
      );
    }
    const displayName = patch.displayName?.trim();
    if (patch.displayName !== undefined && !displayName) {
      throw adminBadRequest("INVALID_DISPLAY_NAME", "Display name cannot be empty.");
    }
    return this.database.client.$transaction(async (tx) => {
      const current = await lockAdminAccountWrite(tx, actor, accountId, patch.expectedUpdatedAt);
      if (patch.status !== undefined && current.status === "CLOSED")
        throw new ConflictException("A closed account cannot be reactivated or suspended.");
      const account = await tx.account.update({
        where: { id: accountId },
        data: {
          updatedAt: nextAccountVersion(current.updatedAt),
          ...(displayName !== undefined ? { displayName } : {}),
          ...(patch.status !== undefined
            ? {
                status: patch.status,
                authVersion: { increment: 1 },
              }
            : {}),
        },
        select: {
          id: true,
          email: true,
          displayName: true,
          status: true,
          authVersion: true,
          updatedAt: true,
        },
      });
      if (patch.status !== undefined) {
        await tx.accountSession.updateMany({
          where: { accountId, revokedAt: null },
          data: { revokedAt: new Date(), revokeReason: "ACCOUNT_STATUS_CHANGED" },
        });
      }
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
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          handle: true,
          name: true,
          description: true,
          status: true,
          isPlatformOwned: true,
          createdAt: true,
          updatedAt: true,
          members: {
            where: { role: "OWNER" },
            take: 1,
            select: {
              account: { select: { id: true, email: true, displayName: true, status: true } },
            },
          },
          creatorContracts: {
            orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }, { id: "desc" }],
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

  async channelRecord(channelId: string) {
    const record = await this.database.client.channel.findUnique({
      where: { id: channelId },
      select: {
        id: true,
        handle: true,
        name: true,
        description: true,
        status: true,
        isPlatformOwned: true,
        updatedAt: true,
        creatorContracts: {
          orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { id: true, status: true, revenueShareBps: true, effectiveFrom: true },
        },
      },
    });
    if (!record) throw new NotFoundException("Channel not found.");
    return record;
  }

  async updateChannel(actorAccountId: string, channelId: string, patch: AdminChannelPatch) {
    const name = patch.name?.trim();
    if (patch.name !== undefined && !name) {
      throw adminBadRequest("INVALID_CHANNEL_NAME", "Channel name cannot be empty.");
    }
    if (
      patch.revenueShareBps !== undefined &&
      patch.revenueShareBps !== null &&
      (patch.revenueShareBps < 0 || patch.revenueShareBps > 10_000)
    ) {
      throw adminBadRequest(
        "INVALID_REVENUE_SHARE",
        "Revenue share must be between 0 and 10000 basis points.",
      );
    }
    return this.database.client.$transaction(async (tx) => {
      const observed = await tx.$queryRaw<Array<{ updatedAt: Date }>>`
        SELECT "updatedAt" FROM "Channel" WHERE "id" = ${channelId}::uuid FOR UPDATE
      `;
      if (!observed[0]) throw new NotFoundException("Channel not found.");
      if (
        patch.expectedUpdatedAt &&
        observed[0].updatedAt.getTime() !== new Date(patch.expectedUpdatedAt).getTime()
      ) {
        throw new ConflictException(
          "Channel changed. Review its current state before another update.",
        );
      }
      const channel = await tx.channel.update({
        where: { id: channelId },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.isPlatformOwned !== undefined
            ? { isPlatformOwned: patch.isPlatformOwned }
            : {}),
        },
        select: {
          id: true,
          handle: true,
          name: true,
          description: true,
          status: true,
          isPlatformOwned: true,
          updatedAt: true,
        },
      });

      if (patch.contractStatus !== undefined || patch.revenueShareBps !== undefined) {
        const contract = await tx.creatorContract.findFirst({
          where: { channelId },
          orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        });
        if (!contract) {
          await tx.creatorContract.create({
            data: {
              channelId,
              status: patch.contractStatus ?? "PENDING",
              ...(patch.revenueShareBps !== undefined
                ? { revenueShareBps: patch.revenueShareBps }
                : {}),
              effectiveFrom: patch.contractStatus === "ACTIVE" ? new Date() : null,
            },
          });
        } else {
          await tx.creatorContract.update({
            where: { id: contract.id },
            data: {
              ...(patch.contractStatus !== undefined ? { status: patch.contractStatus } : {}),
              ...(patch.revenueShareBps !== undefined
                ? { revenueShareBps: patch.revenueShareBps }
                : {}),
              ...(patch.contractStatus === "ACTIVE" && !contract.effectiveFrom
                ? { effectiveFrom: new Date() }
                : {}),
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
          isPlatformOwned: channel.isPlatformOwned,
          ...(patch.contractStatus !== undefined ? { contractStatus: patch.contractStatus } : {}),
          ...(patch.revenueShareBps !== undefined
            ? { revenueShareBps: patch.revenueShareBps }
            : {}),
        },
      });
      const creatorContracts = await tx.creatorContract.findMany({
        where: { channelId },
        orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { id: true, status: true, revenueShareBps: true, effectiveFrom: true },
      });
      return { ...channel, creatorContracts };
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
    const [total, items] = await this.database.client.$transaction(
      [
        this.database.client.video.count({ where }),
        this.database.client.video.findMany({
          where,
          skip,
          take,
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          select: videoReadSelection,
        }),
      ],
      { isolationLevel: "RepeatableRead" },
    );
    return { items: items.map(videoProjection), pagination: this.pagination(total, page, take) };
  }

  async video(videoId: string) {
    const video = await this.database.client.$transaction(
      (tx) => tx.video.findUnique({ where: { id: videoId }, select: videoReadSelection }),
      { isolationLevel: "RepeatableRead" },
    );
    if (!video) throw new NotFoundException("Video record unavailable.");
    return videoProjection(video);
  }

  async updateVideo(actor: AccountWriteActor, videoId: string, patch: AdminVideoPatch) {
    const title = patch.title?.trim();
    if (patch.title !== undefined && !title) {
      throw adminBadRequest("INVALID_VIDEO_TITLE", "Video title cannot be empty.");
    }
    return this.database.client.$transaction(async (tx) => {
      await this.videoWriteAuthority(tx, actor);
      const [existing] = await this.lockVideos(tx, [videoId]);
      await this.videoWriteAuthority(tx, actor);
      if (!existing) throw new NotFoundException("Video record unavailable.");
      this.assertVideoVersion(existing, patch.expectedUpdatedAt);
      const nextStatus = patch.status;
      const video = await tx.video.update({
        where: { id: videoId },
        data: {
          updatedAt: nextAccountVersion(existing.updatedAt),
          ...(title !== undefined ? { title } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
          ...(patch.commentsEnabled !== undefined
            ? { commentsEnabled: patch.commentsEnabled }
            : {}),
          ...(nextStatus !== undefined
            ? {
                status: nextStatus,
                ...(nextStatus === "PUBLISHED" ? { publishedAt: new Date(), removedAt: null } : {}),
                ...(nextStatus === "DRAFT" ? { publishedAt: null, scheduledPublishAt: null } : {}),
                ...(nextStatus === "REMOVED" ? { removedAt: new Date(), publishedAt: null } : {}),
              }
            : {}),
        },
        select: {
          id: true,
          title: true,
          status: true,
          visibility: true,
          commentsEnabled: true,
          updatedAt: true,
        },
      });
      let tvControl:
        { id: string; included: boolean; origin: "EXPLICIT"; updatedAt: Date } | undefined;
      if (patch.tvIncluded !== undefined) {
        const selected = await tx.creatorTvChannel.findFirst({
          where: { channelId: existing.channelId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true },
        });
        if (
          patch.expectedTvPreference &&
          selected?.id !== patch.expectedTvPreference.tvChannelId.toLowerCase()
        )
          throw new ConflictException(
            "TV target changed. Read the original video before reviewing this operation.",
          );
        if (selected) {
          const [tv] = await tx.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`SELECT "id" FROM "CreatorTvChannel" WHERE "id" = ${selected.id}::uuid FOR SHARE /* ayin-admin-video-tv-lock */`,
          );
          if (!tv)
            throw new ConflictException(
              "TV target changed. Read the original video before reviewing this operation.",
            );
          const [current] = await tx.$queryRaw<Array<{ updatedAt: Date }>>(
            Prisma.sql`SELECT "updatedAt" FROM "CreatorTvVideoPreference" WHERE "tvChannelId" = ${tv.id}::uuid AND "videoId" = ${videoId}::uuid FOR UPDATE /* ayin-admin-video-tv-preference-lock */`,
          );
          await this.videoWriteAuthority(tx, actor);
          if (
            patch.expectedTvPreference &&
            (current?.updatedAt.getTime() ?? null) !==
              (patch.expectedTvPreference.updatedAt === null
                ? null
                : new Date(patch.expectedTvPreference.updatedAt).getTime())
          )
            throw new ConflictException(
              "TV inclusion changed. Read the original video before reviewing this operation.",
            );
          const preference = await tx.creatorTvVideoPreference.upsert({
            where: { tvChannelId_videoId: { tvChannelId: tv.id, videoId } },
            create: { tvChannelId: tv.id, videoId, included: patch.tvIncluded, priority: 0 },
            update: {
              included: patch.tvIncluded,
              updatedAt: current ? nextAccountVersion(current.updatedAt) : new Date(),
            },
            select: { included: true, updatedAt: true },
          });
          tvControl = {
            id: tv.id,
            included: preference.included,
            origin: "EXPLICIT",
            updatedAt: preference.updatedAt,
          };
        }
      }
      if (nextStatus === "REMOVED") {
        const preferences = await tx.$queryRaw<Array<{ updatedAt: Date }>>(
          Prisma.sql`SELECT "updatedAt" FROM "CreatorTvVideoPreference" WHERE "videoId" = ${videoId}::uuid ORDER BY "id" FOR UPDATE /* ayin-admin-video-tv-preference-lock */`,
        );
        await this.videoWriteAuthority(tx, actor);
        const updatedAt = new Date(
          Math.max(Date.now(), ...preferences.map((entry) => entry.updatedAt.getTime() + 1)),
        );
        await tx.creatorTvVideoPreference.updateMany({
          where: { videoId },
          data: { included: false, updatedAt },
        });
        if (tvControl) tvControl = { ...tvControl, included: false, updatedAt };
      }
      await this.audit.recordInTransaction(tx, {
        actorAccountId: actor.accountId,
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
      return { ...video, ...(tvControl ? { tvControl } : {}) };
    });
  }

  async bulkVideos(
    actor: AccountWriteActor,
    input: {
      ids: string[];
      action: "UNPUBLISH" | "DISABLE_COMMENTS" | "ENABLE_COMMENTS";
      reason: string;
      expectedVideos?: Array<{ id: string; updatedAt: string }> | undefined;
    },
  ) {
    const ids = [...new Set(input.ids.map((id) => id.toLowerCase()))].sort();
    if (!ids.length || ids.length > 100) {
      throw adminBadRequest("INVALID_BULK_SELECTION", "Select between 1 and 100 videos.");
    }
    return this.database.client.$transaction(async (tx) => {
      await this.videoWriteAuthority(tx, actor);
      const existing = await this.lockVideos(tx, ids);
      await this.videoWriteAuthority(tx, actor);
      if (existing.length !== ids.length)
        throw new NotFoundException("One or more selected videos no longer exist.");
      const versions = input.expectedVideos
        ? new Map(input.expectedVideos.map((row) => [row.id.toLowerCase(), row.updatedAt]))
        : null;
      if (
        versions &&
        (versions.size !== input.expectedVideos?.length ||
          versions.size !== ids.length ||
          ids.some((id) => !versions.has(id)))
      )
        throw adminBadRequest(
          "INVALID_BULK_VERSIONS",
          "Provide exactly one version for every selected video.",
        );
      for (const row of existing) this.assertVideoVersion(row, versions?.get(row.id));
      const updatedAt = new Date(
        Math.max(Date.now(), ...existing.map((row) => row.updatedAt.getTime() + 1)),
      );
      const data =
        input.action === "UNPUBLISH"
          ? { status: "DRAFT" as const, publishedAt: null, scheduledPublishAt: null }
          : { commentsEnabled: input.action === "ENABLE_COMMENTS" };
      const result = await tx.video.updateMany({
        where: { id: { in: ids }, status: { not: "REMOVED" } },
        data: { ...data, updatedAt },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId: actor.accountId,
        action: "video.bulk_updated",
        entityType: "Video",
        reason: input.reason,
        metadata: { action: input.action, ids, affected: result.count },
      });
      return { affected: result.count, action: input.action };
    });
  }

  private videoWriteAuthority(tx: Prisma.TransactionClient, actor: AccountWriteActor) {
    return lockAdminAccountWrite(tx, actor, actor.accountId, undefined, [
      "OPERATIONS",
      "CONTENT_MODERATOR",
    ]);
  }

  private lockVideos(tx: Prisma.TransactionClient, ids: string[]) {
    return tx.$queryRaw<Array<{ id: string; channelId: string; status: string; updatedAt: Date }>>(
      Prisma.sql`SELECT "id", "channelId", "status", "updatedAt" FROM "Video"
        WHERE "id" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
        ORDER BY "id" FOR UPDATE /* ayin-admin-video-write-lock */`,
    );
  }

  private assertVideoVersion(
    video: { status: string; updatedAt: Date },
    expectedUpdatedAt?: string,
  ) {
    if (video.status === "REMOVED")
      throw new ConflictException(
        "Removed video cannot be edited. Read the original video before reviewing this operation.",
      );
    if (
      expectedUpdatedAt !== undefined &&
      video.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()
    )
      throw new ConflictException(
        "Video changed. Read the original video before reviewing this operation.",
      );
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
    const [total, items] = await this.database.client.$transaction(
      [
        this.database.client.creatorTvChannel.count({ where }),
        this.database.client.creatorTvChannel.findMany({
          where,
          skip,
          take,
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          select: this.tvReadSelection(now),
        }),
      ],
      { isolationLevel: "RepeatableRead" },
    );
    return { items, pagination: this.pagination(total, page, take) };
  }

  private tvReadSelection(now: Date) {
    return {
      id: true,
      slug: true,
      name: true,
      status: true,
      disabledAt: true,
      updatedAt: true,
      channel: { select: { id: true, handle: true, name: true, status: true } },
      scheduleItems: {
        where: { endsAt: { gt: now }, status: { in: ["SCHEDULED" as const, "ACTIVE" as const] } },
        orderBy: [{ startsAt: "asc" as const }, { id: "asc" as const }],
        take: 2,
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          status: true,
          video: { select: { id: true, title: true } },
        },
      },
    };
  }

  async tvRecord(tvChannelId: string) {
    const record = await this.database.client.creatorTvChannel.findUnique({
      where: { id: tvChannelId },
      select: this.tvReadSelection(new Date()),
    });
    if (!record) throw new NotFoundException("Creator TV record unavailable.");
    return record;
  }

  async updateTv(
    actor: AccountWriteActor,
    tvChannelId: string,
    input: {
      status: "ACTIVE" | "OFF_AIR" | "DISABLED";
      reason?: string | undefined;
      expectedUpdatedAt?: string | undefined;
    },
  ) {
    const actorAccountId = actor.accountId;
    return this.database.client.$transaction(async (tx) => {
      await lockAdminAccountWrite(tx, actor, actorAccountId);
      const [current] = await tx.$queryRaw<{ id: string; updatedAt: Date }[]>(
        Prisma.sql`SELECT "id", "updatedAt" FROM "CreatorTvChannel" WHERE "id" = ${tvChannelId}::uuid FOR UPDATE /* ayin-admin-tv-write-lock */`,
      );
      if (!current) throw new NotFoundException("Creator TV record unavailable.");
      // Authority rows remain locked; renew expiry/step-up checks after the final target wait.
      await lockAdminAccountWrite(tx, actor, actorAccountId);
      if (
        input.expectedUpdatedAt !== undefined &&
        current.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()
      )
        throw new ConflictException(
          "Creator TV changed. Read the original TV before reviewing this operation.",
        );
      const tv = await tx.creatorTvChannel.update({
        where: { id: tvChannelId },
        data: {
          status: input.status,
          updatedAt: nextAccountVersion(current.updatedAt),
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

  async moderation(
    input: PageInput & { status?: "OPEN" | "REVIEWING" | "RESOLVED" | "DISMISSED" | undefined },
  ) {
    const { page, take, skip } = this.page(input);
    const where = {
      ...(input.status
        ? { status: input.status }
        : { status: { in: ["OPEN" as const, "REVIEWING" as const] } }),
    };
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
    const page = Math.min(Math.max(input.page ?? 1, 1), MAX_ADMIN_PAGE);
    const take = Math.min(Math.max(input.take ?? 25, 1), 100);
    return { page, take, skip: (page - 1) * take };
  }

  private pagination(total: number, page: number, take: number) {
    return { total, page, take, pages: Math.max(1, Math.ceil(total / take)) };
  }
}
