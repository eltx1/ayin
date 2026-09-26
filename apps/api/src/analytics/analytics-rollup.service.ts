import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";

const DAY_MS = 86_400_000;
const DEFAULT_RETENTION_DAYS = 400;
const LATE_ARRIVAL_SCAN_OVERLAP_MS = 15 * 60_000;
const COHORT_MAX_HORIZON_DAYS = 30;
const ROLLUP_ADVISORY_LOCK_KEY = 820082;
const ROLLUP_STATE_KEY = "PRIMARY";

type RollupRange = { from: Date; to: Date } | null;

export function utcFloorHour(value: Date): Date {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
      value.getUTCHours(),
      0,
      0,
      0,
    ),
  );
}

export function utcFloorDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0),
  );
}

function earliestDate(values: Array<Date | null | undefined>): Date | null {
  let result: Date | null = null;
  for (const value of values) {
    if (!value) continue;
    if (!result || value.getTime() < result.getTime()) result = value;
  }
  return result;
}

function maxDate(left: Date, right: Date): Date {
  return left.getTime() >= right.getTime() ? left : right;
}

export function configuredAnalyticsRetentionDays(): number {
  const parsed = Number(process.env.ANALYTICS_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS);
  if (!Number.isFinite(parsed)) return DEFAULT_RETENTION_DAYS;
  return Math.max(30, Math.min(3650, Math.trunc(parsed)));
}

// Materialize only closed UTC buckets; the current partial hour/day remains raw-only.
@Injectable()
export class AnalyticsRollupService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async sync(now = new Date()) {
    const cutoff = new Date(now);
    const currentHour = utcFloorHour(cutoff);
    const currentDay = utcFloorDay(cutoff);
    const retentionStart = new Date(cutoff.getTime() - configuredAnalyticsRetentionDays() * DAY_MS);
    const state = await this.database.client.analyticsRollupState.findUnique({
      where: { key: ROLLUP_STATE_KEY },
    });

    let dirtyOccurredAt: Date | null = null;
    if (state?.lastSuccessfulAt) {
      const receiptScanFrom = new Date(
        state.lastSuccessfulAt.getTime() - LATE_ARRIVAL_SCAN_OVERLAP_MS,
      );
      const [analyticsDirty, adDirty] = await Promise.all([
        this.database.client.analyticsEvent.aggregate({
          where: {
            receivedAt: { gt: receiptScanFrom, lte: cutoff },
          },
          _min: { occurredAt: true },
        }),
        this.database.client.adEvent.aggregate({
          where: {
            createdAt: { gt: receiptScanFrom, lte: cutoff },
          },
          _min: { occurredAt: true },
        }),
      ]);
      dirtyOccurredAt = earliestDate([analyticsDirty._min.occurredAt, adDirty._min.occurredAt]);
    }

    let hourlyFrom: Date | null;
    let dailyFrom: Date | null;
    if (!state?.lastSuccessfulAt) {
      hourlyFrom = utcFloorHour(retentionStart);
      dailyFrom = utcFloorDay(retentionStart);
    } else {
      const scheduledHourlyFrom =
        state.lastSuccessfulAt.getTime() < currentHour.getTime()
          ? utcFloorHour(state.lastSuccessfulAt)
          : null;
      const scheduledDailyFrom =
        state.lastSuccessfulAt.getTime() < currentDay.getTime()
          ? utcFloorDay(state.lastSuccessfulAt)
          : null;
      const earliestHourly = earliestDate([dirtyOccurredAt, scheduledHourlyFrom]);
      const earliestDaily = earliestDate([dirtyOccurredAt, scheduledDailyFrom]);
      hourlyFrom = earliestHourly ? utcFloorHour(maxDate(earliestHourly, retentionStart)) : null;
      dailyFrom = earliestDaily ? utcFloorDay(maxDate(earliestDaily, retentionStart)) : null;
    }

    const hourlyRange: RollupRange =
      hourlyFrom && hourlyFrom.getTime() < currentHour.getTime()
        ? { from: hourlyFrom, to: currentHour }
        : null;
    const dailyRange: RollupRange =
      dailyFrom && dailyFrom.getTime() < currentDay.getTime()
        ? { from: dailyFrom, to: currentDay }
        : null;

    if (hourlyRange) {
      await this.rebuildVideoHourly(hourlyRange.from, hourlyRange.to);
    }
    let cohortRange: RollupRange = null;
    if (dailyRange) {
      await this.rebuildDaily(dailyRange.from, dailyRange.to);
      const cohortFrom = utcFloorDay(
        maxDate(
          new Date(dailyRange.from.getTime() - COHORT_MAX_HORIZON_DAYS * DAY_MS),
          retentionStart,
        ),
      );
      cohortRange = { from: cohortFrom, to: currentDay };
      await this.rebuildCohorts(cohortRange.from, cohortRange.to);
    }

    await this.database.client.$executeRaw`
      INSERT INTO "AnalyticsRollupState" ("key", "lastSuccessfulAt", "updatedAt")
      VALUES (${ROLLUP_STATE_KEY}, ${cutoff}, ${cutoff})
      ON CONFLICT ("key") DO UPDATE SET
        "lastSuccessfulAt" = GREATEST(
          COALESCE("AnalyticsRollupState"."lastSuccessfulAt", EXCLUDED."lastSuccessfulAt"),
          EXCLUDED."lastSuccessfulAt"
        ),
        "updatedAt" = CURRENT_TIMESTAMP
    `;

    return {
      cutoff,
      hourlyRange,
      dailyRange,
      cohortRange,
      retentionDays: configuredAnalyticsRetentionDays(),
    };
  }

  async cleanupIfDue(now = new Date()) {
    const state = await this.database.client.analyticsRollupState.findUnique({
      where: { key: ROLLUP_STATE_KEY },
      select: { lastCleanupAt: true },
    });
    const currentDay = utcFloorDay(now);
    if (state?.lastCleanupAt && state.lastCleanupAt.getTime() >= currentDay.getTime()) {
      return { ran: false as const, deleted: 0, projectionRowsDeleted: 0 };
    }

    const result = await this.deleteExpiredTruth(configuredAnalyticsRetentionDays(), now);
    await this.database.client.$executeRaw`
      INSERT INTO "AnalyticsRollupState" (
        "key", "lastSuccessfulAt", "lastCleanupAt", "updatedAt"
      )
      VALUES (${ROLLUP_STATE_KEY}, ${now}, ${now}, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "lastCleanupAt" = GREATEST(
          COALESCE("AnalyticsRollupState"."lastCleanupAt", EXCLUDED."lastCleanupAt"),
          EXCLUDED."lastCleanupAt"
        ),
        "updatedAt" = CURRENT_TIMESTAMP
    `;
    return {
      ran: true as const,
      deleted: result.deleted,
      projectionRowsDeleted: result.projectionRowsDeleted,
    };
  }

  async deleteExpiredTruth(retentionDays = DEFAULT_RETENTION_DAYS, now = new Date()) {
    const days = Math.max(30, Math.min(retentionDays, 3650));
    const before = utcFloorDay(new Date(now.getTime() - days * DAY_MS));
    const projectionBefore = before;

    const result = await this.database.client.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `DO $task82$ BEGIN PERFORM pg_advisory_xact_lock(${ROLLUP_ADVISORY_LOCK_KEY}); END $task82$;`,
        );
        const raw = await tx.analyticsEvent.deleteMany({
          where: { occurredAt: { lt: before } },
        });
        const playbackSessions = await tx.analyticsPlaybackSessionDailyRollup.deleteMany({
          where: { bucketStart: { lt: projectionBefore } },
        });
        const platformSessions = await tx.analyticsPlatformSessionDailyRollup.deleteMany({
          where: { bucketStart: { lt: projectionBefore } },
        });
        const subscriptionEpisodes = await tx.analyticsSubscriptionEpisode.deleteMany({
          where: { subscribedAt: { lt: before } },
        });
        return {
          deleted: raw.count,
          projectionRowsDeleted:
            playbackSessions.count + platformSessions.count + subscriptionEpisodes.count,
        };
      },
      { maxWait: 10_000, timeout: 120_000 },
    );

    return {
      ...result,
      before,
      projectionBefore,
      retentionDays: days,
    };
  }

  async rebuildVideoHourly(from: Date, to: Date): Promise<void> {
    if (from.getTime() >= to.getTime()) return;
    await this.database.client.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `DO $task82$ BEGIN PERFORM pg_advisory_xact_lock(${ROLLUP_ADVISORY_LOCK_KEY}); END $task82$;`,
        );
        await tx.analyticsVideoHourlyRollup.deleteMany({
          where: { bucketStart: { gte: from, lt: to } },
        });
        await tx.$executeRaw`
          INSERT INTO "AnalyticsVideoHourlyRollup" (
            "bucketStart", "channelId", "videoId", "views", "starts", "watchTimeMs",
            "completions", "startupSamples", "startupDurationMs", "bufferEvents",
            "bufferSamples", "bufferDurationMs", "hlsFatalEvents", "mp4FallbackEvents",
            "qualitySwitchEvents", "adRequests", "adStarts", "adCompletes", "adClicks", "adErrors"
          )
          SELECT
            date_trunc('hour', "occurredAt") AS "bucketStart",
            "channelId",
            "videoId",
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_START')::int AS "views",
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_START')::int AS "starts",
            COALESCE(SUM("durationDeltaMs") FILTER (WHERE "eventName" = 'VIDEO_PROGRESS'), 0)::bigint AS "watchTimeMs",
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_COMPLETE')::int AS "completions",
            COUNT("durationDeltaMs") FILTER (WHERE "eventName" = 'VIDEO_STARTUP')::int AS "startupSamples",
            COALESCE(SUM("durationDeltaMs") FILTER (WHERE "eventName" = 'VIDEO_STARTUP'), 0)::bigint AS "startupDurationMs",
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_BUFFER')::int AS "bufferEvents",
            COUNT("durationDeltaMs") FILTER (WHERE "eventName" = 'VIDEO_BUFFER')::int AS "bufferSamples",
            COALESCE(SUM("durationDeltaMs") FILTER (WHERE "eventName" = 'VIDEO_BUFFER'), 0)::bigint AS "bufferDurationMs",
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_HLS_FATAL')::int AS "hlsFatalEvents",
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_FALLBACK')::int AS "mp4FallbackEvents",
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_QUALITY_SWITCH')::int AS "qualitySwitchEvents",
            COUNT(*) FILTER (WHERE "eventName" = 'AD_REQUEST')::int AS "adRequests",
            COUNT(*) FILTER (WHERE "eventName" = 'AD_START')::int AS "adStarts",
            COUNT(*) FILTER (WHERE "eventName" = 'AD_COMPLETE')::int AS "adCompletes",
            COUNT(*) FILTER (WHERE "eventName" = 'AD_CLICK')::int AS "adClicks",
            COUNT(*) FILTER (WHERE "eventName" = 'AD_ERROR')::int AS "adErrors"
          FROM "AnalyticsEvent"
          WHERE "occurredAt" >= ${from}
            AND "occurredAt" < ${to}
            AND "videoId" IS NOT NULL
            AND "channelId" IS NOT NULL
          GROUP BY date_trunc('hour', "occurredAt"), "channelId", "videoId"
        `;
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
  }

  async rebuildDaily(from: Date, to: Date): Promise<void> {
    if (from.getTime() >= to.getTime()) return;
    await this.database.client.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `DO $task82$ BEGIN PERFORM pg_advisory_xact_lock(${ROLLUP_ADVISORY_LOCK_KEY}); END $task82$;`,
        );
        await tx.analyticsVideoDailyRollup.deleteMany({
          where: { bucketStart: { gte: from, lt: to } },
        });
        await tx.analyticsChannelDailyRollup.deleteMany({
          where: { bucketStart: { gte: from, lt: to } },
        });
        await tx.analyticsChannelDailyDimensionRollup.deleteMany({
          where: { bucketStart: { gte: from, lt: to } },
        });
        await tx.analyticsPlaybackSessionDailyRollup.deleteMany({
          where: { bucketStart: { gte: from, lt: to } },
        });
        await tx.analyticsPlatformSessionDailyRollup.deleteMany({
          where: { bucketStart: { gte: from, lt: to } },
        });
        await tx.analyticsPlatformDailyRollup.deleteMany({
          where: { bucketStart: { gte: from, lt: to } },
        });

        await tx.$executeRaw`
          INSERT INTO "AnalyticsVideoDailyRollup" (
            "bucketStart", "channelId", "videoId", "views", "starts", "watchTimeMs",
            "completions", "startupSamples", "startupDurationMs", "bufferEvents",
            "bufferSamples", "bufferDurationMs", "hlsFatalEvents", "mp4FallbackEvents",
            "qualitySwitchEvents", "adRequests", "adStarts", "adCompletes", "adClicks", "adErrors"
          )
          SELECT
            date_trunc('day', "occurredAt") AS "bucketStart",
            "channelId",
            "videoId",
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_START')::int,
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_START')::int,
            COALESCE(SUM("durationDeltaMs") FILTER (WHERE "eventName" = 'VIDEO_PROGRESS'), 0)::bigint,
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_COMPLETE')::int,
            COUNT("durationDeltaMs") FILTER (WHERE "eventName" = 'VIDEO_STARTUP')::int,
            COALESCE(SUM("durationDeltaMs") FILTER (WHERE "eventName" = 'VIDEO_STARTUP'), 0)::bigint,
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_BUFFER')::int,
            COUNT("durationDeltaMs") FILTER (WHERE "eventName" = 'VIDEO_BUFFER')::int,
            COALESCE(SUM("durationDeltaMs") FILTER (WHERE "eventName" = 'VIDEO_BUFFER'), 0)::bigint,
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_HLS_FATAL')::int,
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_FALLBACK')::int,
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_QUALITY_SWITCH')::int,
            COUNT(*) FILTER (WHERE "eventName" = 'AD_REQUEST')::int,
            COUNT(*) FILTER (WHERE "eventName" = 'AD_START')::int,
            COUNT(*) FILTER (WHERE "eventName" = 'AD_COMPLETE')::int,
            COUNT(*) FILTER (WHERE "eventName" = 'AD_CLICK')::int,
            COUNT(*) FILTER (WHERE "eventName" = 'AD_ERROR')::int
          FROM "AnalyticsEvent"
          WHERE "occurredAt" >= ${from}
            AND "occurredAt" < ${to}
            AND "videoId" IS NOT NULL
            AND "channelId" IS NOT NULL
          GROUP BY date_trunc('day', "occurredAt"), "channelId", "videoId"
        `;

        await tx.$executeRaw`
          INSERT INTO "AnalyticsChannelDailyRollup" (
            "bucketStart", "channelId", "views", "starts", "watchTimeMs", "completions",
            "subscribeEvents", "likeEvents", "startupSamples", "startupDurationMs",
            "bufferEvents", "bufferSamples", "bufferDurationMs", "hlsFatalEvents",
            "mp4FallbackEvents", "qualitySwitchEvents", "analyticsAdEvents", "analyticsAdErrors"
          )
          SELECT
            date_trunc('day', "occurredAt") AS "bucketStart",
            "channelId",
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_START')::int,
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_START')::int,
            COALESCE(SUM("durationDeltaMs") FILTER (WHERE "eventName" = 'VIDEO_PROGRESS'), 0)::bigint,
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_COMPLETE')::int,
            COUNT(*) FILTER (WHERE "eventName" = 'SUBSCRIBE')::int,
            COUNT(*) FILTER (WHERE "eventName" = 'LIKE')::int,
            COUNT("durationDeltaMs") FILTER (WHERE "eventName" = 'VIDEO_STARTUP')::int,
            COALESCE(SUM("durationDeltaMs") FILTER (WHERE "eventName" = 'VIDEO_STARTUP'), 0)::bigint,
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_BUFFER')::int,
            COUNT("durationDeltaMs") FILTER (WHERE "eventName" = 'VIDEO_BUFFER')::int,
            COALESCE(SUM("durationDeltaMs") FILTER (WHERE "eventName" = 'VIDEO_BUFFER'), 0)::bigint,
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_HLS_FATAL')::int,
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_FALLBACK')::int,
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_QUALITY_SWITCH')::int,
            COUNT(*) FILTER (
              WHERE "eventName" IN ('AD_REQUEST', 'AD_START', 'AD_QUARTILE', 'AD_COMPLETE', 'AD_CLICK', 'AD_ERROR')
            )::int,
            COUNT(*) FILTER (WHERE "eventName" = 'AD_ERROR')::int
          FROM "AnalyticsEvent"
          WHERE "occurredAt" >= ${from}
            AND "occurredAt" < ${to}
            AND "channelId" IS NOT NULL
          GROUP BY date_trunc('day', "occurredAt"), "channelId"
        `;

        await tx.$executeRaw`
          INSERT INTO "AnalyticsChannelDailyRollup" (
            "bucketStart", "channelId", "adRequests", "adFills"
          )
          SELECT
            date_trunc('day', ae."occurredAt") AS "bucketStart",
            v."channelId",
            COUNT(*) FILTER (WHERE ae."eventType" = 'REQUEST')::int,
            COUNT(*) FILTER (WHERE ae."eventType" = 'FILL')::int
          FROM "AdEvent" ae
          JOIN "Video" v ON v."id" = ae."videoId"
          WHERE ae."occurredAt" >= ${from}
            AND ae."occurredAt" < ${to}
            AND ae."eventType" IN ('REQUEST', 'FILL')
          GROUP BY date_trunc('day', ae."occurredAt"), v."channelId"
          ON CONFLICT ("bucketStart", "channelId")
          DO UPDATE SET
            "adRequests" = EXCLUDED."adRequests",
            "adFills" = EXCLUDED."adFills"
        `;

        await tx.$executeRaw`
          INSERT INTO "AnalyticsChannelDailyDimensionRollup" (
            "bucketStart", "channelId", "dimension", "value", "count"
          )
          SELECT date_trunc('day', "occurredAt"), "channelId", 'DEVICE', "deviceClass", COUNT(*)::int
          FROM "AnalyticsEvent"
          WHERE "occurredAt" >= ${from} AND "occurredAt" < ${to}
            AND "eventName" = 'VIDEO_START' AND "channelId" IS NOT NULL
            AND "deviceClass" IS NOT NULL
          GROUP BY date_trunc('day', "occurredAt"), "channelId", "deviceClass"
          UNION ALL
          SELECT date_trunc('day', "occurredAt"), "channelId", 'TRAFFIC_SOURCE', metadata->>'trafficSource', COUNT(*)::int
          FROM "AnalyticsEvent"
          WHERE "occurredAt" >= ${from} AND "occurredAt" < ${to}
            AND "eventName" = 'VIDEO_START' AND "channelId" IS NOT NULL
            AND metadata->>'trafficSource' IN ('DIRECT', 'INTERNAL', 'SEARCH', 'SOCIAL', 'EXTERNAL')
          GROUP BY date_trunc('day', "occurredAt"), "channelId", metadata->>'trafficSource'
          UNION ALL
          SELECT date_trunc('day', "occurredAt"), "channelId", 'COUNTRY', metadata->>'countryCode', COUNT(*)::int
          FROM "AnalyticsEvent"
          WHERE "occurredAt" >= ${from} AND "occurredAt" < ${to}
            AND "eventName" = 'VIDEO_START' AND "channelId" IS NOT NULL
            AND metadata->>'countryCode' ~ '^[A-Z]{2}$'
          GROUP BY date_trunc('day', "occurredAt"), "channelId", metadata->>'countryCode'
          UNION ALL
          SELECT date_trunc('day', "occurredAt"), "channelId", 'PROTOCOL', metadata->>'protocol', COUNT(*)::int
          FROM "AnalyticsEvent"
          WHERE "occurredAt" >= ${from} AND "occurredAt" < ${to}
            AND "eventName" = 'VIDEO_START' AND "channelId" IS NOT NULL
            AND metadata->>'protocol' IN ('HLS', 'MP4')
          GROUP BY date_trunc('day', "occurredAt"), "channelId", metadata->>'protocol'
        `;

        await tx.$executeRaw`
          INSERT INTO "AnalyticsPlaybackSessionDailyRollup" (
            "bucketStart", "channelId", "videoId", "sessionHash", "started", "maxPositionMs"
          )
          SELECT
            date_trunc('day', "occurredAt"),
            "channelId",
            "videoId",
            "sessionHash",
            BOOL_OR("eventName" = 'VIDEO_START'),
            MAX("positionMs") FILTER (WHERE "eventName" = 'VIDEO_PROGRESS')
          FROM "AnalyticsEvent"
          WHERE "occurredAt" >= ${from}
            AND "occurredAt" < ${to}
            AND "channelId" IS NOT NULL
            AND "videoId" IS NOT NULL
            AND "eventName" IN ('VIDEO_START', 'VIDEO_PROGRESS')
          GROUP BY date_trunc('day', "occurredAt"), "channelId", "videoId", "sessionHash"
        `;

        await tx.$executeRaw`
          INSERT INTO "AnalyticsPlatformSessionDailyRollup" ("bucketStart", "sessionHash")
          SELECT DISTINCT date_trunc('day', "occurredAt"), "sessionHash"
          FROM "AnalyticsEvent"
          WHERE "occurredAt" >= ${from}
            AND "occurredAt" < ${to}
        `;

        await tx.$executeRaw`
          INSERT INTO "AnalyticsPlatformDailyRollup" (
            "bucketStart", "uniqueSessions", "views", "starts", "watchTimeMs", "completions",
            "uploads", "tvStarts", "adEvents", "errors", "bufferEvents"
          )
          SELECT
            date_trunc('day', "occurredAt"),
            COUNT(DISTINCT "sessionHash")::int,
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_START')::int,
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_START')::int,
            COALESCE(SUM("durationDeltaMs") FILTER (WHERE "eventName" = 'VIDEO_PROGRESS'), 0)::bigint,
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_COMPLETE')::int,
            COUNT(*) FILTER (WHERE "eventName" IN ('UPLOAD_COMPLETE', 'PUBLISH'))::int,
            COUNT(*) FILTER (WHERE "eventName" = 'TV_START')::int,
            COUNT(*) FILTER (
              WHERE "eventName" IN ('AD_REQUEST', 'AD_START', 'AD_QUARTILE', 'AD_COMPLETE', 'AD_CLICK', 'AD_ERROR')
            )::int,
            COUNT(*) FILTER (WHERE "eventName" IN ('AD_ERROR', 'VIDEO_BUFFER'))::int,
            COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_BUFFER')::int
          FROM "AnalyticsEvent"
          WHERE "occurredAt" >= ${from}
            AND "occurredAt" < ${to}
          GROUP BY date_trunc('day', "occurredAt")
        `;
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
  }

  async rebuildCohorts(from: Date, to: Date): Promise<void> {
    if (from.getTime() >= to.getTime()) return;
    const identityLookbackFrom = utcFloorDay(
      new Date(to.getTime() - configuredAnalyticsRetentionDays() * DAY_MS),
    );

    await this.database.client.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `DO $task83$ BEGIN PERFORM pg_advisory_xact_lock(${ROLLUP_ADVISORY_LOCK_KEY}); END $task83$;`,
        );

        await tx.analyticsPlatformAudienceDailyRollup.deleteMany({
          where: { bucketStart: { gte: from, lt: to } },
        });
        await tx.analyticsChannelAudienceDailyRollup.deleteMany({
          where: { bucketStart: { gte: from, lt: to } },
        });
        await tx.analyticsPlatformCohortRollup.deleteMany({
          where: { cohortDate: { gte: from, lt: to } },
        });
        await tx.analyticsChannelCohortRollup.deleteMany({
          where: { cohortDate: { gte: from, lt: to } },
        });
        await tx.analyticsSubscriberCohortRollup.deleteMany({
          where: { cohortDate: { gte: from, lt: to } },
        });

        await tx.$executeRaw`
          WITH daily AS (
            SELECT
              date_trunc('day', "occurredAt") AS day,
              "profileHash",
              COUNT(DISTINCT "sessionHash") FILTER (
                WHERE "eventName" = 'VIDEO_START'
              )::int AS sessions,
              COALESCE(SUM("durationDeltaMs") FILTER (
                WHERE "eventName" = 'VIDEO_PROGRESS'
              ), 0)::bigint AS "watchTimeMs",
              COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_START')::int AS starts
            FROM "AnalyticsEvent"
            WHERE "occurredAt" >= ${identityLookbackFrom}
              AND "occurredAt" < ${to}
              AND "profileHash" IS NOT NULL
              AND "eventName" IN ('VIDEO_START', 'VIDEO_PROGRESS')
            GROUP BY date_trunc('day', "occurredAt"), "profileHash"
          ),
          active AS (
            SELECT * FROM daily WHERE starts > 0
          ),
          first_seen AS (
            SELECT "profileHash", MIN(day) AS "firstSeenDay"
            FROM active
            GROUP BY "profileHash"
          )
          INSERT INTO "AnalyticsPlatformAudienceDailyRollup" (
            "bucketStart", "activeProfiles", "newProfiles", "returningProfiles",
            "sessions", "watchTimeMs"
          )
          SELECT
            a.day,
            COUNT(*)::int,
            COUNT(*) FILTER (WHERE f."firstSeenDay" = a.day)::int,
            COUNT(*) FILTER (WHERE f."firstSeenDay" < a.day)::int,
            COALESCE(SUM(a.sessions), 0)::int,
            COALESCE(SUM(a."watchTimeMs"), 0)::bigint
          FROM active a
          JOIN first_seen f ON f."profileHash" = a."profileHash"
          WHERE a.day >= ${from} AND a.day < ${to}
          GROUP BY a.day
        `;

        await tx.$executeRaw`
          WITH daily AS (
            SELECT
              date_trunc('day', "occurredAt") AS day,
              "channelId",
              "profileHash",
              COUNT(DISTINCT "sessionHash") FILTER (
                WHERE "eventName" = 'VIDEO_START'
              )::int AS sessions,
              COALESCE(SUM("durationDeltaMs") FILTER (
                WHERE "eventName" = 'VIDEO_PROGRESS'
              ), 0)::bigint AS "watchTimeMs",
              COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_START')::int AS starts
            FROM "AnalyticsEvent"
            WHERE "occurredAt" >= ${identityLookbackFrom}
              AND "occurredAt" < ${to}
              AND "profileHash" IS NOT NULL
              AND "channelId" IS NOT NULL
              AND "eventName" IN ('VIDEO_START', 'VIDEO_PROGRESS')
            GROUP BY date_trunc('day', "occurredAt"), "channelId", "profileHash"
          ),
          active AS (
            SELECT * FROM daily WHERE starts > 0
          ),
          first_seen AS (
            SELECT "channelId", "profileHash", MIN(day) AS "firstSeenDay"
            FROM active
            GROUP BY "channelId", "profileHash"
          ),
          video_days AS (
            SELECT DISTINCT
              date_trunc('day', "occurredAt") AS day,
              "channelId",
              "profileHash",
              "videoId"
            FROM "AnalyticsEvent"
            WHERE "occurredAt" >= ${identityLookbackFrom}
              AND "occurredAt" < ${to}
              AND "eventName" = 'VIDEO_START'
              AND "profileHash" IS NOT NULL
              AND "channelId" IS NOT NULL
              AND "videoId" IS NOT NULL
          ),
          first_video AS (
            SELECT "channelId", "profileHash", "videoId", MIN(day) AS "firstVideoDay"
            FROM video_days
            GROUP BY "channelId", "profileHash", "videoId"
          ),
          content_return AS (
            SELECT
              vd.day,
              vd."channelId",
              vd."profileHash",
              BOOL_OR(fv."firstVideoDay" < vd.day) AS returned
            FROM video_days vd
            JOIN first_video fv
              ON fv."channelId" = vd."channelId"
             AND fv."profileHash" = vd."profileHash"
             AND fv."videoId" = vd."videoId"
            GROUP BY vd.day, vd."channelId", vd."profileHash"
          )
          INSERT INTO "AnalyticsChannelAudienceDailyRollup" (
            "bucketStart", "channelId", "activeProfiles", "newProfiles",
            "returningProfiles", "sessions", "watchTimeMs", "contentReturnProfiles"
          )
          SELECT
            a.day,
            a."channelId",
            COUNT(*)::int,
            COUNT(*) FILTER (WHERE f."firstSeenDay" = a.day)::int,
            COUNT(*) FILTER (WHERE f."firstSeenDay" < a.day)::int,
            COALESCE(SUM(a.sessions), 0)::int,
            COALESCE(SUM(a."watchTimeMs"), 0)::bigint,
            COUNT(*) FILTER (WHERE COALESCE(cr.returned, false))::int
          FROM active a
          JOIN first_seen f
            ON f."channelId" = a."channelId"
           AND f."profileHash" = a."profileHash"
          LEFT JOIN content_return cr
            ON cr.day = a.day
           AND cr."channelId" = a."channelId"
           AND cr."profileHash" = a."profileHash"
          WHERE a.day >= ${from} AND a.day < ${to}
          GROUP BY a.day, a."channelId"
        `;

        await tx.$executeRaw`
          WITH daily AS (
            SELECT
              date_trunc('day', "occurredAt") AS day,
              "profileHash",
              COUNT(DISTINCT "sessionHash") FILTER (
                WHERE "eventName" = 'VIDEO_START'
              )::int AS sessions,
              COALESCE(SUM("durationDeltaMs") FILTER (
                WHERE "eventName" = 'VIDEO_PROGRESS'
              ), 0)::bigint AS "watchTimeMs",
              COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_START')::int AS starts
            FROM "AnalyticsEvent"
            WHERE "occurredAt" >= ${identityLookbackFrom}
              AND "occurredAt" < ${to}
              AND "profileHash" IS NOT NULL
              AND "eventName" IN ('VIDEO_START', 'VIDEO_PROGRESS')
            GROUP BY date_trunc('day', "occurredAt"), "profileHash"
          ),
          active AS (
            SELECT * FROM daily WHERE starts > 0
          ),
          members AS (
            SELECT "profileHash", MIN(day) AS "cohortDate"
            FROM active
            GROUP BY "profileHash"
          )
          INSERT INTO "AnalyticsPlatformCohortRollup" (
            "cohortDate", "cohortSize",
            "d1Retained", "d7Retained", "d30Retained",
            "d1Sessions", "d7Sessions", "d30Sessions",
            "d1WatchTimeMs", "d7WatchTimeMs", "d30WatchTimeMs"
          )
          SELECT
            m."cohortDate",
            COUNT(*)::int AS "cohortSize",
            CASE WHEN m."cohortDate" + INTERVAL '1 day' < ${to}
              THEN COUNT(*) FILTER (WHERE a.day = m."cohortDate" + INTERVAL '1 day')::int END,
            CASE WHEN m."cohortDate" + INTERVAL '7 days' < ${to}
              THEN COUNT(*) FILTER (WHERE a.day = m."cohortDate" + INTERVAL '7 days')::int END,
            CASE WHEN m."cohortDate" + INTERVAL '30 days' < ${to}
              THEN COUNT(*) FILTER (WHERE a.day = m."cohortDate" + INTERVAL '30 days')::int END,
            CASE WHEN m."cohortDate" + INTERVAL '1 day' < ${to}
              THEN COALESCE(SUM(a.sessions) FILTER (
                WHERE a.day = m."cohortDate" + INTERVAL '1 day'
              ), 0)::int END,
            CASE WHEN m."cohortDate" + INTERVAL '7 days' < ${to}
              THEN COALESCE(SUM(a.sessions) FILTER (
                WHERE a.day = m."cohortDate" + INTERVAL '7 days'
              ), 0)::int END,
            CASE WHEN m."cohortDate" + INTERVAL '30 days' < ${to}
              THEN COALESCE(SUM(a.sessions) FILTER (
                WHERE a.day = m."cohortDate" + INTERVAL '30 days'
              ), 0)::int END,
            CASE WHEN m."cohortDate" + INTERVAL '1 day' < ${to}
              THEN COALESCE(SUM(a."watchTimeMs") FILTER (
                WHERE a.day = m."cohortDate" + INTERVAL '1 day'
              ), 0)::bigint END,
            CASE WHEN m."cohortDate" + INTERVAL '7 days' < ${to}
              THEN COALESCE(SUM(a."watchTimeMs") FILTER (
                WHERE a.day = m."cohortDate" + INTERVAL '7 days'
              ), 0)::bigint END,
            CASE WHEN m."cohortDate" + INTERVAL '30 days' < ${to}
              THEN COALESCE(SUM(a."watchTimeMs") FILTER (
                WHERE a.day = m."cohortDate" + INTERVAL '30 days'
              ), 0)::bigint END
          FROM members m
          LEFT JOIN active a
            ON a."profileHash" = m."profileHash"
           AND a.day IN (
             m."cohortDate" + INTERVAL '1 day',
             m."cohortDate" + INTERVAL '7 days',
             m."cohortDate" + INTERVAL '30 days'
           )
          WHERE m."cohortDate" >= ${from} AND m."cohortDate" < ${to}
          GROUP BY m."cohortDate"
        `;

        await tx.$executeRaw`
          WITH daily AS (
            SELECT
              date_trunc('day', "occurredAt") AS day,
              "channelId",
              "profileHash",
              COUNT(DISTINCT "sessionHash") FILTER (
                WHERE "eventName" = 'VIDEO_START'
              )::int AS sessions,
              COALESCE(SUM("durationDeltaMs") FILTER (
                WHERE "eventName" = 'VIDEO_PROGRESS'
              ), 0)::bigint AS "watchTimeMs",
              COUNT(*) FILTER (WHERE "eventName" = 'VIDEO_START')::int AS starts
            FROM "AnalyticsEvent"
            WHERE "occurredAt" >= ${identityLookbackFrom}
              AND "occurredAt" < ${to}
              AND "profileHash" IS NOT NULL
              AND "channelId" IS NOT NULL
              AND "eventName" IN ('VIDEO_START', 'VIDEO_PROGRESS')
            GROUP BY date_trunc('day', "occurredAt"), "channelId", "profileHash"
          ),
          active AS (
            SELECT * FROM daily WHERE starts > 0
          ),
          members AS (
            SELECT "channelId", "profileHash", MIN(day) AS "cohortDate"
            FROM active
            GROUP BY "channelId", "profileHash"
          ),
          video_days AS (
            SELECT DISTINCT
              date_trunc('day', "occurredAt") AS day,
              "channelId",
              "profileHash",
              "videoId"
            FROM "AnalyticsEvent"
            WHERE "occurredAt" >= ${identityLookbackFrom}
              AND "occurredAt" < ${to}
              AND "eventName" = 'VIDEO_START'
              AND "profileHash" IS NOT NULL
              AND "channelId" IS NOT NULL
              AND "videoId" IS NOT NULL
          ),
          first_video AS (
            SELECT "channelId", "profileHash", "videoId", MIN(day) AS "firstVideoDay"
            FROM video_days
            GROUP BY "channelId", "profileHash", "videoId"
          ),
          content_return AS (
            SELECT
              vd.day,
              vd."channelId",
              vd."profileHash",
              BOOL_OR(fv."firstVideoDay" < vd.day) AS returned
            FROM video_days vd
            JOIN first_video fv
              ON fv."channelId" = vd."channelId"
             AND fv."profileHash" = vd."profileHash"
             AND fv."videoId" = vd."videoId"
            GROUP BY vd.day, vd."channelId", vd."profileHash"
          )
          INSERT INTO "AnalyticsChannelCohortRollup" (
            "cohortDate", "channelId", "cohortSize",
            "d1Retained", "d7Retained", "d30Retained",
            "d1Sessions", "d7Sessions", "d30Sessions",
            "d1WatchTimeMs", "d7WatchTimeMs", "d30WatchTimeMs",
            "d1ContentReturnProfiles", "d7ContentReturnProfiles", "d30ContentReturnProfiles"
          )
          SELECT
            m."cohortDate",
            m."channelId",
            COUNT(*)::int AS "cohortSize",
            CASE WHEN m."cohortDate" + INTERVAL '1 day' < ${to}
              THEN COUNT(*) FILTER (WHERE a.day = m."cohortDate" + INTERVAL '1 day')::int END,
            CASE WHEN m."cohortDate" + INTERVAL '7 days' < ${to}
              THEN COUNT(*) FILTER (WHERE a.day = m."cohortDate" + INTERVAL '7 days')::int END,
            CASE WHEN m."cohortDate" + INTERVAL '30 days' < ${to}
              THEN COUNT(*) FILTER (WHERE a.day = m."cohortDate" + INTERVAL '30 days')::int END,
            CASE WHEN m."cohortDate" + INTERVAL '1 day' < ${to}
              THEN COALESCE(SUM(a.sessions) FILTER (
                WHERE a.day = m."cohortDate" + INTERVAL '1 day'
              ), 0)::int END,
            CASE WHEN m."cohortDate" + INTERVAL '7 days' < ${to}
              THEN COALESCE(SUM(a.sessions) FILTER (
                WHERE a.day = m."cohortDate" + INTERVAL '7 days'
              ), 0)::int END,
            CASE WHEN m."cohortDate" + INTERVAL '30 days' < ${to}
              THEN COALESCE(SUM(a.sessions) FILTER (
                WHERE a.day = m."cohortDate" + INTERVAL '30 days'
              ), 0)::int END,
            CASE WHEN m."cohortDate" + INTERVAL '1 day' < ${to}
              THEN COALESCE(SUM(a."watchTimeMs") FILTER (
                WHERE a.day = m."cohortDate" + INTERVAL '1 day'
              ), 0)::bigint END,
            CASE WHEN m."cohortDate" + INTERVAL '7 days' < ${to}
              THEN COALESCE(SUM(a."watchTimeMs") FILTER (
                WHERE a.day = m."cohortDate" + INTERVAL '7 days'
              ), 0)::bigint END,
            CASE WHEN m."cohortDate" + INTERVAL '30 days' < ${to}
              THEN COALESCE(SUM(a."watchTimeMs") FILTER (
                WHERE a.day = m."cohortDate" + INTERVAL '30 days'
              ), 0)::bigint END,
            CASE WHEN m."cohortDate" + INTERVAL '1 day' < ${to}
              THEN COUNT(*) FILTER (
                WHERE cr.day = m."cohortDate" + INTERVAL '1 day' AND cr.returned
              )::int END,
            CASE WHEN m."cohortDate" + INTERVAL '7 days' < ${to}
              THEN COUNT(*) FILTER (
                WHERE cr.day = m."cohortDate" + INTERVAL '7 days' AND cr.returned
              )::int END,
            CASE WHEN m."cohortDate" + INTERVAL '30 days' < ${to}
              THEN COUNT(*) FILTER (
                WHERE cr.day = m."cohortDate" + INTERVAL '30 days' AND cr.returned
              )::int END
          FROM members m
          LEFT JOIN active a
            ON a."channelId" = m."channelId"
           AND a."profileHash" = m."profileHash"
           AND a.day IN (
             m."cohortDate" + INTERVAL '1 day',
             m."cohortDate" + INTERVAL '7 days',
             m."cohortDate" + INTERVAL '30 days'
           )
          LEFT JOIN content_return cr
            ON cr."channelId" = m."channelId"
           AND cr."profileHash" = m."profileHash"
           AND cr.day = a.day
          WHERE m."cohortDate" >= ${from} AND m."cohortDate" < ${to}
          GROUP BY m."cohortDate", m."channelId"
        `;

        await tx.$executeRaw`
          WITH state AS (
            SELECT date_trunc('day', "subscriberTrackingStartedAt") AS "trackingDay"
            FROM "AnalyticsCohortState"
            WHERE "key" = 'PRIMARY'
          ),
          episodes AS (
            SELECT
              date_trunc('day', e."subscribedAt") AS "cohortDate",
              e."channelId",
              e."unsubscribedAt"
            FROM "AnalyticsSubscriptionEpisode" e
            CROSS JOIN state s
            WHERE e."subscribedAt" >= s."trackingDay"
          )
          INSERT INTO "AnalyticsSubscriberCohortRollup" (
            "cohortDate", "channelId", "cohortSize",
            "d1Retained", "d7Retained", "d30Retained"
          )
          SELECT
            e."cohortDate",
            e."channelId",
            COUNT(*)::int,
            CASE WHEN e."cohortDate" + INTERVAL '1 day' < ${to}
              THEN COUNT(*) FILTER (
                WHERE e."unsubscribedAt" IS NULL
                   OR e."unsubscribedAt" >= e."cohortDate" + INTERVAL '2 days'
              )::int END,
            CASE WHEN e."cohortDate" + INTERVAL '7 days' < ${to}
              THEN COUNT(*) FILTER (
                WHERE e."unsubscribedAt" IS NULL
                   OR e."unsubscribedAt" >= e."cohortDate" + INTERVAL '8 days'
              )::int END,
            CASE WHEN e."cohortDate" + INTERVAL '30 days' < ${to}
              THEN COUNT(*) FILTER (
                WHERE e."unsubscribedAt" IS NULL
                   OR e."unsubscribedAt" >= e."cohortDate" + INTERVAL '31 days'
              )::int END
          FROM episodes e
          WHERE e."cohortDate" >= ${from} AND e."cohortDate" < ${to}
          GROUP BY e."cohortDate", e."channelId"
        `;
      },
      { maxWait: 10_000, timeout: 180_000 },
    );
  }

}
