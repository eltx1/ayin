import type { Prisma } from "@ayin/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { isIP } from "node:net";

import { DatabaseService } from "../database/database.service.js";
import { analyticsPseudonym } from "./analytics-identity.js";
import { cohortMilestone, configuredCohortMinSize } from "./analytics-cohort.js";
import { utcFloorDay } from "./analytics-rollup.service.js";
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

function completeUtcRange(days: number, now = new Date()) {
  const periodDays = Math.max(1, Math.min(days, 365));
  const to = utcFloorDay(now);
  const from = new Date(to.getTime() - periodDays * DAY_MS);
  return { periodDays, from, to };
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
        sessionHash: analyticsPseudonym(event.sessionId),
        ...(event.profileId ? { profileHash: analyticsPseudonym(event.profileId) } : {}),
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
    const { periodDays, from, to } = completeUtcRange(days);
    const where = { channelId, bucketStart: { gte: from, lt: to } };
    const cohortMinimum = configuredCohortMinSize();

    return this.monitoredCreatorQuery(channelId, periodDays, async () => {
      const [
        totals,
        uniqueSessionRows,
        subscribersGained,
        subscribersTotal,
        videoGroups,
        trafficRows,
        deviceRows,
        geographyRows,
        protocolRows,
        retentionRows,
        rollupState,
        audienceRows,
        cohortRows,
        subscriberCohortRows,
        cohortState,
      ] = await Promise.all([
        this.database.client.analyticsChannelDailyRollup.aggregate({
          where,
          _sum: {
            views: true,
            starts: true,
            watchTimeMs: true,
            completions: true,
            startupSamples: true,
            startupDurationMs: true,
            bufferEvents: true,
            bufferSamples: true,
            bufferDurationMs: true,
            hlsFatalEvents: true,
            mp4FallbackEvents: true,
            qualitySwitchEvents: true,
            adRequests: true,
            adFills: true,
          },
        }),
        this.database.client.$queryRaw<CountRow[]>`
          SELECT COUNT(DISTINCT "sessionHash")::bigint AS count
          FROM "AnalyticsPlaybackSessionDailyRollup"
          WHERE "channelId" = ${channelId}::uuid
            AND "bucketStart" >= ${from} AND "bucketStart" < ${to}
            AND "started" = true
        `,
        this.database.client.subscription.count({
          where: { channelId, createdAt: { gte: from, lt: to } },
        }),
        this.database.client.subscription.count({ where: { channelId } }),
        this.database.client.analyticsVideoDailyRollup.groupBy({
          by: ["videoId"],
          where,
          _sum: { views: true },
          orderBy: { _sum: { views: "desc" } },
          take: 10,
        }),
        this.dimensionBreakdown(channelId, from, to, "TRAFFIC_SOURCE", 12),
        this.dimensionBreakdown(channelId, from, to, "DEVICE", 12),
        this.dimensionBreakdown(channelId, from, to, "COUNTRY", 20),
        this.dimensionBreakdown(channelId, from, to, "PROTOCOL", 12),
        this.database.client.$queryRaw<RetentionRow[]>`
          WITH sessions AS (
            SELECT
              "sessionHash",
              "videoId",
              BOOL_OR("started") AS started,
              MAX("maxPositionMs") AS "maxPositionMs"
            FROM "AnalyticsPlaybackSessionDailyRollup"
            WHERE "channelId" = ${channelId}::uuid
              AND "bucketStart" >= ${from} AND "bucketStart" < ${to}
            GROUP BY "sessionHash", "videoId"
          ), cohort AS (
            SELECT
              s."sessionHash",
              s."videoId",
              COALESCE(s."maxPositionMs", 0)::double precision AS position,
              v."durationMs"::double precision AS duration
            FROM sessions s
            JOIN "Video" v ON v.id = s."videoId"
            WHERE s.started = true AND v."durationMs" IS NOT NULL AND v."durationMs" > 0
          )
          SELECT
            b.bucket,
            b.threshold,
            SUM(CASE WHEN cohort.position / cohort.duration >= b.threshold THEN 1 ELSE 0 END)::bigint AS reached,
            COUNT(*)::bigint AS total
          FROM cohort
          CROSS JOIN (
            VALUES ('Start', 0.0), ('25%', 0.25), ('50%', 0.50), ('75%', 0.75), ('90%+', 0.90)
          ) AS b(bucket, threshold)
          GROUP BY b.bucket, b.threshold
          ORDER BY b.threshold
        `,
        this.database.client.analyticsRollupState.findUnique({
          where: { key: "PRIMARY" },
          select: { lastSuccessfulAt: true },
        }),
        this.database.client.analyticsChannelAudienceDailyRollup.findMany({
          where: {
            channelId,
            bucketStart: { gte: from, lt: to },
            activeProfiles: { gte: cohortMinimum },
          },
          orderBy: { bucketStart: "asc" },
        }),
        this.database.client.analyticsChannelCohortRollup.findMany({
          where: {
            channelId,
            cohortDate: { gte: from, lt: to },
            cohortSize: { gte: cohortMinimum },
          },
          orderBy: { cohortDate: "asc" },
        }),
        this.database.client.analyticsSubscriberCohortRollup.findMany({
          where: {
            channelId,
            cohortDate: { gte: from, lt: to },
            cohortSize: { gte: cohortMinimum },
          },
          orderBy: { cohortDate: "asc" },
        }),
        this.database.client.analyticsCohortState.findUnique({
          where: { key: "PRIMARY" },
          select: { subscriberTrackingStartedAt: true },
        }),
      ]);

      const videoIds = videoGroups.map((group) => group.videoId);
      const titles = new Map(
        (
          await this.database.client.video.findMany({
            where: { id: { in: videoIds } },
            select: { id: true, title: true },
          })
        ).map((video) => [video.id, video.title]),
      );

      const views = totals._sum.views ?? 0;
      const completes = totals._sum.completions ?? 0;
      const watchTimeMs = Number(totals._sum.watchTimeMs ?? 0n);
      const uniqueViewersApprox = Number(uniqueSessionRows[0]?.count ?? 0n);
      const startupSamples = totals._sum.startupSamples ?? 0;
      const startupDurationMs = Number(totals._sum.startupDurationMs ?? 0n);
      const bufferEvents = totals._sum.bufferEvents ?? 0;
      const bufferSamples = totals._sum.bufferSamples ?? 0;
      const bufferDurationMs = Number(totals._sum.bufferDurationMs ?? 0n);
      const trafficSources = normalizeAnalyticsBreakdown(trafficRows, views);
      const devices = normalizeAnalyticsBreakdown(deviceRows, views);
      const geography = normalizeAnalyticsBreakdown(geographyRows, views);
      const protocols = normalizeAnalyticsBreakdown(protocolRows, views);
      const retention = normalizeRetention(retentionRows, views);
      const adRequests = totals._sum.adRequests ?? 0;
      const adFills = totals._sum.adFills ?? 0;
      const measuredAdTelemetry = adRequests > 0;
      const lastRollupCheck = rollupState?.lastSuccessfulAt?.toISOString() ?? null;

      return {
        periodDays,
        dateRange: {
          from: from.toISOString(),
          to: to.toISOString(),
          timezone: "UTC" as const,
        },
        refresh: "rollup" as const,
        lastRollupCheck,
        freshnessNote: `Complete UTC calendar days through ${to.toISOString()}. Rollups are scheduled and rerunnable, not realtime; late-arriving raw events can revise prior windows.`,
        views,
        uniqueViewersApprox,
        uniqueViewerMethod:
          "Distinct pseudonymous playback sessions from daily rollup projections; not person-level identity.",
        watchTimeMs,
        averageViewDurationMs: views > 0 ? Math.round(watchTimeMs / views) : 0,
        completionRate: views > 0 ? Math.min(1, completes / views) : 0,
        subscribersGained,
        subscribersTotal,
        retention,
        trafficSources,
        devices,
        geography: {
          ...geography,
          note: geography.available
            ? "Country-level only, derived from trusted edge telemetry; no raw IP is stored for analytics."
            : "Unavailable for this period because reliable country-level edge telemetry was not recorded.",
        },
        topVideos: videoGroups.map((group) => ({
          videoId: group.videoId,
          title: titles.get(group.videoId) ?? "Untitled video",
          views: group._sum.views ?? 0,
        })),
        playbackQuality: {
          available:
            protocols.available ||
            startupSamples > 0 ||
            bufferEvents > 0 ||
            (totals._sum.hlsFatalEvents ?? 0) > 0,
          protocols,
          startup: {
            available: startupSamples > 0,
            sampleCount: startupSamples,
            averageMs: startupSamples > 0 ? Math.round(startupDurationMs / startupSamples) : null,
          },
          buffering: {
            events: bufferEvents,
            measuredDurationSamples: bufferSamples,
            totalDurationMs: bufferDurationMs,
            averageDurationMs:
              bufferSamples > 0 ? Math.round(bufferDurationMs / bufferSamples) : null,
            eventsPerView: views > 0 ? bufferEvents / views : 0,
          },
          hlsFatalEvents: totals._sum.hlsFatalEvents ?? 0,
          mp4FallbackEvents: totals._sum.mp4FallbackEvents ?? 0,
          qualitySwitchEvents: totals._sum.qualitySwitchEvents ?? 0,
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
        cohorts: {
          minimumCohortSize: cohortMinimum,
          identityScope: "SIGNED_IN_PROFILE_PSEUDONYMS" as const,
          privacyNote:
            "Cross-day cohort metrics use only existing pseudonymous signed-in profile analytics. Anonymous sessions are not linked across contexts, and rows below the minimum cohort size are suppressed.",
          audienceDaily: audienceRows.map((row) => ({
            date: row.bucketStart.toISOString(),
            activeProfiles: row.activeProfiles,
            newProfiles: row.newProfiles,
            returningProfiles: row.returningProfiles,
            returningRate:
              row.activeProfiles > 0 ? row.returningProfiles / row.activeProfiles : 0,
            sessions: row.sessions,
            sessionsPerActiveProfile:
              row.activeProfiles > 0 ? row.sessions / row.activeProfiles : 0,
            watchTimeMs: Number(row.watchTimeMs),
            contentReturnProfiles: row.contentReturnProfiles,
            contentReturnRate:
              row.activeProfiles > 0 ? row.contentReturnProfiles / row.activeProfiles : 0,
          })),
          retention: cohortRows.map((row) => ({
            cohortDate: row.cohortDate.toISOString(),
            cohortSize: row.cohortSize,
            d1: cohortMilestone(
              row.cohortSize,
              row.d1Retained,
              row.d1Sessions,
              row.d1WatchTimeMs,
              row.d1ContentReturnProfiles,
            ),
            d7: cohortMilestone(
              row.cohortSize,
              row.d7Retained,
              row.d7Sessions,
              row.d7WatchTimeMs,
              row.d7ContentReturnProfiles,
            ),
            d30: cohortMilestone(
              row.cohortSize,
              row.d30Retained,
              row.d30Sessions,
              row.d30WatchTimeMs,
              row.d30ContentReturnProfiles,
            ),
          })),
          subscriberTrackingStartedAt:
            cohortState?.subscriberTrackingStartedAt.toISOString() ?? null,
          subscriberRetention: subscriberCohortRows.map((row) => ({
            cohortDate: row.cohortDate.toISOString(),
            cohortSize: row.cohortSize,
            d1: cohortMilestone(row.cohortSize, row.d1Retained),
            d7: cohortMilestone(row.cohortSize, row.d7Retained),
            d30: cohortMilestone(row.cohortSize, row.d30Retained),
          })),
        },
      };
    });
  }

  async adminMetrics() {
    const to = utcFloorDay(new Date());
    const day = new Date(to.getTime() - DAY_MS);
    const month = new Date(to.getTime() - 30 * DAY_MS);
    const cohortFrom = new Date(to.getTime() - 90 * DAY_MS);
    const cohortMinimum = configuredCohortMinSize();
    const [daily, monthlySessions, totals, rollupState, audienceRows, cohortRows] =
      await Promise.all([
      this.database.client.analyticsPlatformDailyRollup.findUnique({
        where: { bucketStart: day },
        select: { uniqueSessions: true },
      }),
      this.database.client.$queryRaw<CountRow[]>`
        SELECT COUNT(DISTINCT "sessionHash")::bigint AS count
        FROM "AnalyticsPlatformSessionDailyRollup"
        WHERE "bucketStart" >= ${month} AND "bucketStart" < ${to}
      `,
      this.database.client.analyticsPlatformDailyRollup.aggregate({
        where: { bucketStart: { gte: month, lt: to } },
        _sum: {
          watchTimeMs: true,
          uploads: true,
          tvStarts: true,
          adEvents: true,
          errors: true,
        },
      }),
      this.database.client.analyticsRollupState.findUnique({
        where: { key: "PRIMARY" },
        select: { lastSuccessfulAt: true },
      }),
      this.database.client.analyticsPlatformAudienceDailyRollup.findMany({
        where: {
          bucketStart: { gte: month, lt: to },
          activeProfiles: { gte: cohortMinimum },
        },
        orderBy: { bucketStart: "asc" },
      }),
      this.database.client.analyticsPlatformCohortRollup.findMany({
        where: {
          cohortDate: { gte: cohortFrom, lt: to },
          cohortSize: { gte: cohortMinimum },
        },
        orderBy: { cohortDate: "asc" },
      }),
    ]);

    const watchTimeMs = Number(totals._sum.watchTimeMs ?? 0n);
    return {
      refresh: "rollup" as const,
      dateRange: {
        from: month.toISOString(),
        to: to.toISOString(),
        timezone: "UTC" as const,
      },
      lastRollupCheck: rollupState?.lastSuccessfulAt?.toISOString() ?? null,
      freshnessNote: `Complete UTC calendar days through ${to.toISOString()}; scheduled rollups are not realtime.`,
      dauApprox: daily?.uniqueSessions ?? 0,
      mauApprox: Number(monthlySessions[0]?.count ?? 0n),
      watchTimeMs,
      watchHours: watchTimeMs / 3_600_000,
      uploads: totals._sum.uploads ?? 0,
      tvStarts: totals._sum.tvStarts ?? 0,
      adEvents: totals._sum.adEvents ?? 0,
      errors: totals._sum.errors ?? 0,
      cohorts: {
        minimumCohortSize: cohortMinimum,
        identityScope: "SIGNED_IN_PROFILE_PSEUDONYMS" as const,
        privacyNote:
          "Platform cohorts use existing pseudonymous signed-in profile analytics only. Anonymous sessions are not linked across contexts, and small cohorts are suppressed.",
        audienceDaily: audienceRows.map((row) => ({
          date: row.bucketStart.toISOString(),
          activeProfiles: row.activeProfiles,
          newProfiles: row.newProfiles,
          returningProfiles: row.returningProfiles,
          returningRate: row.activeProfiles > 0 ? row.returningProfiles / row.activeProfiles : 0,
          sessions: row.sessions,
          sessionsPerActiveProfile:
            row.activeProfiles > 0 ? row.sessions / row.activeProfiles : 0,
          watchTimeMs: Number(row.watchTimeMs),
        })),
        retention: cohortRows.map((row) => ({
          cohortDate: row.cohortDate.toISOString(),
          cohortSize: row.cohortSize,
          d1: cohortMilestone(row.cohortSize, row.d1Retained, row.d1Sessions, row.d1WatchTimeMs),
          d7: cohortMilestone(row.cohortSize, row.d7Retained, row.d7Sessions, row.d7WatchTimeMs),
          d30: cohortMilestone(
            row.cohortSize,
            row.d30Retained,
            row.d30Sessions,
            row.d30WatchTimeMs,
          ),
        })),
      },
    };
  }

  private async dimensionBreakdown(
    channelId: string,
    from: Date,
    to: Date,
    dimension: "DEVICE" | "TRAFFIC_SOURCE" | "COUNTRY" | "PROTOCOL",
    limit: number,
  ): Promise<BreakdownRow[]> {
    return this.database.client.$queryRaw<BreakdownRow[]>`
      SELECT "value", SUM("count")::bigint AS count
      FROM "AnalyticsChannelDailyDimensionRollup"
      WHERE "channelId" = ${channelId}::uuid
        AND "bucketStart" >= ${from} AND "bucketStart" < ${to}
        AND "dimension" = ${dimension}
      GROUP BY "value"
      ORDER BY count DESC, "value" ASC
      LIMIT ${limit}
    `;
  }

  private async monitoredCreatorQuery<T>(channelId: string, days: number, work: () => Promise<T>) {
    const startedAt = Date.now();
    try {
      return await work();
    } finally {
      const durationMs = Date.now() - startedAt;
      if (durationMs >= QUERY_WARN_MS) {
        this.logger.warn(
          `creator analytics rollup query slow channel=${channelId} days=${days} durationMs=${durationMs}`,
        );
      } else {
        this.logger.debug(
          `creator analytics rollup query channel=${channelId} days=${days} durationMs=${durationMs}`,
        );
      }
    }
  }

}
