import type { Prisma } from "@ayin/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import { DatabaseService } from "../database/database.service.js";
import type { AnalyticsEventInput } from "./analytics.schemas.js";

const DAY_MS = 86_400_000;
const QUERY_WARN_MS = 750;
const SENSITIVE_METADATA_KEYS = new Set([
  "ip",
  "ipaddress",
  "clientip",
  "userip",
  "remoteaddress",
  "forwardedfor",
  "latitude",
  "longitude",
  "coordinates",
  "preciselocation",
  "referrer",
  "referrerurl",
]);

type BreakdownRow = { value: string | null; count: bigint };
type CountRow = { count: bigint };
type RetentionRow = {
  bucket: string;
  threshold: number;
  reached: bigint;
  total: bigint;
};

function clampDate(date: Date) {
  const now = Date.now();
  const min = now - 7 * DAY_MS;
  const max = now + 5 * 60_000;
  return new Date(Math.min(Math.max(date.getTime(), min), max));
}

function normalizedCountryCode(value?: string | null) {
  const candidate = value?.trim().toUpperCase();
  return candidate && candidate !== "XX" && /^[A-Z]{2}$/.test(candidate) ? candidate : null;
}

function sanitizeMetadata(
  metadata: AnalyticsEventInput["metadata"],
  countryCode?: string | null,
): Record<string, string | number | boolean | null> | undefined {
  const safe = Object.fromEntries(
    Object.entries(metadata ?? {}).filter(([key, value]) => {
      if (SENSITIVE_METADATA_KEYS.has(key.toLowerCase())) return false;
      return typeof value !== "string" || isIP(value) === 0;
    }),
  );
  const normalizedCountry = normalizedCountryCode(countryCode);
  if (normalizedCountry) safe.countryCode = normalizedCountry;
  return Object.keys(safe).length ? safe : undefined;
}

export function normalizeAnalyticsBreakdown(rows: BreakdownRow[], denominator: number) {
  const items = rows
    .filter((row) => row.value)
    .map((row) => ({ value: row.value as string, count: Number(row.count) }));
  const measured = items.reduce((total, item) => total + item.count, 0);
  return {
    available: measured > 0,
    coverage: denominator > 0 ? Math.min(1, measured / denominator) : 0,
    items,
  };
}

export function normalizeRetention(rows: RetentionRow[], views: number) {
  const total = rows.length ? Number(rows[0]?.total ?? 0n) : 0;
  return {
    available: total > 0,
    coverage: views > 0 ? Math.min(1, total / views) : 0,
    buckets: rows.map((row) => ({
      bucket: row.bucket,
      threshold: Number(row.threshold),
      viewers: Number(row.reached),
      rate: Number(row.total) > 0 ? Number(row.reached) / Number(row.total) : 0,
    })),
  };
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async ingest(events: AnalyticsEventInput[], context: { countryCode?: string | null } = {}) {
    const videoIds = [
      ...new Set(events.flatMap((event) => (event.videoId ? [event.videoId] : []))),
    ];
    const videos = videoIds.length
      ? await this.database.client.video.findMany({
          where: { id: { in: videoIds } },
          select: { id: true, channelId: true },
        })
      : [];
    const videoChannels = new Map(videos.map((video) => [video.id, video.channelId]));
    const suppliedChannelIds = [
      ...new Set(events.flatMap((event) => (event.channelId ? [event.channelId] : []))),
    ];
    const validChannelIds = new Set(
      (
        await this.database.client.channel.findMany({
          where: { id: { in: suppliedChannelIds } },
          select: { id: true },
        })
      ).map((channel) => channel.id),
    );

    const data: Prisma.AnalyticsEventCreateManyInput[] = [];
    for (const event of events) {
      if (event.videoId && !videoChannels.has(event.videoId)) continue;
      const derivedChannelId = event.videoId ? videoChannels.get(event.videoId) : event.channelId;
      if (
        derivedChannelId &&
        !videoChannels.has(event.videoId ?? "") &&
        !validChannelIds.has(derivedChannelId)
      ) {
        continue;
      }
      const metadata = sanitizeMetadata(event.metadata, context.countryCode);
      data.push({
        clientEventId: event.clientEventId,
        schemaVersion: event.schemaVersion,
        eventName: event.eventName,
        occurredAt: clampDate(new Date(event.occurredAt)),
        sessionHash: this.pseudonym(event.sessionId),
        ...(event.profileId ? { profileHash: this.pseudonym(event.profileId) } : {}),
        ...(derivedChannelId ? { channelId: derivedChannelId } : {}),
        ...(event.videoId ? { videoId: event.videoId } : {}),
        source: event.source,
        ...(event.deviceClass ? { deviceClass: event.deviceClass } : {}),
        ...(event.durationDeltaMs !== undefined && event.durationDeltaMs !== null
          ? { durationDeltaMs: event.durationDeltaMs }
          : {}),
        ...(event.positionMs !== undefined && event.positionMs !== null
          ? { positionMs: event.positionMs }
          : {}),
        ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
      });
    }

    if (!data.length) {
      return { accepted: 0, duplicateOrInvalid: events.length };
    }
    const result = await this.database.client.analyticsEvent.createMany({
      data,
      skipDuplicates: true,
    });
    return {
      accepted: result.count,
      duplicateOrInvalid: events.length - result.count,
    };
  }

  async creatorMetrics(accountId: string, days = 28) {
    const membership = await this.database.client.channelMember.findFirst({
      where: {
        accountId,
        role: { in: ["OWNER", "ADMIN", "EDITOR"] },
        channel: { status: { not: "REMOVED" } },
      },
      orderBy: { createdAt: "asc" },
      select: { channelId: true },
    });
    if (!membership) return null;
    return this.channelMetrics(membership.channelId, days);
  }

  async channelMetrics(channelId: string, days = 28) {
    const periodDays = Math.max(1, Math.min(days, 365));
    const to = new Date();
    const from = new Date(to.getTime() - periodDays * DAY_MS);
    const where = { channelId, occurredAt: { gte: from, lt: to } };

    return this.monitoredCreatorQuery(channelId, periodDays, async () => {
      const [
        views,
        completes,
        watch,
        uniqueSessionRows,
        subscribersGained,
        subscribersTotal,
        videoGroups,
        deviceGroups,
        startup,
        bufferEvents,
        bufferDuration,
        hlsFatal,
        fallbacks,
        qualitySwitches,
        trafficRows,
        geographyRows,
        protocolRows,
        retentionRows,
        adGroups,
      ] = await Promise.all([
        this.database.client.analyticsEvent.count({
          where: { ...where, eventName: "VIDEO_START" },
        }),
        this.database.client.analyticsEvent.count({
          where: { ...where, eventName: "VIDEO_COMPLETE" },
        }),
        this.database.client.analyticsEvent.aggregate({
          where: { ...where, eventName: "VIDEO_PROGRESS" },
          _sum: { durationDeltaMs: true },
        }),
        this.database.client.$queryRaw<CountRow[]>`
          SELECT COUNT(DISTINCT "sessionHash")::bigint AS count
          FROM "AnalyticsEvent"
          WHERE "channelId" = ${channelId}::uuid
            AND "occurredAt" >= ${from} AND "occurredAt" < ${to}
            AND "eventName" = 'VIDEO_START'
        `,
        this.database.client.subscription.count({
          where: { channelId, createdAt: { gte: from, lt: to } },
        }),
        this.database.client.subscription.count({ where: { channelId } }),
        this.database.client.analyticsEvent.groupBy({
          by: ["videoId"],
          where: {
            ...where,
            eventName: "VIDEO_START",
            videoId: { not: null },
          },
          _count: { _all: true },
          orderBy: { _count: { videoId: "desc" } },
          take: 10,
        }),
        this.database.client.analyticsEvent.groupBy({
          by: ["deviceClass"],
          where: { ...where, eventName: "VIDEO_START", deviceClass: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { deviceClass: "desc" } },
        }),
        this.database.client.analyticsEvent.aggregate({
          where: {
            ...where,
            eventName: "VIDEO_STARTUP",
            durationDeltaMs: { not: null },
          },
          _avg: { durationDeltaMs: true },
          _count: { durationDeltaMs: true },
        }),
        this.database.client.analyticsEvent.count({
          where: { ...where, eventName: "VIDEO_BUFFER" },
        }),
        this.database.client.analyticsEvent.aggregate({
          where: {
            ...where,
            eventName: "VIDEO_BUFFER",
            durationDeltaMs: { not: null },
          },
          _sum: { durationDeltaMs: true },
          _avg: { durationDeltaMs: true },
          _count: { durationDeltaMs: true },
        }),
        this.database.client.analyticsEvent.count({
          where: { ...where, eventName: "VIDEO_HLS_FATAL" },
        }),
        this.database.client.analyticsEvent.count({
          where: { ...where, eventName: "VIDEO_FALLBACK" },
        }),
        this.database.client.analyticsEvent.count({
          where: { ...where, eventName: "VIDEO_QUALITY_SWITCH" },
        }),
        this.database.client.$queryRaw<BreakdownRow[]>`
          SELECT metadata->>'trafficSource' AS value, COUNT(*)::bigint AS count
          FROM "AnalyticsEvent"
          WHERE "channelId" = ${channelId}::uuid
            AND "occurredAt" >= ${from} AND "occurredAt" < ${to}
            AND "eventName" = 'VIDEO_START'
            AND metadata->>'trafficSource' IS NOT NULL
          GROUP BY metadata->>'trafficSource'
          ORDER BY count DESC
          LIMIT 12
        `,
        this.database.client.$queryRaw<BreakdownRow[]>`
          SELECT metadata->>'countryCode' AS value, COUNT(*)::bigint AS count
          FROM "AnalyticsEvent"
          WHERE "channelId" = ${channelId}::uuid
            AND "occurredAt" >= ${from} AND "occurredAt" < ${to}
            AND "eventName" = 'VIDEO_START'
            AND metadata->>'countryCode' ~ '^[A-Z]{2}$'
          GROUP BY metadata->>'countryCode'
          ORDER BY count DESC
          LIMIT 20
        `,
        this.database.client.$queryRaw<BreakdownRow[]>`
          SELECT metadata->>'protocol' AS value, COUNT(*)::bigint AS count
          FROM "AnalyticsEvent"
          WHERE "channelId" = ${channelId}::uuid
            AND "occurredAt" >= ${from} AND "occurredAt" < ${to}
            AND "eventName" = 'VIDEO_START'
            AND metadata->>'protocol' IN ('HLS', 'MP4')
          GROUP BY metadata->>'protocol'
          ORDER BY count DESC
        `,
        this.database.client.$queryRaw<RetentionRow[]>`
          WITH starts AS (
            SELECT DISTINCT "sessionHash", "videoId"
            FROM "AnalyticsEvent"
            WHERE "channelId" = ${channelId}::uuid
              AND "occurredAt" >= ${from} AND "occurredAt" < ${to}
              AND "eventName" = 'VIDEO_START' AND "videoId" IS NOT NULL
          ), progress AS (
            SELECT "sessionHash", "videoId", MAX("positionMs") AS "maxPositionMs"
            FROM "AnalyticsEvent"
            WHERE "channelId" = ${channelId}::uuid
              AND "occurredAt" >= ${from} AND "occurredAt" < ${to}
              AND "eventName" = 'VIDEO_PROGRESS'
              AND "videoId" IS NOT NULL AND "positionMs" IS NOT NULL
            GROUP BY "sessionHash", "videoId"
          ), cohort AS (
            SELECT s."sessionHash", s."videoId", COALESCE(p."maxPositionMs", 0)::double precision AS position,
                   v."durationMs"::double precision AS duration
            FROM starts s
            JOIN "Video" v ON v.id = s."videoId"
            LEFT JOIN progress p ON p."sessionHash" = s."sessionHash" AND p."videoId" = s."videoId"
            WHERE v."durationMs" IS NOT NULL AND v."durationMs" > 0
          )
          SELECT b.bucket, b.threshold,
                 SUM(CASE WHEN cohort.position / cohort.duration >= b.threshold THEN 1 ELSE 0 END)::bigint AS reached,
                 COUNT(*)::bigint AS total
          FROM cohort
          CROSS JOIN (VALUES ('Start', 0.0), ('25%', 0.25), ('50%', 0.50), ('75%', 0.75), ('90%+', 0.90)) AS b(bucket, threshold)
          GROUP BY b.bucket, b.threshold
          ORDER BY b.threshold
        `,
        this.database.client.adEvent.groupBy({
          by: ["eventType"],
          where: {
            occurredAt: { gte: from, lt: to },
            eventType: { in: ["REQUEST", "FILL"] },
            video: { channelId },
          },
          _count: { _all: true },
        }),
      ]);

      const videoIds = videoGroups.flatMap((group) => (group.videoId ? [group.videoId] : []));
      const titles = new Map(
        (
          await this.database.client.video.findMany({
            where: { id: { in: videoIds } },
            select: { id: true, title: true },
          })
        ).map((video) => [video.id, video.title]),
      );
      const watchTimeMs = watch._sum.durationDeltaMs ?? 0;
      const uniqueViewersApprox = Number(uniqueSessionRows[0]?.count ?? 0n);
      const trafficSources = normalizeAnalyticsBreakdown(trafficRows, views);
      const geography = normalizeAnalyticsBreakdown(geographyRows, views);
      const protocols = normalizeAnalyticsBreakdown(protocolRows, views);
      const retention = normalizeRetention(retentionRows, views);
      const adCounts = new Map(adGroups.map((row) => [row.eventType, row._count._all]));
      const adRequests = adCounts.get("REQUEST") ?? 0;
      const adFills = adCounts.get("FILL") ?? 0;
      const measuredAdTelemetry = adRequests > 0;
      const deviceSamples = deviceGroups.reduce((sum, row) => sum + row._count._all, 0);

      return {
        periodDays,
        dateRange: {
          from: from.toISOString(),
          to: to.toISOString(),
          timezone: "UTC",
        },
        refresh: "query-time" as const,
        freshnessNote:
          "Computed from persisted events at request time. This is not realtime and ingestion can lag.",
        views,
        uniqueViewersApprox,
        uniqueViewerMethod: "Distinct pseudonymous playback sessions; not person-level identity.",
        watchTimeMs,
        averageViewDurationMs: views > 0 ? Math.round(watchTimeMs / views) : 0,
        completionRate: views > 0 ? Math.min(1, completes / views) : 0,
        subscribersGained,
        subscribersTotal,
        retention,
        trafficSources,
        devices: {
          available: deviceGroups.length > 0,
          coverage: views > 0 ? Math.min(1, deviceSamples / views) : 0,
          items: deviceGroups.map((row) => ({
            value: row.deviceClass ?? "UNKNOWN",
            count: row._count._all,
          })),
        },
        geography: {
          ...geography,
          note: geography.available
            ? "Country-level only, derived from trusted edge telemetry; no raw IP is stored for analytics."
            : "Unavailable for this period because reliable country-level edge telemetry was not recorded.",
        },
        topVideos: videoGroups.map((group) => ({
          videoId: group.videoId as string,
          title: titles.get(group.videoId as string) ?? "Untitled video",
          views: group._count._all,
        })),
        playbackQuality: {
          available:
            protocols.available ||
            startup._count.durationDeltaMs > 0 ||
            bufferEvents > 0 ||
            hlsFatal > 0,
          protocols,
          startup: {
            available: startup._count.durationDeltaMs > 0,
            sampleCount: startup._count.durationDeltaMs,
            averageMs:
              startup._avg.durationDeltaMs === null
                ? null
                : Math.round(startup._avg.durationDeltaMs),
          },
          buffering: {
            events: bufferEvents,
            measuredDurationSamples: bufferDuration._count.durationDeltaMs,
            totalDurationMs: bufferDuration._sum.durationDeltaMs ?? 0,
            averageDurationMs:
              bufferDuration._avg.durationDeltaMs === null
                ? null
                : Math.round(bufferDuration._avg.durationDeltaMs),
            eventsPerView: views > 0 ? bufferEvents / views : 0,
          },
          hlsFatalEvents: hlsFatal,
          mp4FallbackEvents: fallbacks,
          qualitySwitchEvents: qualitySwitches,
        },
        advertising: measuredAdTelemetry
          ? {
              available: true,
              opportunities: adRequests,
              fills: adFills,
              fillRate: adRequests > 0 ? Math.min(1, adFills / adRequests) : null,
              note: "Observed REQUEST/FILL ad events only. No revenue is inferred here.",
            }
          : {
              available: false,
              opportunities: null,
              fills: null,
              fillRate: null,
              note: "No measured ad REQUEST telemetry exists for this period; fill is not estimated.",
            },
      };
    });
  }

  async adminMetrics() {
    const now = Date.now();
    const day = new Date(now - DAY_MS);
    const month = new Date(now - 30 * DAY_MS);
    const [dailySessions, monthlySessions, watch, uploads, tvStarts, adEvents, errors] =
      await Promise.all([
        this.database.client.analyticsEvent.findMany({
          where: { occurredAt: { gte: day } },
          distinct: ["sessionHash"],
          select: { sessionHash: true },
        }),
        this.database.client.analyticsEvent.findMany({
          where: { occurredAt: { gte: month } },
          distinct: ["sessionHash"],
          select: { sessionHash: true },
        }),
        this.database.client.analyticsEvent.aggregate({
          where: { occurredAt: { gte: month }, eventName: "VIDEO_PROGRESS" },
          _sum: { durationDeltaMs: true },
        }),
        this.database.client.analyticsEvent.count({
          where: {
            occurredAt: { gte: month },
            eventName: { in: ["UPLOAD_COMPLETE", "PUBLISH"] },
          },
        }),
        this.database.client.analyticsEvent.count({
          where: { occurredAt: { gte: month }, eventName: "TV_START" },
        }),
        this.database.client.analyticsEvent.count({
          where: {
            occurredAt: { gte: month },
            eventName: {
              in: ["AD_REQUEST", "AD_START", "AD_QUARTILE", "AD_COMPLETE", "AD_CLICK", "AD_ERROR"],
            },
          },
        }),
        this.database.client.analyticsEvent.count({
          where: {
            occurredAt: { gte: month },
            eventName: { in: ["AD_ERROR", "VIDEO_BUFFER"] },
          },
        }),
      ]);
    const watchTimeMs = watch._sum.durationDeltaMs ?? 0;
    return {
      refresh: "query-time",
      dauApprox: dailySessions.length,
      mauApprox: monthlySessions.length,
      watchTimeMs,
      watchHours: watchTimeMs / 3_600_000,
      uploads,
      tvStarts,
      adEvents,
      errors,
    };
  }

  async deleteExpired(retentionDays = 400) {
    const days = Math.max(30, Math.min(retentionDays, 3650));
    const before = new Date(Date.now() - days * DAY_MS);
    const result = await this.database.client.analyticsEvent.deleteMany({
      where: { occurredAt: { lt: before } },
    });
    return { deleted: result.count, before, retentionDays: days };
  }

  private async monitoredCreatorQuery<T>(channelId: string, days: number, work: () => Promise<T>) {
    const startedAt = Date.now();
    try {
      return await work();
    } finally {
      const durationMs = Date.now() - startedAt;
      if (durationMs >= QUERY_WARN_MS) {
        this.logger.warn(
          `creator analytics query slow channel=${channelId} days=${days} durationMs=${durationMs}`,
        );
      } else {
        this.logger.debug(
          `creator analytics query channel=${channelId} days=${days} durationMs=${durationMs}`,
        );
      }
    }
  }

  private pseudonym(value: string) {
    const salt =
      process.env.ANALYTICS_HASH_SALT ?? process.env.AUTH_TOKEN_SECRET ?? "ayin-local-analytics-v1";
    return createHmac("sha256", salt).update(value).digest("hex");
  }
}
