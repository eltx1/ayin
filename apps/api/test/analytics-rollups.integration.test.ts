import { randomUUID } from "node:crypto";

import { createPrismaClient, type Prisma } from "@ayin/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  AnalyticsRollupService,
  utcFloorDay,
  utcFloorHour,
} from "../src/analytics/analytics-rollup.service.js";
import { AnalyticsService } from "../src/analytics/analytics.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

databaseDescribe("Task 82 analytics rollup reconciliation", () => {
  const prisma = createPrismaClient(testDatabaseUrl);
  const database = { client: prisma };
  const rollups = new AnalyticsRollupService(database as never);
  const analytics = new AnalyticsService(database as never);

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "AnalyticsRollupState",
        "AnalyticsPlatformDailyRollup",
        "AnalyticsPlatformSessionDailyRollup",
        "AnalyticsPlaybackSessionDailyRollup",
        "AnalyticsChannelDailyDimensionRollup",
        "AnalyticsChannelDailyRollup",
        "AnalyticsVideoDailyRollup",
        "AnalyticsVideoHourlyRollup",
        "AnalyticsEvent",
        "AdPlacement",
        "Channel"
      CASCADE
    `);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function fixture() {
    const channel = await prisma.channel.create({
      data: { handle: `rollup-${randomUUID().slice(0, 8)}`, name: "Rollup channel" },
    });
    const video = await prisma.video.create({
      data: {
        channelId: channel.id,
        slug: `rollup-video-${randomUUID().slice(0, 8)}`,
        title: "Rollup reconciliation video",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        durationMs: 100_000,
        publishedAt: new Date(),
      },
    });
    const placement = await prisma.adPlacement.create({
      data: {
        key: `rollup-placement-${randomUUID().slice(0, 8)}`,
        name: "Rollup placement",
        inventoryFamily: "IN_PLAYER_VIDEO",
        format: "PRE_ROLL",
      },
    });
    return { channel, video, placement };
  }

  function event(
    input: Partial<Prisma.AnalyticsEventCreateManyInput> & {
      eventName: string;
      occurredAt: Date;
      sessionHash: string;
      channelId: string;
      videoId: string;
    },
  ): Prisma.AnalyticsEventCreateManyInput {
    return {
      clientEventId: randomUUID(),
      schemaVersion: 1,
      source: "WEB",
      ...input,
    };
  }

  it("matches raw truth, reruns without double counting, and revises a closed UTC window for late events", async () => {
    const { channel, video, placement } = await fixture();
    const today = utcFloorDay(new Date());
    const day = new Date(today.getTime() - 2 * DAY_MS);
    const hour = new Date(day.getTime() + 12 * HOUR_MS);
    const at = (minute: number) => new Date(hour.getTime() + minute * 60_000);
    const sessionA = "a".repeat(64);
    const sessionB = "b".repeat(64);

    const initialEvents: Prisma.AnalyticsEventCreateManyInput[] = [
      event({
        eventName: "VIDEO_START",
        occurredAt: at(1),
        sessionHash: sessionA,
        channelId: channel.id,
        videoId: video.id,
        deviceClass: "DESKTOP",
        metadata: { protocol: "HLS", trafficSource: "DIRECT", countryCode: "US" },
      }),
      event({
        eventName: "VIDEO_START",
        occurredAt: at(2),
        sessionHash: sessionB,
        channelId: channel.id,
        videoId: video.id,
        deviceClass: "MOBILE",
        metadata: { protocol: "MP4", trafficSource: "SEARCH", countryCode: "CA" },
      }),
      event({
        eventName: "VIDEO_PROGRESS",
        occurredAt: at(3),
        sessionHash: sessionA,
        channelId: channel.id,
        videoId: video.id,
        durationDeltaMs: 10_000,
        positionMs: 10_000,
      }),
      event({
        eventName: "VIDEO_PROGRESS",
        occurredAt: at(4),
        sessionHash: sessionB,
        channelId: channel.id,
        videoId: video.id,
        durationDeltaMs: 20_000,
        positionMs: 20_000,
      }),
      event({
        eventName: "VIDEO_COMPLETE",
        occurredAt: at(5),
        sessionHash: sessionA,
        channelId: channel.id,
        videoId: video.id,
      }),
      event({
        eventName: "VIDEO_STARTUP",
        occurredAt: at(6),
        sessionHash: sessionA,
        channelId: channel.id,
        videoId: video.id,
        durationDeltaMs: 1_000,
      }),
      event({
        eventName: "VIDEO_STARTUP",
        occurredAt: at(7),
        sessionHash: sessionB,
        channelId: channel.id,
        videoId: video.id,
        durationDeltaMs: 3_000,
      }),
      event({
        eventName: "VIDEO_BUFFER",
        occurredAt: at(8),
        sessionHash: sessionA,
        channelId: channel.id,
        videoId: video.id,
        durationDeltaMs: 2_000,
      }),
      event({
        eventName: "VIDEO_BUFFER",
        occurredAt: at(9),
        sessionHash: sessionB,
        channelId: channel.id,
        videoId: video.id,
      }),
      event({
        eventName: "VIDEO_HLS_FATAL",
        occurredAt: at(10),
        sessionHash: sessionA,
        channelId: channel.id,
        videoId: video.id,
      }),
      event({
        eventName: "VIDEO_FALLBACK",
        occurredAt: at(11),
        sessionHash: sessionA,
        channelId: channel.id,
        videoId: video.id,
      }),
      event({
        eventName: "VIDEO_QUALITY_SWITCH",
        occurredAt: at(12),
        sessionHash: sessionA,
        channelId: channel.id,
        videoId: video.id,
      }),
      ...["AD_REQUEST", "AD_START", "AD_COMPLETE", "AD_CLICK", "AD_ERROR"].map((eventName, index) =>
        event({
          eventName,
          occurredAt: at(13 + index),
          sessionHash: sessionA,
          channelId: channel.id,
          videoId: video.id,
        }),
      ),
      event({
        eventName: "SUBSCRIBE",
        occurredAt: at(20),
        sessionHash: sessionA,
        channelId: channel.id,
        videoId: video.id,
      }),
      event({
        eventName: "LIKE",
        occurredAt: at(21),
        sessionHash: sessionA,
        channelId: channel.id,
        videoId: video.id,
      }),
    ];

    await prisma.analyticsEvent.createMany({ data: initialEvents });
    await prisma.adEvent.createMany({
      data: [
        {
          placementId: placement.id,
          videoId: video.id,
          eventType: "REQUEST",
          occurredAt: at(18),
          createdAt: at(18),
        },
        {
          placementId: placement.id,
          videoId: video.id,
          eventType: "FILL",
          occurredAt: at(19),
          createdAt: at(19),
        },
      ],
    });
    const rawBefore = await prisma.analyticsEvent.count();

    const firstCutoff = new Date();
    await rollups.sync(firstCutoff);

    const rawViews = await prisma.analyticsEvent.count({
      where: {
        channelId: channel.id,
        videoId: video.id,
        occurredAt: { gte: day, lt: new Date(day.getTime() + DAY_MS) },
        eventName: "VIDEO_START",
      },
    });
    const rawWatch = await prisma.analyticsEvent.aggregate({
      where: {
        channelId: channel.id,
        videoId: video.id,
        occurredAt: { gte: day, lt: new Date(day.getTime() + DAY_MS) },
        eventName: "VIDEO_PROGRESS",
      },
      _sum: { durationDeltaMs: true },
    });
    const rawCompletions = await prisma.analyticsEvent.count({
      where: {
        channelId: channel.id,
        videoId: video.id,
        occurredAt: { gte: day, lt: new Date(day.getTime() + DAY_MS) },
        eventName: "VIDEO_COMPLETE",
      },
    });

    const daily = await prisma.analyticsVideoDailyRollup.findUniqueOrThrow({
      where: { bucketStart_videoId: { bucketStart: day, videoId: video.id } },
    });
    expect(daily.views).toBe(rawViews);
    expect(daily.watchTimeMs).toBe(BigInt(rawWatch._sum.durationDeltaMs ?? 0));
    expect(daily.completions).toBe(rawCompletions);
    expect(daily).toMatchObject({
      views: 2,
      starts: 2,
      completions: 1,
      startupSamples: 2,
      bufferEvents: 2,
      bufferSamples: 1,
      hlsFatalEvents: 1,
      mp4FallbackEvents: 1,
      qualitySwitchEvents: 1,
      adRequests: 1,
      adStarts: 1,
      adCompletes: 1,
      adClicks: 1,
      adErrors: 1,
    });
    expect(daily.startupDurationMs).toBe(4_000n);
    expect(daily.bufferDurationMs).toBe(2_000n);

    const hourly = await prisma.analyticsVideoHourlyRollup.findUniqueOrThrow({
      where: { bucketStart_videoId: { bucketStart: utcFloorHour(hour), videoId: video.id } },
    });
    expect(hourly.views).toBe(rawViews);
    expect(hourly.watchTimeMs).toBe(30_000n);

    const channelDaily = await prisma.analyticsChannelDailyRollup.findUniqueOrThrow({
      where: { bucketStart_channelId: { bucketStart: day, channelId: channel.id } },
    });
    expect(channelDaily).toMatchObject({
      views: 2,
      completions: 1,
      subscribeEvents: 1,
      likeEvents: 1,
      bufferEvents: 2,
      analyticsAdEvents: 5,
      analyticsAdErrors: 1,
      adRequests: 1,
      adFills: 1,
    });
    expect(channelDaily.watchTimeMs).toBe(30_000n);

    const platformDaily = await prisma.analyticsPlatformDailyRollup.findUniqueOrThrow({
      where: { bucketStart: day },
    });
    expect(platformDaily).toMatchObject({
      uniqueSessions: 2,
      views: 2,
      completions: 1,
      adEvents: 5,
      errors: 3,
      bufferEvents: 2,
    });
    expect(platformDaily.watchTimeMs).toBe(30_000n);

    const dimensions = await prisma.analyticsChannelDailyDimensionRollup.findMany({
      where: { bucketStart: day, channelId: channel.id },
      orderBy: [{ dimension: "asc" }, { value: "asc" }],
    });
    expect(dimensions.map(({ dimension, value, count }) => [dimension, value, count])).toEqual(
      expect.arrayContaining([
        ["COUNTRY", "CA", 1],
        ["COUNTRY", "US", 1],
        ["DEVICE", "DESKTOP", 1],
        ["DEVICE", "MOBILE", 1],
        ["PROTOCOL", "HLS", 1],
        ["PROTOCOL", "MP4", 1],
        ["TRAFFIC_SOURCE", "DIRECT", 1],
        ["TRAFFIC_SOURCE", "SEARCH", 1],
      ]),
    );

    expect(await prisma.analyticsEvent.count()).toBe(rawBefore);

    await rollups.rebuildVideoHourly(hour, new Date(hour.getTime() + HOUR_MS));
    await rollups.rebuildDaily(day, new Date(day.getTime() + DAY_MS));
    await rollups.rebuildVideoHourly(hour, new Date(hour.getTime() + HOUR_MS));
    await rollups.rebuildDaily(day, new Date(day.getTime() + DAY_MS));

    expect(
      await prisma.analyticsVideoDailyRollup.count({
        where: { bucketStart: day, videoId: video.id },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.analyticsVideoDailyRollup.findUniqueOrThrow({
          where: { bucketStart_videoId: { bucketStart: day, videoId: video.id } },
        })
      ).views,
    ).toBe(2);
    expect(await prisma.analyticsEvent.count()).toBe(rawBefore);

    const lateReceivedAt = new Date(firstCutoff.getTime() + 1_000);
    const sessionC = "c".repeat(64);
    await prisma.analyticsEvent.createMany({
      data: [
        event({
          eventName: "VIDEO_START",
          occurredAt: at(22),
          receivedAt: lateReceivedAt,
          sessionHash: sessionC,
          channelId: channel.id,
          videoId: video.id,
          deviceClass: "TV",
          metadata: { protocol: "HLS", trafficSource: "EXTERNAL", countryCode: "GB" },
        }),
        event({
          eventName: "VIDEO_PROGRESS",
          occurredAt: at(23),
          receivedAt: lateReceivedAt,
          sessionHash: sessionC,
          channelId: channel.id,
          videoId: video.id,
          durationDeltaMs: 5_000,
          positionMs: 5_000,
        }),
      ],
    });

    await prisma.adEvent.createMany({
      data: [
        {
          placementId: placement.id,
          videoId: video.id,
          eventType: "REQUEST",
          occurredAt: at(24),
          createdAt: lateReceivedAt,
        },
        {
          placementId: placement.id,
          videoId: video.id,
          eventType: "FILL",
          occurredAt: at(25),
          createdAt: lateReceivedAt,
        },
      ],
    });

    await rollups.sync(new Date(firstCutoff.getTime() + 2_000));

    const revised = await prisma.analyticsVideoDailyRollup.findUniqueOrThrow({
      where: { bucketStart_videoId: { bucketStart: day, videoId: video.id } },
    });
    expect(revised.views).toBe(3);
    expect(revised.watchTimeMs).toBe(35_000n);
    const revisedChannel = await prisma.analyticsChannelDailyRollup.findUniqueOrThrow({
      where: { bucketStart_channelId: { bucketStart: day, channelId: channel.id } },
    });
    expect(revisedChannel.adRequests).toBe(2);
    expect(revisedChannel.adFills).toBe(2);

    const creator = await analytics.channelMetrics(channel.id, 28);
    expect(creator).toMatchObject({
      refresh: "rollup",
      views: 3,
      uniqueViewersApprox: 3,
      watchTimeMs: 35_000,
      completionRate: 1 / 3,
    });
    expect(creator.advertising).toMatchObject({
      available: true,
      opportunities: 2,
      fills: 2,
      fillRate: 1,
    });
    expect(creator.dateRange.timezone).toBe("UTC");
    expect(creator.freshnessNote).toContain("not realtime");
    expect(creator.topVideos[0]).toMatchObject({
      videoId: video.id,
      views: 3,
    });
    expect(creator.playbackQuality.buffering).toMatchObject({
      events: 2,
      measuredDurationSamples: 1,
      totalDurationMs: 2_000,
    });
    expect(creator.playbackQuality.startup).toMatchObject({
      sampleCount: 2,
      averageMs: 2_000,
    });

    expect(await prisma.analyticsEvent.count()).toBe(rawBefore + 2);
  });

  it("rebuilds the last open UTC bucket after worker downtime even when the event predates the receipt overlap", async () => {
    const { channel, video } = await fixture();
    const currentDay = utcFloorDay(new Date());
    const historicalDay = new Date(currentDay.getTime() - 3 * DAY_MS);
    const watermark = new Date(historicalDay.getTime() + 23 * HOUR_MS + 55 * 60_000);
    const eventAt = new Date(historicalDay.getTime() + 23 * HOUR_MS + 20 * 60_000);
    const sessionHash = "e".repeat(64);

    await prisma.analyticsEvent.create({
      data: event({
        eventName: "VIDEO_START",
        occurredAt: eventAt,
        receivedAt: eventAt,
        sessionHash,
        channelId: channel.id,
        videoId: video.id,
      }),
    });
    await prisma.analyticsRollupState.create({
      data: { key: "PRIMARY", lastSuccessfulAt: watermark },
    });

    await rollups.sync(new Date(currentDay.getTime() + 12 * HOUR_MS));

    const hourly = await prisma.analyticsVideoHourlyRollup.findUniqueOrThrow({
      where: {
        bucketStart_videoId: {
          bucketStart: new Date(historicalDay.getTime() + 23 * HOUR_MS),
          videoId: video.id,
        },
      },
    });
    const daily = await prisma.analyticsVideoDailyRollup.findUniqueOrThrow({
      where: { bucketStart_videoId: { bucketStart: historicalDay, videoId: video.id } },
    });

    expect(hourly.views).toBe(1);
    expect(daily.views).toBe(1);
  });

  it("expires raw and session-level projections together while retaining anonymous aggregates", async () => {
    const { channel, video } = await fixture();
    const now = new Date();
    const oldDay = utcFloorDay(new Date(now.getTime() - 31 * DAY_MS));
    const oldEventAt = new Date(oldDay.getTime() + HOUR_MS);
    const sessionHash = "d".repeat(64);

    await prisma.analyticsEvent.create({
      data: event({
        eventName: "VIDEO_START",
        occurredAt: oldEventAt,
        receivedAt: oldEventAt,
        sessionHash,
        channelId: channel.id,
        videoId: video.id,
      }),
    });
    await rollups.rebuildDaily(oldDay, new Date(oldDay.getTime() + DAY_MS));

    expect(await prisma.analyticsEvent.count()).toBe(1);
    expect(await prisma.analyticsPlaybackSessionDailyRollup.count()).toBe(1);
    expect(await prisma.analyticsPlatformSessionDailyRollup.count()).toBe(1);
    expect(await prisma.analyticsVideoDailyRollup.count()).toBe(1);

    const cleanup = await rollups.deleteExpiredTruth(30, now);

    expect(cleanup.deleted).toBe(1);
    expect(cleanup.projectionRowsDeleted).toBe(2);
    expect(await prisma.analyticsEvent.count()).toBe(0);
    expect(await prisma.analyticsPlaybackSessionDailyRollup.count()).toBe(0);
    expect(await prisma.analyticsPlatformSessionDailyRollup.count()).toBe(0);
    expect(await prisma.analyticsVideoDailyRollup.count()).toBe(1);
  });
});
