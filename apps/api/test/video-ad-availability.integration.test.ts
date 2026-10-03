import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { defaultVideoAdSettings } from "../src/ads/video-ad.service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
databaseDescribe("video ad trusted availability", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  const previousToken = process.env.AYIN_INTERNAL_EDGE_TOKEN;
  const previousTrust = process.env.AYIN_TRUST_CLOUDFLARE_REGION;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_TOKEN_SECRET = "video-ad-test-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET = "video-ad-test-upload-secret-with-more-than-32-characters";
    process.env.WEB_ORIGIN = "http://localhost:3000";
    process.env.AYIN_INTERNAL_EDGE_TOKEN = "video-ad-test-edge-token";
    process.env.AYIN_TRUST_CLOUDFLARE_REGION = "false";
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Account", "Channel", "PlatformSetting" CASCADE',
    );
    await prisma.platformSetting.create({
      data: {
        namespace: "ADVERTISING",
        key: "videoAdsV1",
        valueType: "JSON",
        value: {
          ...defaultVideoAdSettings,
          masterEnabled: true,
          externalVastTagUrl: "https://ads.example.test/vast",
        },
      },
    });
  });
  afterAll(async () => {
    if (previousToken === undefined) delete process.env.AYIN_INTERNAL_EDGE_TOKEN;
    else process.env.AYIN_INTERNAL_EDGE_TOKEN = previousToken;
    if (previousTrust === undefined) delete process.env.AYIN_TRUST_CLOUDFLARE_REGION;
    else process.env.AYIN_TRUST_CLOUDFLARE_REGION = previousTrust;
    await app.close();
    await prisma.$disconnect();
  });
  async function fixture() {
    const channel = await prisma.channel.create({
      data: { handle: `ad-${randomUUID()}`, name: "Ad policy", status: "ACTIVE" },
    });
    const video = await prisma.video.create({
      data: {
        channelId: channel.id,
        title: "Ad policy",
        slug: `ad-${randomUUID()}`,
        status: "PUBLISHED",
        visibility: "PUBLIC",
      },
    });
    return { channel, video, url: `/ads/video/decision/${video.id}` };
  }
  async function decision(url: string, headers: Record<string, string> = {}) {
    const response = await app.inject({ method: "GET", url, headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    return response.json();
  }
  const denied = { enabled: false, reason: "VIDEO_NOT_ELIGIBLE" };
  it("denies expired and force-blocked policies while preserving eligible and kill-switch behavior", async () => {
    const f = await fixture();
    expect(await decision(f.url)).toMatchObject({
      enabled: true,
      tagUrl: "https://ads.example.test/vast",
    });
    await prisma.videoPolicy.create({
      data: { videoId: f.video.id, rightsExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(await decision(f.url)).toEqual(denied);
    await prisma.videoPolicy.update({
      where: { videoId: f.video.id },
      data: { rightsExpiresAt: null },
    });
    await prisma.videoPolicyOverride.create({
      data: {
        videoId: f.video.id,
        disposition: "FORCE_BLOCK",
        reason: "Test boundary",
        actorAccountId: randomUUID(),
      },
    });
    expect(await decision(f.url)).toEqual(denied);
    await prisma.platformSetting.create({
      data: {
        namespace: "ADVERTISING",
        key: "emergencyKillSwitch",
        valueType: "BOOLEAN",
        value: true,
      },
    });
    expect(await decision(f.url)).toEqual({ enabled: false, reason: "EMERGENCY_KILL_SWITCH" });
  });
  it("accepts only authenticated edge territory and never exposes tags to a spoofed region", async () => {
    const f = await fixture();
    await prisma.videoPolicy.create({ data: { videoId: f.video.id, allowedTerritories: ["EG"] } });
    expect(await decision(f.url)).toEqual(denied);
    expect(await decision(f.url, { "x-ayin-edge-country": "EG", "cf-ipcountry": "EG" })).toEqual(
      denied,
    );
    expect(
      await decision(f.url, { "x-ayin-edge-country": "EG", "x-ayin-edge-token": "wrong" }),
    ).toEqual(denied);
    expect(
      await decision(f.url, {
        "x-ayin-edge-country": "US",
        "x-ayin-edge-token": "video-ad-test-edge-token",
      }),
    ).toEqual(denied);
    expect(
      await decision(f.url, {
        "x-ayin-edge-country": "EG",
        "x-ayin-edge-token": "video-ad-test-edge-token",
      }),
    ).toMatchObject({ enabled: true });
  });
  it("keeps hard publication/channel boundaries even when policy force-allows", async () => {
    const f = await fixture();
    await prisma.videoPolicyOverride.create({
      data: {
        videoId: f.video.id,
        disposition: "FORCE_ALLOW",
        reason: "Test boundary",
        actorAccountId: randomUUID(),
      },
    });
    await prisma.video.update({ where: { id: f.video.id }, data: { visibility: "UNLISTED" } });
    expect(await decision(f.url)).toMatchObject({ enabled: true });
    for (const visibility of ["PRIVATE", "PUBLIC"] as const) {
      await prisma.video.update({
        where: { id: f.video.id },
        data: { visibility, removedAt: visibility === "PUBLIC" ? new Date() : null },
      });
      expect(await decision(f.url)).toEqual(denied);
    }
    await prisma.video.update({ where: { id: f.video.id }, data: { removedAt: null } });
    await prisma.channel.update({ where: { id: f.channel.id }, data: { removedAt: new Date() } });
    expect(await decision(f.url)).toEqual(denied);
    await prisma.channel.update({
      where: { id: f.channel.id },
      data: { removedAt: null, status: "SUSPENDED" },
    });
    expect(await decision(f.url)).toEqual(denied);
  });
});
