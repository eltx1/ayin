import { randomUUID } from "node:crypto";

import { createPrismaClient, type Prisma } from "@ayin/db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { AnalyticsRollupService } from "../src/analytics/analytics-rollup.service.js";
import { AnalyticsService } from "../src/analytics/analytics.service.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;
const DAY_MS = 86_400_000;

databaseDescribe("Task 83 privacy-aware cohort analytics", () => {
  const prisma = createPrismaClient(testDatabaseUrl);
  const database = { client: prisma };
  const rollups = new AnalyticsRollupService(database as never);
  const analytics = new AnalyticsService(database as never);

  beforeEach(async () => {
    process.env.ANALYTICS_COHORT_MIN_SIZE = "10";
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "AnalyticsSubscriberCohortRollup",
        "AnalyticsSubscriptionEpisode",
        "AnalyticsChannelCohortRollup",
        "AnalyticsPlatformCohortRollup",
        "AnalyticsChannelAudienceDailyRollup",
        "AnalyticsPlatformAudienceDailyRollup",
        "AnalyticsChannelDailyDimensionRollup",
        "AnalyticsChannelDailyRollup",
        "AnalyticsVideoDailyRollup",
        "AnalyticsPlaybackSessionDailyRollup",
        "AnalyticsPlatformSessionDailyRollup",
        "AnalyticsPlatformDailyRollup",
        "AnalyticsRollupState",
        "AnalyticsEvent",
        "Channel"
      CASCADE
    `);
  });

  afterEach(() => {
    delete process.env.ANALYTICS_COHORT_MIN_SIZE;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function fixture() {
    const channel = await prisma.channel.create({
      data: { handle: `cohort-${randomUUID().slice(0, 8)}`, name: "Cohort channel" },
    });
    const firstVideo = await prisma.video.create({
      data: {
        channelId: channel.id,
        slug: `cohort-a-${randomUUID().slice(0, 8)}`,
        title: "Cohort A",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        durationMs: 120_000,
        publishedAt: new Date(),
      },
    });
    const secondVideo = await prisma.video.create({
      data: {
        channelId: channel.id,
        slug: `cohort-b-${randomUUID().slice(0, 8)}`,
        title: "Cohort B",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        durationMs: 120_000,
        publishedAt: new Date(),
      },
    });
    return { channel, firstVideo, secondVideo };
  }

  function rawEvent(input: {
    eventName: string;
    occurredAt: Date;
    sessionHash: string;
    profileHash?: string | null;
    channelId: string;
    videoId: string;
    durationDeltaMs?: number;
  }): Prisma.AnalyticsEventCreateManyInput {
    return {
      clientEventId: randomUUID(),
      schemaVersion: 1,
      source: "WEB",
      ...input,
    };
  }

  it("uses correct UTC cohort dates and denominators for D1/D7/D30, session frequency, watch time, and content returns", async () => {
    const { channel, firstVideo, secondVideo } = await fixture();
    const cohortDay = new Date("2026-08-01T00:00:00.000Z");
    const d1 = new Date(cohortDay.getTime() + DAY_MS);
    const d7 = new Date(cohortDay.getTime() + 7 * DAY_MS);
    const d30 = new Date(cohortDay.getTime() + 30 * DAY_MS);
    const to = new Date(cohortDay.getTime() + 32 * DAY_MS);
    const events: Prisma.AnalyticsEventCreateManyInput[] = [];

    const profiles = Array.from({ length: 10 }, (_, index) =>
      index.toString(16).padStart(64, String(index % 10)),
    );

    for (let index = 0; index < profiles.length; index += 1) {
      events.push(
        rawEvent({
          eventName: "VIDEO_START",
          occurredAt: new Date(cohortDay.getTime() + (index + 1) * 1_000),
          sessionHash: `c0-${index}`.padEnd(64, "0"),
          profileHash: profiles[index],
          channelId: channel.id,
          videoId: firstVideo.id,
        }),
      );
    }

    for (let index = 0; index < 5; index += 1) {
      events.push(
        rawEvent({
          eventName: "VIDEO_START",
          occurredAt: new Date(d1.getTime() + (index + 1) * 1_000),
          sessionHash: `d1-${index}`.padEnd(64, "1"),
          profileHash: profiles[index],
          channelId: channel.id,
          videoId: index < 4 ? firstVideo.id : secondVideo.id,
        }),
        rawEvent({
          eventName: "VIDEO_PROGRESS",
          occurredAt: new Date(d1.getTime() + (index + 20) * 1_000),
          sessionHash: `d1-${index}`.padEnd(64, "1"),
          profileHash: profiles[index],
          channelId: channel.id,
          videoId: index < 4 ? firstVideo.id : secondVideo.id,
          durationDeltaMs: 1_000,
        }),
      );
    }
    events.push(
      rawEvent({
        eventName: "VIDEO_START",
        occurredAt: new Date(d1.getTime() + 40_000),
        sessionHash: "extra-session".padEnd(64, "x"),
        profileHash: profiles[0],
        channelId: channel.id,
        videoId: firstVideo.id,
      }),
    );

    for (let index = 0; index < 3; index += 1) {
      events.push(
        rawEvent({
          eventName: "VIDEO_START",
          occurredAt: new Date(d7.getTime() + (index + 1) * 1_000),
          sessionHash: `d7-${index}`.padEnd(64, "7"),
          profileHash: profiles[index],
          channelId: channel.id,
          videoId: index < 2 ? firstVideo.id : secondVideo.id,
        }),
      );
    }

    for (let index = 0; index < 2; index += 1) {
      events.push(
        rawEvent({
          eventName: "VIDEO_START",
          occurredAt: new Date(d30.getTime() + (index + 1) * 1_000),
          sessionHash: `d30-${index}`.padEnd(64, "3"),
          profileHash: profiles[index],
          channelId: channel.id,
          videoId: firstVideo.id,
        }),
      );
    }

    events.push(
      rawEvent({
        eventName: "VIDEO_START",
        occurredAt: new Date(d1.getTime() + 50_000),
        sessionHash: "anonymous-session".padEnd(64, "a"),
        profileHash: null,
        channelId: channel.id,
        videoId: firstVideo.id,
      }),
    );

    await prisma.analyticsEvent.createMany({ data: events });
    await rollups.rebuildCohorts(cohortDay, to);

    const platform = await prisma.analyticsPlatformCohortRollup.findUniqueOrThrow({
      where: { cohortDate: cohortDay },
    });
    expect(platform).toMatchObject({
      cohortSize: 10,
      d1Retained: 5,
      d7Retained: 3,
      d30Retained: 2,
      d1Sessions: 6,
    });
    expect(platform.d1WatchTimeMs).toBe(5_000n);

    const channelCohort = await prisma.analyticsChannelCohortRollup.findUniqueOrThrow({
      where: { cohortDate_channelId: { cohortDate: cohortDay, channelId: channel.id } },
    });
    expect(channelCohort).toMatchObject({
      cohortSize: 10,
      d1Retained: 5,
      d7Retained: 3,
      d30Retained: 2,
      d1Sessions: 6,
      d1ContentReturnProfiles: 4,
      d7ContentReturnProfiles: 2,
      d30ContentReturnProfiles: 2,
    });

    const firstDayAudience = await prisma.analyticsChannelAudienceDailyRollup.findUniqueOrThrow({
      where: { bucketStart_channelId: { bucketStart: cohortDay, channelId: channel.id } },
    });
    expect(firstDayAudience).toMatchObject({
      activeProfiles: 10,
      newProfiles: 10,
      returningProfiles: 0,
    });

    const d1Audience = await prisma.analyticsChannelAudienceDailyRollup.findUniqueOrThrow({
      where: { bucketStart_channelId: { bucketStart: d1, channelId: channel.id } },
    });
    expect(d1Audience).toMatchObject({
      activeProfiles: 5,
      newProfiles: 0,
      returningProfiles: 5,
      sessions: 6,
      contentReturnProfiles: 4,
    });
    expect(d1Audience.watchTimeMs).toBe(5_000n);
  });

  it("computes subscriber retention from pseudonymous subscription episodes and suppresses undersized creator cohorts", async () => {
    const { channel, firstVideo } = await fixture();
    const cohortDay = new Date("2026-08-01T00:00:00.000Z");
    const smallDay = new Date(cohortDay.getTime() + 2 * DAY_MS);
    const to = new Date(cohortDay.getTime() + 32 * DAY_MS);

    await prisma.analyticsCohortState.update({
      where: { key: "PRIMARY" },
      data: { subscriberTrackingStartedAt: cohortDay },
    });

    const episodes = Array.from({ length: 10 }, (_, index) => ({
      channelId: channel.id,
      profileHash: `subscriber-${index}`.padEnd(64, "s"),
      subscribedAt: new Date(cohortDay.getTime() + (index + 1) * 1_000),
      unsubscribedAt:
        index < 2
          ? new Date(cohortDay.getTime() + DAY_MS + 12 * 60 * 60_000)
          : index < 4
            ? new Date(cohortDay.getTime() + 5 * DAY_MS)
            : index < 6
              ? new Date(cohortDay.getTime() + 20 * DAY_MS)
              : null,
    }));
    await prisma.analyticsSubscriptionEpisode.createMany({ data: episodes });

    const baseEvents = Array.from({ length: 10 }, (_, index) =>
      rawEvent({
        eventName: "VIDEO_START",
        occurredAt: new Date(cohortDay.getTime() + (index + 1) * 1_000),
        sessionHash: `base-${index}`.padEnd(64, "b"),
        profileHash: `viewer-${index}`.padEnd(64, "v"),
        channelId: channel.id,
        videoId: firstVideo.id,
      }),
    );
    const smallEvents = Array.from({ length: 9 }, (_, index) =>
      rawEvent({
        eventName: "VIDEO_START",
        occurredAt: new Date(smallDay.getTime() + (index + 1) * 1_000),
        sessionHash: `small-${index}`.padEnd(64, "m"),
        profileHash: `small-viewer-${index}`.padEnd(64, "q"),
        channelId: channel.id,
        videoId: firstVideo.id,
      }),
    );
    await prisma.analyticsEvent.createMany({ data: [...baseEvents, ...smallEvents] });

    await rollups.rebuildCohorts(cohortDay, to);

    const subscriber = await prisma.analyticsSubscriberCohortRollup.findUniqueOrThrow({
      where: { cohortDate_channelId: { cohortDate: cohortDay, channelId: channel.id } },
    });
    expect(subscriber).toMatchObject({
      cohortSize: 10,
      d1Retained: 8,
      d7Retained: 6,
      d30Retained: 4,
    });

    const small = await prisma.analyticsChannelCohortRollup.findUniqueOrThrow({
      where: { cohortDate_channelId: { cohortDate: smallDay, channelId: channel.id } },
    });
    expect(small.cohortSize).toBe(9);

    const creator = await analytics.channelMetrics(channel.id, 90);
    expect(creator.cohorts.minimumCohortSize).toBe(10);
    expect(creator.cohorts.retention.map((row) => row.cohortSize)).toContain(10);
    expect(creator.cohorts.retention.map((row) => row.cohortSize)).not.toContain(9);
    expect(creator.cohorts.subscriberRetention[0]).toMatchObject({
      cohortSize: 10,
      d1: { retainedProfiles: 8, retentionRate: 0.8 },
      d7: { retainedProfiles: 6, retentionRate: 0.6 },
      d30: { retainedProfiles: 4, retentionRate: 0.4 },
    });
    expect(JSON.stringify(creator.cohorts)).not.toContain("profileHash");
    expect(JSON.stringify(creator.cohorts)).not.toContain("sessionHash");
  });
});
