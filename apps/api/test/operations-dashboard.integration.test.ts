import "reflect-metadata";

import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { enrollTestMfa } from "./mfa-test-helper.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;

function cookiePair(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) throw new Error("Expected a session cookie.");
  return value.split(";", 1)[0] ?? value;
}

function utcFloorDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0),
  );
}

databaseDescribe("Task 87 operations dashboard", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-87-test-auth-secret-with-more-than-32-characters";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    delete process.env.AYIN_SYNTHETIC_STATUS_PATH;

    moduleReference = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleReference.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Account", "AnalyticsPlatformDailyRollup", "AnalyticsPlatformSessionDailyRollup", "AnalyticsChannelDailyRollup", "AdPlacement", "EarningsLedgerEntry", "MediaProcessingWorker", "PlatformSetting" CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function register(name: string, email: string) {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name, email, password: "strong-pass-123" },
    });
    expect(response.statusCode).toBe(201);
    const cookie = cookiePair(response.headers["set-cookie"]);
    return {
      cookie: (await enrollTestMfa(app, cookie)).cookie,
      user: response.json().user,
    };
  }

  it("returns one evidence-based capacity/reliability/economics view without fabricated costs", async () => {
    const operations = await register("Task 87 Ops", "task87-ops@example.com");
    await prisma.adminRoleAssignment.create({
      data: { accountId: operations.user.account.id, role: "OPERATIONS" },
    });
    const membership = await prisma.channelMember.findFirstOrThrow({
      where: { accountId: operations.user.account.id, role: "OWNER" },
      select: { channelId: true },
    });

    const today = utcFloorDay(new Date());
    const yesterday = new Date(today.getTime() - 86_400_000);
    const video = await prisma.video.create({
      data: {
        channelId: membership.channelId,
        slug: "task-87-operations-video",
        title: "Task 87 operations fixture",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt: yesterday,
        createdAt: yesterday,
        durationMs: 3_600_000,
      },
    });
    await prisma.mediaAsset.create({
      data: {
        videoId: video.id,
        channelId: membership.channelId,
        kind: "SOURCE_VIDEO",
        status: "VALIDATED",
        r2ObjectKey: "task87/source.mp4",
        mimeType: "video/mp4",
        sizeBytes: 1000n,
        durationMs: 3_600_000,
      },
    });
    await prisma.mediaProcessingJob.create({
      data: {
        videoId: video.id,
        generation: 1,
        status: "READY",
        sourceMimeType: "video/mp4",
        sourceSizeBytes: 1000n,
        stagingKey: "task87/staging.mp4",
        outputR2ObjectKey: "task87/processed.mp4",
        outputSizeBytes: 800n,
        startedAt: new Date(yesterday.getTime() + 60_000),
        completedAt: new Date(yesterday.getTime() + 120_000),
        createdAt: yesterday,
      },
    });

    await prisma.analyticsPlatformDailyRollup.create({
      data: {
        bucketStart: yesterday,
        uniqueSessions: 3,
        views: 20,
        starts: 20,
        watchTimeMs: 7_200_000n,
        uploads: 1,
        adEvents: 5,
      },
    });
    await prisma.analyticsPlatformSessionDailyRollup.createMany({
      data: ["a", "b", "c"].map((prefix) => ({
        bucketStart: yesterday,
        sessionHash: prefix.repeat(64),
      })),
    });
    await prisma.analyticsChannelDailyRollup.create({
      data: {
        bucketStart: yesterday,
        channelId: membership.channelId,
        views: 20,
        starts: 20,
        watchTimeMs: 7_200_000n,
        mp4FallbackEvents: 2,
      },
    });

    const placement = await prisma.adPlacement.create({
      data: {
        key: "task87_pre_roll",
        name: "Task 87 pre-roll",
        inventoryFamily: "IN_PLAYER_VIDEO",
        format: "PRE_ROLL",
      },
    });
    await prisma.adEvent.createMany({
      data: ["REQUEST", "FILL", "IMPRESSION", "START", "ERROR"].map((eventType) => ({
        placementId: placement.id,
        videoId: video.id,
        eventType: eventType as "REQUEST" | "FILL" | "IMPRESSION" | "START" | "ERROR",
        occurredAt: yesterday,
      })),
    });
    await prisma.earningsLedgerEntry.create({
      data: {
        channelId: membership.channelId,
        videoId: video.id,
        type: "AD_REVENUE",
        state: "FINAL",
        grossAmount: "100.000000",
        amount: "60.000000",
        currency: "USD",
        revenueShareBps: 6000,
        occurredAt: yesterday,
        finalizedAt: yesterday,
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/operations/dashboard",
      headers: { cookie: operations.cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.product).toMatchObject({
      dauApprox: 3,
      mauApprox: 3,
      watchHours: 2,
      uploads: 1,
      activeCreators: 1,
      activeVideos: 1,
    });
    expect(body.media.processing).toMatchObject({
      terminalJobs: 1,
      readyJobs: 1,
      failedJobs: 0,
      totalDurationMs: 60_000,
    });
    expect(body.media.mp4Fallback).toMatchObject({ events: 2, starts: 20, rate: 0.1 });
    expect(body.advertising).toMatchObject({
      requests: 1,
      fills: 1,
      impressions: 1,
      starts: 1,
      technicalErrors: 1,
      qualifiedPlays: 1,
      noFill: { available: false, value: null },
    });
    expect(body.revenue.rows).toEqual([
      expect.objectContaining({
        currency: "USD",
        finalizedGross: "100.000000",
        finalizedGrossComplete: true,
        finalizedCreatorShare: "60.000000",
      }),
    ]);
    expect(body.revenue.payoutLiability).toEqual([{ currency: "USD", amount: "60.000000" }]);

    expect(body.cost).toMatchObject({
      provider: "MANUAL_SETTINGS",
      mode: "UNCONFIGURED",
      complete: false,
      totalMonthly: null,
    });
    expect(body.unitEconomics.costPerWatchHour).toBeNull();
    expect(body.unitEconomics.grossMarginEstimate.available).toBe(false);
    expect(body.evidence.productionInvoicesFetched).toBe(false);
    expect(body.evidence.replicaDataUsed).toBe(false);
    expect(body.alerts.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "BACKUP_STATUS_UNAVAILABLE" }),
        expect.objectContaining({ code: "SYNTHETIC_STATUS_EXTERNAL" }),
      ]),
    );
  });

  it("keeps the consolidated dashboard scoped to operations/finance staff", async () => {
    const finance = await register("Task 87 Finance", "task87-finance@example.com");
    const moderator = await register("Task 87 Moderator", "task87-moderator@example.com");
    await prisma.adminRoleAssignment.createMany({
      data: [
        { accountId: finance.user.account.id, role: "FINANCE_MANAGER" },
        { accountId: moderator.user.account.id, role: "CONTENT_MODERATOR" },
      ],
    });

    const financeResponse = await app.inject({
      method: "GET",
      url: "/admin/operations/dashboard",
      headers: { cookie: finance.cookie },
    });
    const moderatorResponse = await app.inject({
      method: "GET",
      url: "/admin/operations/dashboard",
      headers: { cookie: moderator.cookie },
    });
    expect(financeResponse.statusCode).toBe(200);
    expect(moderatorResponse.statusCode).toBe(403);
  });
});
