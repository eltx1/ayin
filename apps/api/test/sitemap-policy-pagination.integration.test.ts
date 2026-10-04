import "reflect-metadata";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
databaseDescribe("Sitemap policy counts and pagination use the same actual eligibility", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "sitemap-policy-pagination-test-secret-more-than32";
    process.env.DATABASE_URL = databaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account", "Channel" CASCADE');
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  async function fixture() {
    const registered = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Actual sitemap owner",
        email: "sitemap-owner@example.com",
        password: "strong-pass-123",
      },
    });
    expect(registered.statusCode).toBe(201);
    const accountId = registered.json().user.account.id as string,
      channelId = registered.json().user.channel.id as string;
    const ids = [...Array.from({ length: 50 }, (_, n) => id(n + 1)), id(101), id(102)];
    await prisma.video.createMany({
      data: ids.map((videoId, n) => ({
        id: videoId,
        channelId,
        slug: "sitemap-film-" + n,
        title: "Actual sitemap film " + n,
        status: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt: new Date(),
        durationMs: 90000,
      })),
    });
    await prisma.mediaAsset.createMany({
      data: ids.map((videoId) => ({
        videoId,
        channelId,
        kind: "SOURCE_VIDEO",
        status: "VALIDATED",
        mimeType: "video/mp4",
        sizeBytes: 1024n,
        r2ObjectKey: "actual-sitemap/" + videoId + ".mp4",
      })),
    });
    await prisma.videoPolicy.createMany({
      data: ids
        .slice(0, 50)
        .map((videoId) => ({ videoId, rightsExpiresAt: new Date("2000-01-01T00:00:00Z") })),
    });
    await prisma.mediaAsset.create({
      data: {
        videoId: id(101),
        channelId,
        kind: "THUMBNAIL",
        status: "VALIDATED",
        mimeType: "image/png",
        sizeBytes: 32n,
        r2ObjectKey: "actual-sitemap/eligible-thumb.png",
      },
    });
    const playlist = await prisma.playlist.create({
      data: {
        channelId,
        name: "Actual late eligible collection",
        slug: "late-eligible",
        items: {
          create: [
            { videoId: id(1), position: 0 },
            { videoId: id(101), position: 3 },
          ],
        },
      },
    });
    return { accountId, channelId, playlistId: playlist.id };
  }
  const get = (path: string) => app.inject({ method: "GET", url: "/public/seo/" + path });
  it("counts only eligible videos and selects actual full pages after fifty unavailable rows", async () => {
    await fixture();
    const counts = await get("sitemap-counts");
    expect(counts.statusCode).toBe(200);
    expect(counts.json()).toEqual({ videos: 2, channels: 1, playlists: 1 });
    expect(counts.headers["cache-control"]).toContain("no-store");
    const first = await get("sitemap/videos?offset=0&limit=1"),
      second = await get("sitemap/videos?offset=1&limit=1"),
      empty = await get("sitemap/videos?offset=2&limit=1");
    expect(first.json().items.map((r: { id: string }) => r.id)).toEqual([id(101)]);
    expect(second.json().items.map((r: { id: string }) => r.id)).toEqual([id(102)]);
    expect(empty.json().items).toEqual([]);
    expect(Object.keys(first.json().items[0]).sort()).toEqual(
      [
        "id",
        "slug",
        "title",
        "description",
        "durationMs",
        "publishedAt",
        "updatedAt",
        "channel",
        "thumbnailObjectKey",
        "sourceObjectKey",
      ].sort(),
    );
    expect(first.json().items[0].thumbnailObjectKey).toBe("actual-sitemap/eligible-thumb.png");
    expect(first.headers["cache-control"]).toContain("no-store");
  });
  it("uses the first actually eligible playlist lead and removes collections only when none remain", async () => {
    const data = await fixture();
    const feed = await get("sitemap/playlists?limit=1");
    expect(feed.json().items).toHaveLength(1);
    expect(feed.json().items[0]).toMatchObject({
      id: data.playlistId,
      imageObjectKey: "actual-sitemap/eligible-thumb.png",
    });
    await prisma.videoPolicy.create({ data: { videoId: id(101), allowedTerritories: ["DE"] } });
    expect((await get("sitemap/playlists")).json().items).toEqual([]);
    expect((await get("sitemap-counts")).json()).toEqual({ videos: 1, channels: 1, playlists: 0 });
    const spoofed = await app.inject({
      method: "GET",
      url: "/public/seo/sitemap/videos",
      headers: { "cf-ipcountry": "DE", "x-ayin-country": "DE" },
    });
    expect(spoofed.json().items.map((r: { id: string }) => r.id)).toEqual([id(102)]);
  });
  it("never lets force-allow bypass private, removed or inactive-owner publication boundaries", async () => {
    const data = await fixture();
    await prisma.video.update({ where: { id: id(101) }, data: { visibility: "PRIVATE" } });
    await prisma.video.update({ where: { id: id(102) }, data: { removedAt: new Date() } });
    await prisma.videoPolicyOverride.createMany({
      data: [id(101), id(102)].map((videoId) => ({
        videoId,
        actorAccountId: data.accountId,
        disposition: "FORCE_ALLOW",
        reason: "Actual distribution override cannot restore publication",
      })),
    });
    expect((await get("sitemap-counts")).json()).toEqual({ videos: 0, channels: 1, playlists: 0 });
    expect((await get("sitemap/videos")).json().items).toEqual([]);
    await prisma.channel.update({ where: { id: data.channelId }, data: { status: "SUSPENDED" } });
    expect((await get("sitemap-counts")).json()).toEqual({ videos: 0, channels: 0, playlists: 0 });
    expect((await get("sitemap/channels")).json().items).toEqual([]);
  });
  it("selects bounded safe channel images deterministically and has no identity or audit effects", async () => {
    const data = await fixture(),
      sessions = await prisma.accountSession.findMany({
        where: { accountId: data.accountId },
        orderBy: { id: "asc" },
      }),
      audits = await prisma.adminAuditLog.count();
    await prisma.mediaAsset.createMany({
      data: [
        {
          id: id(201),
          channelId: data.channelId,
          kind: "CHANNEL_AVATAR",
          status: "VALIDATED",
          mimeType: "image/png",
          sizeBytes: 32n,
          r2ObjectKey: "actual-sitemap/avatar.png",
        },
        {
          id: id(202),
          channelId: data.channelId,
          kind: "CHANNEL_BANNER",
          status: "VALIDATED",
          mimeType: "image/png",
          sizeBytes: 32n,
          r2ObjectKey: "actual-sitemap/banner.png",
        },
      ],
    });
    const channels = await get("sitemap/channels?limit=1");
    expect(channels.json().items).toHaveLength(1);
    expect(Object.keys(channels.json().items[0]).sort()).toEqual(
      ["id", "handle", "name", "description", "updatedAt", "imageObjectKey"].sort(),
    );
    expect(channels.json().items[0].imageObjectKey).toBe("actual-sitemap/banner.png");
    for (const path of ["sitemap/videos", "sitemap/playlists", "sitemap-counts"])
      expect((await get(path)).statusCode).toBe(200);
    expect(
      await prisma.accountSession.findMany({
        where: { accountId: data.accountId },
        orderBy: { id: "asc" },
      }),
    ).toEqual(sessions);
    expect(await prisma.adminAuditLog.count()).toBe(audits);
  });
  it("rejects malformed pagination and does not reuse warmed data after actual policy changes", async () => {
    await fixture();
    expect((await get("sitemap/videos")).json().items).toHaveLength(2);
    for (const query of ["limit=0", "offset=-1", "offset=0&offset=0", "limit=5001", "unknown=1"])
      expect((await get("sitemap/videos?" + query)).statusCode).toBe(400);
    await prisma.videoPolicy.createMany({
      data: [id(101), id(102)].map((videoId) => ({
        videoId,
        rightsExpiresAt: new Date("2000-01-01T00:00:00Z"),
      })),
    });
    expect((await get("sitemap/videos")).json().items).toEqual([]);
    expect((await get("sitemap-counts")).json()).toEqual({ videos: 0, channels: 1, playlists: 0 });
  });
});
