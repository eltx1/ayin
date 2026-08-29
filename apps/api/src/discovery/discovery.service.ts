import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";

const playableAssetStates = ["UPLOADED", "VALIDATED"] as const;
const firstPageSize = 8;
const maxPageSize = 24;

const publicVideoWhere = {
  status: "PUBLISHED",
  visibility: "PUBLIC",
  removedAt: null,
  channel: { status: "ACTIVE", removedAt: null },
  mediaAssets: {
    some: {
      kind: "SOURCE_VIDEO",
      status: { in: [...playableAssetStates] },
      removedAt: null,
      mimeType: "video/mp4",
    },
  },
} satisfies Prisma.VideoWhereInput;

const videoCardSelect = {
  id: true,
  slug: true,
  title: true,
  durationMs: true,
  publishedAt: true,
  channelId: true,
  channel: { select: { handle: true, name: true } },
  mediaAssets: {
    where: {
      kind: "THUMBNAIL",
      status: { in: [...playableAssetStates] },
      removedAt: null,
    },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { r2ObjectKey: true },
  },
} satisfies Prisma.VideoSelect;

type VideoCardRecord = Prisma.VideoGetPayload<{ select: typeof videoCardSelect }>;

export type DiscoveryItemType = "VIDEO" | "CREATOR_TV" | "CHANNEL" | "PLAYLIST";
export type DiscoveryAvailability = "AVAILABLE" | "EMPTY" | "UNAVAILABLE";

export interface DiscoveryItem {
  id: string;
  type: DiscoveryItemType;
  title: string;
  href: string;
  kicker: string;
  meta: string | null;
  artworkObjectKey: string | null;
  progress?: { positionMs: number; completedAt: string | null };
}

export interface DiscoveryPage {
  items: DiscoveryItem[];
  nextCursor: string | null;
  availability: DiscoveryAvailability;
  emptyMessage: string;
}

export interface DiscoveryContext {
  accountId?: string;
  profileId?: string;
  regionCode?: string;
  regionPersonalizationAllowed?: boolean;
}

export class DiscoveryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "DiscoveryError";
  }
}

@Injectable()
export class HomeRowConfigService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listEnabled(authenticated: boolean) {
    return this.database.client.homeRowConfig.findMany({
      where: {
        enabled: true,
        audience: { in: authenticated ? ["ALL", "AUTHENTICATED"] : ["ALL", "ANONYMOUS"] },
      },
      orderBy: [{ position: "asc" }, { key: "asc" }],
    });
  }

  async getEnabled(key: string, authenticated: boolean) {
    return this.database.client.homeRowConfig.findFirst({
      where: {
        key,
        enabled: true,
        audience: { in: authenticated ? ["ALL", "AUTHENTICATED"] : ["ALL", "ANONYMOUS"] },
      },
    });
  }

  async listAll() {
    return this.database.client.homeRowConfig.findMany({
      orderBy: [{ position: "asc" }, { key: "asc" }],
      include: { manualItems: { orderBy: { position: "asc" } } },
    });
  }
}

@Injectable()
export class DiscoveryService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(HomeRowConfigService) private readonly rows: HomeRowConfigService,
  ) {}

  async getHome(context: DiscoveryContext = {}) {
    const normalized = await this.normalizeContext(context);
    const rows = await this.rows.listEnabled(Boolean(normalized.profileId));
    const visibleRows = rows.filter(
      (row) =>
        !row.regionPersonalizationRequired ||
        (normalized.regionPersonalizationAllowed === true && Boolean(normalized.regionCode)),
    );

    return {
      rows: await Promise.all(
        visibleRows.map(async (row) => ({
          key: row.key,
          title: row.title,
          source: row.source,
          maxItems: row.maxItems,
          ...(await this.loadRowPage(row, normalized, 0, Math.min(firstPageSize, row.maxItems))),
        })),
      ),
    };
  }

  async getRow(
    key: string,
    context: DiscoveryContext = {},
    cursor?: string,
    requestedLimit?: number,
  ) {
    const normalized = await this.normalizeContext(context);
    const row = await this.rows.getEnabled(key, Boolean(normalized.profileId));
    if (!row) {
      throw new DiscoveryError("ROW_NOT_FOUND", "This AYIN discovery row is not available.", 404);
    }
    if (
      row.regionPersonalizationRequired &&
      (!normalized.regionPersonalizationAllowed || !normalized.regionCode)
    ) {
      return {
        key: row.key,
        title: row.title,
        source: row.source,
        maxItems: row.maxItems,
        ...emptyPage(
          "Regional discovery is shown only when an approved location signal exists and personalization is allowed.",
          "UNAVAILABLE",
        ),
      };
    }

    const offset = decodeCursor(cursor);
    const limit = Math.min(
      Math.max(requestedLimit ?? firstPageSize, 1),
      maxPageSize,
      Math.max(row.maxItems - offset, 0),
    );
    if (limit === 0) {
      return {
        key: row.key,
        title: row.title,
        source: row.source,
        maxItems: row.maxItems,
        ...emptyPage("You reached the end of this row."),
      };
    }
    return {
      key: row.key,
      title: row.title,
      source: row.source,
      maxItems: row.maxItems,
      ...(await this.loadRowPage(row, normalized, offset, limit)),
    };
  }

  async getMyAyin(accountId: string, requestedProfileId?: string) {
    const context = await this.normalizeContext({ accountId, profileId: requestedProfileId });
    if (!context.profileId) {
      throw new DiscoveryError("PROFILE_NOT_FOUND", "A viewer profile is required.", 403);
    }
    const profileId = context.profileId;
    const [continueWatching, watchLater, history, liked, playlists] = await Promise.all([
      this.loadContinueWatching(profileId, 0, firstPageSize),
      this.loadWatchLater(profileId, 0, firstPageSize),
      this.loadHistory(profileId, 0, firstPageSize),
      this.loadLiked(profileId, 0, firstPageSize),
      this.loadOwnedPlaylists(accountId, 0, firstPageSize),
    ]);

    return {
      profileId,
      sections: [
        { key: "continue-watching", title: "Continue Watching", ...continueWatching },
        {
          key: "my-list",
          title: "My List",
          ...emptyPage(
            "My List is prepared as a consumer-library section; saving actions arrive with the social actions task.",
            "UNAVAILABLE",
          ),
        },
        { key: "watch-later", title: "Watch Later", ...watchLater },
        { key: "history", title: "Watch History", ...history },
        { key: "liked", title: "Liked Content", ...liked },
        { key: "playlists", title: "Playlists", ...playlists },
      ],
    };
  }

  async getMyAyinSection(
    accountId: string,
    section: string,
    requestedProfileId?: string,
    cursor?: string,
    requestedLimit?: number,
  ) {
    const context = await this.normalizeContext({ accountId, profileId: requestedProfileId });
    if (!context.profileId) {
      throw new DiscoveryError("PROFILE_NOT_FOUND", "A viewer profile is required.", 403);
    }
    const offset = decodeCursor(cursor);
    const limit = Math.min(Math.max(requestedLimit ?? firstPageSize, 1), maxPageSize);
    switch (section) {
      case "continue-watching":
        return this.loadContinueWatching(context.profileId, offset, limit);
      case "watch-later":
        return this.loadWatchLater(context.profileId, offset, limit);
      case "history":
        return this.loadHistory(context.profileId, offset, limit);
      case "liked":
        return this.loadLiked(context.profileId, offset, limit);
      case "playlists":
        return this.loadOwnedPlaylists(accountId, offset, limit);
      case "my-list":
        return emptyPage(
          "My List is prepared as a consumer-library section; saving actions arrive with the social actions task.",
          "UNAVAILABLE",
        );
      default:
        throw new DiscoveryError("SECTION_NOT_FOUND", "This My AYIN section is not available.", 404);
    }
  }

  private async normalizeContext(context: DiscoveryContext): Promise<DiscoveryContext> {
    if (!context.accountId) {
      return {
        regionCode: normalizeRegionCode(context.regionCode),
        regionPersonalizationAllowed: context.regionPersonalizationAllowed === true,
      };
    }
    const profile = context.profileId
      ? await this.database.client.viewerProfile.findFirst({
          where: { id: context.profileId, accountId: context.accountId, deletedAt: null },
          select: { id: true },
        })
      : await this.database.client.viewerProfile.findFirst({
          where: { accountId: context.accountId, isDefault: true, deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
    if (!profile) {
      throw new DiscoveryError(
        "PROFILE_NOT_FOUND",
        "This viewer profile is not available for the signed-in account.",
        403,
      );
    }
    return {
      accountId: context.accountId,
      profileId: profile.id,
      regionCode: normalizeRegionCode(context.regionCode),
      regionPersonalizationAllowed: context.regionPersonalizationAllowed === true,
    };
  }

  private async loadRowPage(
    row: { id: string; source: string; maxItems: number },
    context: DiscoveryContext,
    offset: number,
    limit: number,
  ): Promise<DiscoveryPage> {
    switch (row.source) {
      case "CONTINUE_WATCHING":
        return context.profileId
          ? this.loadContinueWatching(context.profileId, offset, limit)
          : emptyPage("Sign in to continue watching across AYIN.", "UNAVAILABLE");
      case "TRENDING_WORLDWIDE":
        return this.loadRankedVideos(daysAgo(7), offset, limit, "Trending Worldwide");
      case "POPULAR_NOW":
        return this.loadRankedVideos(hoursAgo(24), offset, limit, "Popular Now");
      case "NEW_ON_AYIN":
        return this.loadRecentVideos(offset, limit, daysAgo(30), "New on AYIN");
      case "BECAUSE_YOU_WATCHED":
        return context.profileId
          ? this.loadBecauseYouWatched(context.profileId, offset, limit)
          : emptyPage("Sign in and watch something to unlock this row.", "UNAVAILABLE");
      case "POPULAR_REGION":
        return emptyPage(
          context.regionPersonalizationAllowed && context.regionCode
            ? "A privacy-approved region signal is present, but AYIN does not yet store regional watch aggregates, so no regional ranking is invented."
            : "Regional discovery requires an approved location signal and personalization permission.",
          "UNAVAILABLE",
        );
      case "MOVIES":
        return emptyPage(
          "No movie catalog classification exists in the current data model yet, so AYIN will not label ordinary creator videos as movies.",
          "UNAVAILABLE",
        );
      case "SERIES":
        return emptyPage(
          "No series/episode catalog classification exists in the current data model yet, so AYIN will not invent series entries.",
          "UNAVAILABLE",
        );
      case "CREATOR_TV":
        return this.loadCreatorTv(offset, limit);
      case "CREATORS_YOU_FOLLOW":
        return context.profileId
          ? this.loadCreatorsYouFollow(context.profileId, offset, limit)
          : emptyPage("Sign in to see creators you follow.", "UNAVAILABLE");
      case "RECENTLY_ADDED":
        return this.loadRecentVideos(offset, limit, undefined, "Recently Added");
      case "EDITOR_PICKS":
        return this.loadManualItems(row.id, offset, limit);
      default:
        return emptyPage("This discovery source is not available yet.", "UNAVAILABLE");
    }
  }

  private async loadRecentVideos(
    offset: number,
    limit: number,
    publishedAfter: Date | undefined,
    kicker: string,
  ): Promise<DiscoveryPage> {
    const records = await this.database.client.video.findMany({
      where: {
        ...publicVideoWhere,
        ...(publishedAfter ? { publishedAt: { gte: publishedAfter } } : {}),
      },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: limit + 1,
      select: videoCardSelect,
    });
    return paged(records.map((video) => toVideoItem(video, kicker)), offset, limit);
  }

  private async loadRankedVideos(
    since: Date,
    offset: number,
    limit: number,
    kicker: string,
  ): Promise<DiscoveryPage> {
    const ranked = await this.database.client.watchHistory.groupBy({
      by: ["videoId"],
      where: { lastWatchedAt: { gte: since } },
      _sum: { viewCount: true },
      orderBy: [{ _sum: { viewCount: "desc" } }, { videoId: "asc" }],
      skip: offset,
      take: limit + 1,
    });
    const ids = ranked.map((entry) => entry.videoId);
    if (ids.length === 0) {
      return emptyPage("Not enough real viewing activity exists for this ranking yet.");
    }
    const videos = await this.database.client.video.findMany({
      where: { AND: [publicVideoWhere, { id: { in: ids } }] },
      select: videoCardSelect,
    });
    const byId = new Map(videos.map((video) => [video.id, video]));
    const ordered = ranked
      .map((entry) => byId.get(entry.videoId))
      .filter((video): video is VideoCardRecord => Boolean(video))
      .map((video) => toVideoItem(video, kicker));
    return paged(ordered, offset, limit);
  }

  private async loadContinueWatching(
    profileId: string,
    offset: number,
    limit: number,
  ): Promise<DiscoveryPage> {
    const records = await this.database.client.watchProgress.findMany({
      where: {
        profileId,
        completedAt: null,
        positionMs: { gt: 0 },
        video: publicVideoWhere,
      },
      orderBy: [{ lastWatchedAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: limit + 1,
      select: {
        positionMs: true,
        completedAt: true,
        video: { select: videoCardSelect },
      },
    });
    return paged(
      records.map((record) => ({
        ...toVideoItem(record.video, "Continue Watching"),
        progress: {
          positionMs: record.positionMs,
          completedAt: record.completedAt?.toISOString() ?? null,
        },
      })),
      offset,
      limit,
      "Start watching a video and it will appear here.",
    );
  }

  private async loadBecauseYouWatched(
    profileId: string,
    offset: number,
    limit: number,
  ): Promise<DiscoveryPage> {
    const recent = await this.database.client.watchHistory.findFirst({
      where: { profileId, video: publicVideoWhere },
      orderBy: [{ lastWatchedAt: "desc" }, { id: "desc" }],
      select: { videoId: true, video: { select: { channelId: true, title: true } } },
    });
    if (!recent) {
      return emptyPage("Watch something first and AYIN will build this row from real activity.");
    }
    const records = await this.database.client.video.findMany({
      where: {
        AND: [publicVideoWhere, { channelId: recent.video.channelId, id: { not: recent.videoId } }],
      },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: limit + 1,
      select: videoCardSelect,
    });
    return paged(
      records.map((video) => toVideoItem(video, `Because you watched ${recent.video.title}`)),
      offset,
      limit,
      "There are no other eligible videos from this creator yet.",
    );
  }

  private async loadCreatorTv(offset: number, limit: number): Promise<DiscoveryPage> {
    const records = await this.database.client.creatorTvChannel.findMany({
      where: {
        status: "ACTIVE",
        disabledAt: null,
        channel: { status: "ACTIVE", removedAt: null },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: limit + 1,
      select: {
        id: true,
        name: true,
        slug: true,
        channel: { select: { handle: true, name: true } },
      },
    });
    return paged(
      records.map((tv) => ({
        id: tv.id,
        type: "CREATOR_TV" as const,
        title: tv.name,
        href: `/c/${tv.channel.handle}/tv`,
        kicker: "Creator TV",
        meta: tv.channel.name,
        artworkObjectKey: null,
      })),
      offset,
      limit,
      "Creator TV channels will appear here as creators join AYIN.",
    );
  }

  private async loadCreatorsYouFollow(
    profileId: string,
    offset: number,
    limit: number,
  ): Promise<DiscoveryPage> {
    const records = await this.database.client.subscription.findMany({
      where: { profileId, channel: { status: "ACTIVE", removedAt: null } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: limit + 1,
      select: { channel: { select: { id: true, handle: true, name: true } } },
    });
    return paged(
      records.map(({ channel }) => ({
        id: channel.id,
        type: "CHANNEL" as const,
        title: channel.name,
        href: `/c/${channel.handle}`,
        kicker: "Creator",
        meta: `@${channel.handle}`,
        artworkObjectKey: null,
      })),
      offset,
      limit,
      "Creators you follow will appear here when subscriptions are available in the consumer UI.",
    );
  }

  private async loadWatchLater(
    profileId: string,
    offset: number,
    limit: number,
  ): Promise<DiscoveryPage> {
    const records = await this.database.client.watchLaterItem.findMany({
      where: { profileId, video: publicVideoWhere },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: limit + 1,
      select: { video: { select: videoCardSelect } },
    });
    return paged(
      records.map(({ video }) => toVideoItem(video, "Watch Later")),
      offset,
      limit,
      "Your Watch Later list is empty.",
    );
  }

  private async loadHistory(
    profileId: string,
    offset: number,
    limit: number,
  ): Promise<DiscoveryPage> {
    const records = await this.database.client.watchHistory.findMany({
      where: { profileId, video: publicVideoWhere },
      orderBy: [{ lastWatchedAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: limit + 1,
      select: { video: { select: videoCardSelect } },
    });
    return paged(
      records.map(({ video }) => toVideoItem(video, "Watch History")),
      offset,
      limit,
      "Videos you watch will appear in your history.",
    );
  }

  private async loadLiked(
    profileId: string,
    offset: number,
    limit: number,
  ): Promise<DiscoveryPage> {
    const records = await this.database.client.reaction.findMany({
      where: { profileId, type: "LIKE", videoId: { not: null }, video: publicVideoWhere },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: limit + 1,
      select: { video: { select: videoCardSelect } },
    });
    const items = records.flatMap((record) =>
      record.video ? [toVideoItem(record.video, "Liked")] : [],
    );
    return paged(items, offset, limit, "Videos you like will appear here.");
  }

  private async loadOwnedPlaylists(
    accountId: string,
    offset: number,
    limit: number,
  ): Promise<DiscoveryPage> {
    const records = await this.database.client.playlist.findMany({
      where: {
        deletedAt: null,
        channel: { members: { some: { accountId } } },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: limit + 1,
      select: {
        id: true,
        name: true,
        slug: true,
        visibility: true,
        channel: { select: { handle: true, name: true } },
      },
    });
    return paged(
      records.map((playlist) => ({
        id: playlist.id,
        type: "PLAYLIST" as const,
        title: playlist.name,
        href:
          playlist.visibility === "PUBLIC"
            ? `/c/${playlist.channel.handle}/playlists/${playlist.slug}`
            : `/channel/playlists/${playlist.id}`,
        kicker: "Playlist",
        meta: `${playlist.channel.name} · ${playlist.visibility.toLowerCase()}`,
        artworkObjectKey: null,
      })),
      offset,
      limit,
      "Your creator playlists will appear here.",
    );
  }

  private async loadManualItems(
    rowId: string,
    offset: number,
    limit: number,
  ): Promise<DiscoveryPage> {
    const manual = await this.database.client.homeRowManualItem.findMany({
      where: { rowId },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      skip: offset,
      take: limit + 1,
    });
    if (manual.length === 0) {
      return emptyPage("No editor picks have been selected yet.");
    }

    const visible = manual.slice(0, limit + 1);
    const videoIds = visible.filter((item) => item.entityType === "VIDEO").map((item) => item.entityId);
    const tvIds = visible
      .filter((item) => item.entityType === "CREATOR_TV")
      .map((item) => item.entityId);
    const channelIds = visible
      .filter((item) => item.entityType === "CHANNEL")
      .map((item) => item.entityId);
    const playlistIds = visible
      .filter((item) => item.entityType === "PLAYLIST")
      .map((item) => item.entityId);

    const [videos, tvs, channels, playlists] = await Promise.all([
      videoIds.length
        ? this.database.client.video.findMany({
            where: { AND: [publicVideoWhere, { id: { in: videoIds } }] },
            select: videoCardSelect,
          })
        : [],
      tvIds.length
        ? this.database.client.creatorTvChannel.findMany({
            where: {
              id: { in: tvIds },
              status: "ACTIVE",
              disabledAt: null,
              channel: { status: "ACTIVE", removedAt: null },
            },
            select: {
              id: true,
              name: true,
              channel: { select: { handle: true, name: true } },
            },
          })
        : [],
      channelIds.length
        ? this.database.client.channel.findMany({
            where: { id: { in: channelIds }, status: "ACTIVE", removedAt: null },
            select: { id: true, handle: true, name: true },
          })
        : [],
      playlistIds.length
        ? this.database.client.playlist.findMany({
            where: {
              id: { in: playlistIds },
              deletedAt: null,
              visibility: "PUBLIC",
              channel: { status: "ACTIVE", removedAt: null },
            },
            select: {
              id: true,
              slug: true,
              name: true,
              channel: { select: { handle: true, name: true } },
            },
          })
        : [],
    ]);

    const mapped = new Map<string, DiscoveryItem>();
    for (const video of videos) mapped.set(`VIDEO:${video.id}`, toVideoItem(video, "Editor Pick"));
    for (const tv of tvs) {
      mapped.set(`CREATOR_TV:${tv.id}`, {
        id: tv.id,
        type: "CREATOR_TV",
        title: tv.name,
        href: `/c/${tv.channel.handle}/tv`,
        kicker: "Editor Pick · Creator TV",
        meta: tv.channel.name,
        artworkObjectKey: null,
      });
    }
    for (const channel of channels) {
      mapped.set(`CHANNEL:${channel.id}`, {
        id: channel.id,
        type: "CHANNEL",
        title: channel.name,
        href: `/c/${channel.handle}`,
        kicker: "Editor Pick · Creator",
        meta: `@${channel.handle}`,
        artworkObjectKey: null,
      });
    }
    for (const playlist of playlists) {
      mapped.set(`PLAYLIST:${playlist.id}`, {
        id: playlist.id,
        type: "PLAYLIST",
        title: playlist.name,
        href: `/c/${playlist.channel.handle}/playlists/${playlist.slug}`,
        kicker: "Editor Pick · Playlist",
        meta: playlist.channel.name,
        artworkObjectKey: null,
      });
    }
    const items = visible.flatMap((entry) => {
      const item = mapped.get(`${entry.entityType}:${entry.entityId}`);
      return item ? [item] : [];
    });
    return paged(items, offset, limit, "No eligible editor picks are available right now.");
  }
}

function toVideoItem(video: VideoCardRecord, kicker: string): DiscoveryItem {
  return {
    id: video.id,
    type: "VIDEO",
    title: video.title,
    href: `/watch/${video.slug}`,
    kicker,
    meta: [video.channel.name, formatDuration(video.durationMs)].filter(Boolean).join(" · ") || null,
    artworkObjectKey: video.mediaAssets[0]?.r2ObjectKey ?? null,
  };
}

function formatDuration(durationMs: number | null): string | null {
  if (!durationMs || durationMs <= 0) return null;
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function paged(
  input: DiscoveryItem[],
  offset: number,
  limit: number,
  emptyMessage = "Nothing is available in this row yet.",
): DiscoveryPage {
  const hasMore = input.length > limit;
  const items = input.slice(0, limit);
  return {
    items,
    nextCursor: hasMore ? encodeCursor(offset + items.length) : null,
    availability: items.length > 0 ? "AVAILABLE" : "EMPTY",
    emptyMessage,
  };
}

function emptyPage(
  emptyMessage: string,
  availability: DiscoveryAvailability = "EMPTY",
): DiscoveryPage {
  return { items: [], nextCursor: null, availability, emptyMessage };
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    const value = Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10);
    if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) throw new Error();
    return value;
  } catch {
    throw new DiscoveryError("INVALID_CURSOR", "This discovery cursor is invalid.");
  }
}

function normalizeRegionCode(region?: string): string | undefined {
  if (!region) return undefined;
  const normalized = region.trim().toUpperCase();
  return /^[A-Z0-9-]{2,12}$/.test(normalized) ? normalized : undefined;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}
