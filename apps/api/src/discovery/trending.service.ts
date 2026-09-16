import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { kidsSafeHref } from "../kids/kids-policy.js";
import {
  defaultTrendingConfig,
  parseTrendingConfig,
  TRENDING_SETTING_KEY,
  TRENDING_SETTING_NAMESPACE,
  type TrendingConfig,
} from "../platform-config/trending-settings.js";
import { VideoPolicyService } from "../video-policy/video-policy.service.js";
import type { DiscoveryContext, DiscoveryItem, DiscoveryPage } from "./discovery.service.js";
import {
  scoreTrendingCandidates,
  selectTrendingScope,
  type TrendingRawMetrics,
  type TrendingScoredCandidate,
} from "./trending-engine.js";

const firstPageSize = 8;
const maxPageSize = 24;
const playableAssetStates = ["VALIDATED"] as const;
const completedThumbnailAssetStates = ["UPLOADED", "VALIDATED"] as const;

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
  channel: { select: { name: true } },
  mediaAssets: {
    where: {
      kind: "THUMBNAIL",
      status: { in: [...completedThumbnailAssetStates] },
      removedAt: null,
    },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { r2ObjectKey: true },
  },
} satisfies Prisma.VideoSelect;

type VideoCardRecord = Prisma.VideoGetPayload<{ select: typeof videoCardSelect }>;

type TrendingMetricRow = {
  videoId: string;
  qualifiedViews: bigint;
  recentQualifiedViews: bigint;
  priorQualifiedViews: bigint;
  watchTimeMs: bigint;
  completions: bigint;
  uniqueSessions: bigint;
  recencyScore: number | null;
  negativeSessions: bigint;
};

export interface TrendingDiscoveryRow extends DiscoveryPage {
  key: string;
  title: string;
  source: string;
  maxItems: number;
}

interface NormalizedTrendingContext extends DiscoveryContext {
  isKidsProfile: boolean;
}

@Injectable()
export class TrendingService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(VideoPolicyService) private readonly videoPolicy: VideoPolicyService,
  ) {}

  async applyRows(
    rows: TrendingDiscoveryRow[],
    context: DiscoveryContext = {},
  ): Promise<TrendingDiscoveryRow[]> {
    const normalized = await this.normalizeContext(context);
    return Promise.all(
      rows.map((row) =>
        isTrendingSource(row.source)
          ? this.applyPageNormalized(row.source, row, normalized, undefined, firstPageSize)
          : Promise.resolve(row),
      ),
    );
  }

  async applyPage(
    source: string,
    page: TrendingDiscoveryRow,
    context: DiscoveryContext = {},
    cursor?: string,
    requestedLimit?: number,
  ): Promise<TrendingDiscoveryRow> {
    if (!isTrendingSource(source)) return page;
    const normalized = await this.normalizeContext(context);
    return this.applyPageNormalized(source, page, normalized, cursor, requestedLimit);
  }

  async getConfig(): Promise<TrendingConfig> {
    const setting = await this.database.client.platformSetting.findUnique({
      where: {
        namespace_key: {
          namespace: TRENDING_SETTING_NAMESPACE,
          key: TRENDING_SETTING_KEY,
        },
      },
      select: { value: true },
    });
    return setting ? parseTrendingConfig(setting.value) : defaultTrendingConfig;
  }

  private async applyPageNormalized(
    source: string,
    page: TrendingDiscoveryRow,
    context: NormalizedTrendingContext,
    cursor?: string,
    requestedLimit?: number,
  ): Promise<TrendingDiscoveryRow> {
    const offset = decodeCursor(cursor);
    const limit = Math.min(
      Math.max(requestedLimit ?? firstPageSize, 1),
      maxPageSize,
      Math.max(page.maxItems - offset, 0),
    );
    if (limit === 0) {
      return {
        ...page,
        items: [],
        nextCursor: null,
        availability: "EMPTY",
        emptyMessage: "You reached the end of this row.",
      };
    }

    const config = await this.getConfig();
    const globalMetrics = await this.queryMetrics(config);
    const regionCode =
      source === "POPULAR_REGION" &&
      context.regionPersonalizationAllowed === true &&
      normalizeRegionCode(context.regionCode)
        ? normalizeRegionCode(context.regionCode)
        : undefined;
    const regionalMetrics = regionCode ? await this.queryMetrics(config, regionCode) : undefined;

    let selection =
      source === "TRENDING_WORLDWIDE"
        ? {
            scope: "GLOBAL" as const,
            regionalApplied: false,
            candidates: scoreTrendingCandidates(
              globalMetrics,
              config,
              config.minAudienceGlobal,
            ),
          }
        : selectTrendingScope(globalMetrics, regionalMetrics, config);

    let label = selection.regionalApplied ? "Trending in your region" : "Trending Worldwide";
    let items = await this.itemsForCandidates(selection.candidates, label, context);

    if (selection.regionalApplied && items.length === 0) {
      selection = {
        scope: "GLOBAL",
        regionalApplied: false,
        candidates: scoreTrendingCandidates(
          globalMetrics,
          config,
          config.minAudienceGlobal,
        ),
      };
      label = "Trending Worldwide";
      items = await this.itemsForCandidates(selection.candidates, label, context);
    }

    await this.persistSnapshots(
      selection.regionalApplied && regionCode ? `REGION:${regionCode}` : "GLOBAL",
      selection.regionalApplied ? regionCode : undefined,
      selection.candidates,
      config.snapshotLimit,
    );

    const capped = items.slice(0, page.maxItems);
    const slice = capped.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;
    const hasMore = nextOffset < capped.length;

    return {
      ...page,
      title: label,
      items: slice,
      nextCursor: hasMore ? encodeCursor(nextOffset) : null,
      availability: slice.length > 0 ? "AVAILABLE" : "EMPTY",
      emptyMessage:
        slice.length > 0
          ? page.emptyMessage
          : "No qualifying trending content is available right now.",
    };
  }

  private async queryMetrics(
    config: TrendingConfig,
    regionCode?: string,
  ): Promise<TrendingRawMetrics[]> {
    const now = new Date();
    const from = new Date(now.getTime() - config.windowHours * 3_600_000);
    const recentFrom = new Date(now.getTime() - config.recentHours * 3_600_000);
    const rows = regionCode
      ? await this.database.client.$queryRaw<TrendingMetricRow[]>`
          WITH relevant AS (
            SELECT "videoId", "sessionHash", "eventName", "occurredAt", "durationDeltaMs"
            FROM "AnalyticsEvent"
            WHERE "videoId" IS NOT NULL
              AND "occurredAt" >= ${from}
              AND "occurredAt" <= ${now}
              AND "eventName" IN (
                'VIDEO_START', 'VIDEO_PROGRESS', 'VIDEO_COMPLETE',
                'VIDEO_BUFFER', 'VIDEO_HLS_FATAL', 'VIDEO_FALLBACK'
              )
              AND metadata->>'countryCode' = ${regionCode}
          ),
          per_session AS (
            SELECT
              "videoId",
              "sessionHash",
              MIN("occurredAt") FILTER (WHERE "eventName" = 'VIDEO_START') AS "startAt",
              COALESCE(
                SUM(
                  GREATEST(0, LEAST(COALESCE("durationDeltaMs", 0), 60000))
                ) FILTER (WHERE "eventName" = 'VIDEO_PROGRESS'),
                0
              )::bigint AS "rawWatchMs",
              BOOL_OR("eventName" = 'VIDEO_COMPLETE') AS completed,
              BOOL_OR("eventName" IN ('VIDEO_BUFFER', 'VIDEO_HLS_FATAL', 'VIDEO_FALLBACK')) AS negative
            FROM relevant
            GROUP BY "videoId", "sessionHash"
            HAVING BOOL_OR("eventName" = 'VIDEO_START')
          ),
          session_quality AS (
            SELECT
              "videoId",
              "sessionHash",
              "startAt",
              LEAST("rawWatchMs", ${config.perSessionWatchCapMs}::bigint)::bigint AS "watchMs",
              completed,
              negative,
              ("rawWatchMs" >= ${config.minQualifiedWatchMs} OR completed) AS qualified
            FROM per_session
          )
          SELECT
            "videoId"::text AS "videoId",
            COUNT(*) FILTER (WHERE qualified)::bigint AS "qualifiedViews",
            COUNT(*) FILTER (WHERE qualified AND "startAt" >= ${recentFrom})::bigint
              AS "recentQualifiedViews",
            COUNT(*) FILTER (WHERE qualified AND "startAt" < ${recentFrom})::bigint
              AS "priorQualifiedViews",
            COALESCE(SUM("watchMs") FILTER (WHERE qualified), 0)::bigint AS "watchTimeMs",
            COUNT(*) FILTER (WHERE qualified AND completed)::bigint AS completions,
            COUNT(*)::bigint AS "uniqueSessions",
            COALESCE(
              AVG(
                POWER(
                  0.5,
                  EXTRACT(EPOCH FROM (${now} - "startAt")) / 3600.0 / ${config.halfLifeHours}
                )
              ) FILTER (WHERE qualified),
              0
            )::double precision AS "recencyScore",
            COUNT(*) FILTER (WHERE negative)::bigint AS "negativeSessions"
          FROM session_quality
          GROUP BY "videoId"
          HAVING COUNT(*) FILTER (WHERE qualified) > 0
          ORDER BY "qualifiedViews" DESC
          LIMIT ${config.maxCandidates * 4}
        `
      : await this.database.client.$queryRaw<TrendingMetricRow[]>`
          WITH relevant AS (
            SELECT "videoId", "sessionHash", "eventName", "occurredAt", "durationDeltaMs"
            FROM "AnalyticsEvent"
            WHERE "videoId" IS NOT NULL
              AND "occurredAt" >= ${from}
              AND "occurredAt" <= ${now}
              AND "eventName" IN (
                'VIDEO_START', 'VIDEO_PROGRESS', 'VIDEO_COMPLETE',
                'VIDEO_BUFFER', 'VIDEO_HLS_FATAL', 'VIDEO_FALLBACK'
              )
          ),
          per_session AS (
            SELECT
              "videoId",
              "sessionHash",
              MIN("occurredAt") FILTER (WHERE "eventName" = 'VIDEO_START') AS "startAt",
              COALESCE(
                SUM(
                  GREATEST(0, LEAST(COALESCE("durationDeltaMs", 0), 60000))
                ) FILTER (WHERE "eventName" = 'VIDEO_PROGRESS'),
                0
              )::bigint AS "rawWatchMs",
              BOOL_OR("eventName" = 'VIDEO_COMPLETE') AS completed,
              BOOL_OR("eventName" IN ('VIDEO_BUFFER', 'VIDEO_HLS_FATAL', 'VIDEO_FALLBACK')) AS negative
            FROM relevant
            GROUP BY "videoId", "sessionHash"
            HAVING BOOL_OR("eventName" = 'VIDEO_START')
          ),
          session_quality AS (
            SELECT
              "videoId",
              "sessionHash",
              "startAt",
              LEAST("rawWatchMs", ${config.perSessionWatchCapMs}::bigint)::bigint AS "watchMs",
              completed,
              negative,
              ("rawWatchMs" >= ${config.minQualifiedWatchMs} OR completed) AS qualified
            FROM per_session
          )
          SELECT
            "videoId"::text AS "videoId",
            COUNT(*) FILTER (WHERE qualified)::bigint AS "qualifiedViews",
            COUNT(*) FILTER (WHERE qualified AND "startAt" >= ${recentFrom})::bigint
              AS "recentQualifiedViews",
            COUNT(*) FILTER (WHERE qualified AND "startAt" < ${recentFrom})::bigint
              AS "priorQualifiedViews",
            COALESCE(SUM("watchMs") FILTER (WHERE qualified), 0)::bigint AS "watchTimeMs",
            COUNT(*) FILTER (WHERE qualified AND completed)::bigint AS completions,
            COUNT(*)::bigint AS "uniqueSessions",
            COALESCE(
              AVG(
                POWER(
                  0.5,
                  EXTRACT(EPOCH FROM (${now} - "startAt")) / 3600.0 / ${config.halfLifeHours}
                )
              ) FILTER (WHERE qualified),
              0
            )::double precision AS "recencyScore",
            COUNT(*) FILTER (WHERE negative)::bigint AS "negativeSessions"
          FROM session_quality
          GROUP BY "videoId"
          HAVING COUNT(*) FILTER (WHERE qualified) > 0
          ORDER BY "qualifiedViews" DESC
          LIMIT ${config.maxCandidates * 4}
        `;

    return rows.slice(0, config.maxCandidates).map((row) => ({
      videoId: row.videoId,
      qualifiedViews: Number(row.qualifiedViews),
      recentQualifiedViews: Number(row.recentQualifiedViews),
      priorQualifiedViews: Number(row.priorQualifiedViews),
      watchTimeMs: Number(row.watchTimeMs),
      completions: Number(row.completions),
      uniqueSessions: Number(row.uniqueSessions),
      recencyScore: row.recencyScore ?? 0,
      negativeSessions: Number(row.negativeSessions),
    }));
  }

  private async itemsForCandidates(
    candidates: TrendingScoredCandidate[],
    label: string,
    context: NormalizedTrendingContext,
  ): Promise<DiscoveryItem[]> {
    if (!candidates.length) return [];
    const ids = candidates.map((candidate) => candidate.videoId);
    const videos = await this.database.client.video.findMany({
      where: { AND: [publicVideoWhere, { id: { in: ids } }] },
      select: videoCardSelect,
    });
    const allowed = await this.videoPolicy.filterAvailableVideoIds(
      videos.map((video) => video.id),
      {
        countryCode: context.availabilityCountryCode,
        isKidsProfile: context.isKidsProfile,
      },
    );
    const byId = new Map(videos.map((video) => [video.id, video]));
    return candidates.flatMap((candidate) => {
      const video = byId.get(candidate.videoId);
      if (!video || !allowed.has(candidate.videoId)) return [];
      const item = toVideoItem(video, label);
      return [context.isKidsProfile ? { ...item, href: kidsSafeHref(item.href) } : item];
    });
  }

  private async persistSnapshots(
    scopeKey: string,
    regionCode: string | undefined,
    candidates: TrendingScoredCandidate[],
    limit: number,
  ): Promise<void> {
    const sampledAt = new Date();
    await Promise.allSettled(
      candidates.slice(0, limit).map((candidate) =>
        this.database.client.trendingScoreSnapshot.upsert({
          where: { scopeKey_videoId: { scopeKey, videoId: candidate.videoId } },
          update: {
            regionCode: regionCode ?? null,
            score: candidate.score,
            audienceCount: candidate.audienceCount,
            components: candidate.components as unknown as Prisma.InputJsonValue,
            sampledAt,
          },
          create: {
            scopeKey,
            regionCode: regionCode ?? null,
            videoId: candidate.videoId,
            score: candidate.score,
            audienceCount: candidate.audienceCount,
            components: candidate.components as unknown as Prisma.InputJsonValue,
            sampledAt,
          },
        }),
      ),
    );
  }

  private async normalizeContext(context: DiscoveryContext): Promise<NormalizedTrendingContext> {
    if (context.isKidsProfile !== undefined) {
      return { ...context, isKidsProfile: context.isKidsProfile === true };
    }
    if (!context.accountId) return { ...context, isKidsProfile: false };

    const profile = context.profileId
      ? await this.database.client.viewerProfile.findFirst({
          where: { id: context.profileId, accountId: context.accountId, deletedAt: null },
          select: { isKids: true },
        })
      : await this.database.client.viewerProfile.findFirst({
          where: { accountId: context.accountId, isDefault: true, deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: { isKids: true },
        });
    return { ...context, isKidsProfile: profile?.isKids === true };
  }
}

function isTrendingSource(source: string): boolean {
  return source === "TRENDING_WORLDWIDE" || source === "POPULAR_REGION";
}

function normalizeRegionCode(regionCode?: string): string | undefined {
  const normalized = regionCode?.trim().toUpperCase();
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : undefined;
}

function toVideoItem(video: VideoCardRecord, label: string): DiscoveryItem {
  return {
    id: video.id,
    type: "VIDEO",
    title: video.title,
    href: `/watch/${video.slug}`,
    kicker: label,
    meta:
      [video.channel.name, formatDuration(video.durationMs)].filter(Boolean).join(" · ") || null,
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

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    const value = Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10);
    return Number.isSafeInteger(value) && value >= 0 && value <= 10_000 ? value : 0;
  } catch {
    return 0;
  }
}
