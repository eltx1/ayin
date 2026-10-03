import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { VideoAdService, defaultVideoAdSettings } from "../src/ads/video-ad.service.js";
import { enrollTestMfa } from "./mfa-test-helper.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)("Bounded advertising override and settings facts", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "advertising-directory-secret-longer-than32";
    process.env.DATABASE_URL = databaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Account", "Channel", "VideoAdOverride" CASCADE',
    );
    await prisma.platformSetting.deleteMany({
      where: { namespace: "ADVERTISING", key: "videoAdsV1" },
    });
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  async function actor(role: "AD_MANAGER" | "FINANCE_MANAGER" = "AD_MANAGER") {
    const registered = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Actual directory operator",
        email: randomUUID() + "@example.test",
        password: "strong-pass-123",
      },
    });
    expect(registered.statusCode).toBe(201);
    const id = registered.json().user.account.id as string;
    const headers = registered.headers["set-cookie"],
      raw = (Array.isArray(headers) ? headers[0] : headers)?.split(";", 1)[0];
    if (!raw) throw Error("Expected actual session");
    const { cookie } = await enrollTestMfa(app, raw);
    await prisma.adminRoleAssignment.create({ data: { accountId: id, role } });
    return { id, cookie };
  }
  async function seed(n: number, updatedBy: string) {
    const owner = await prisma.channel.create({
      data: { name: "Actual advertisement owner", handle: "actual-ads-owner" },
    });
    const videos = Array.from({ length: n }, (_, i) => ({
      id: randomUUID(),
      channelId: owner.id,
      title: i === 0 ? "Literal % target" : `Actual ad video ${i}`,
      slug: `actual-ad-${i}`,
      status: "PUBLISHED" as const,
    }));
    await prisma.video.createMany({ data: videos });
    const rows = videos.map((v) => ({
      id: randomUUID(),
      videoId: v.id,
      enabled: false,
      midRollEverySec: 600,
      updatedBy,
      updatedAt: new Date("2035-01-01T00:00:00Z"),
    }));
    await prisma.videoAdOverride.createMany({ data: rows });
    return { owner, videos, rows };
  }
  function get(cookie: string, url: string) {
    return app.inject({ method: "GET", url, headers: { cookie } });
  }
  const keys = [
    "id",
    "channelId",
    "videoId",
    "enabled",
    "preRollEnabled",
    "midRollEnabled",
    "postRollEnabled",
    "provider",
    "vastTagUrl",
    "midRollEverySec",
    "updatedAt",
    "channel",
    "video",
  ].sort();

  it("returns actual stable 25+1 pages, minimized facts, literal search and no identity/audit changes", async () => {
    const a = await actor(),
      f = await seed(26, a.id);
    const before = {
      audits: await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } }),
      sessions: await prisma.accountSession.findMany({ orderBy: { id: "asc" } }),
    };
    const first = await get(a.cookie, "/admin/video-ads/overrides/directory"),
      second = await get(a.cookie, "/admin/video-ads/overrides/directory?page=2");
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("private, no-store");
    expect(first.headers.pragma).toBe("no-cache");
    expect(first.json().pagination).toEqual({
      page: 1,
      take: 25,
      total: 26,
      totalPages: 2,
      hasNext: true,
    });
    expect(second.json().items).toHaveLength(1);
    const ids = [...first.json().items, ...second.json().items].map((x: { id: string }) => x.id);
    expect(ids).toEqual(
      f.rows
        .map((x) => x.id)
        .sort()
        .reverse(),
    );
    expect(new Set(ids).size).toBe(26);
    for (const row of first.json().items) {
      expect(Object.keys(row).sort()).toEqual(keys);
      expect(Object.keys(row.video).sort()).toEqual(["channel", "id", "slug", "status", "title"]);
    }
    const search = await get(
      a.cookie,
      "/admin/video-ads/overrides/directory?query=%25&targetType=VIDEO",
    );
    expect(search.statusCode).toBe(200);
    expect(search.json().pagination.total).toBe(1);
    expect(search.json().items[0].video.id).toBe(f.videos[0]?.id);
    const channels = await get(a.cookie, "/admin/video-ads/overrides/directory?targetType=CHANNEL");
    expect(channels.json().pagination.total).toBe(0);
    expect(await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } })).toEqual(before.audits);
    expect(await prisma.accountSession.findMany({ orderBy: { id: "asc" } })).toEqual(
      before.sessions,
    );
  });

  it("caps the legacy adapter at 100 safe records without hiding directory totals", async () => {
    const a = await actor();
    await seed(106, a.id);
    const legacy = await get(a.cookie, "/admin/video-ads/overrides");
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json()).toHaveLength(100);
    for (const row of legacy.json()) expect(Object.keys(row).sort()).toEqual(keys);
    const directory = await get(a.cookie, "/admin/video-ads/overrides/directory?page=5");
    expect(directory.json().pagination).toEqual({
      page: 5,
      take: 25,
      total: 106,
      totalPages: 5,
      hasNext: false,
    });
    expect(directory.json().items).toHaveLength(6);
  });

  it("validates directory and record inputs and refuses Finance before private service reads", async () => {
    const a = await actor();
    for (const suffix of [
      "page=0",
      "page=1001",
      "page=1.5",
      "page=abc",
      "take=100",
      "targetType=OTHER",
      "query=" + "x".repeat(201),
      "page=1&page=2",
    ]) {
      expect(
        (await get(a.cookie, "/admin/video-ads/overrides/directory?" + suffix)).statusCode,
      ).toBe(400);
    }
    expect((await get(a.cookie, "/admin/video-ads/overrides/records/not-a-uuid")).statusCode).toBe(
      400,
    );
    const finance = await actor("FINANCE_MANAGER"),
      service = app.get(VideoAdService);
    const reads = [
      vi.spyOn(service, "overrideDirectory"),
      vi.spyOn(service, "overrideRecord"),
      vi.spyOn(service, "settingsRecord"),
    ];
    for (const path of [
      "overrides/directory",
      "overrides/records/" + randomUUID(),
      "settings/record",
    ])
      expect((await get(finance.cookie, "/admin/video-ads/" + path)).statusCode).toBe(403);
    for (const read of reads) expect(read).not.toHaveBeenCalled();
  });

  it("reports actual cascaded targets and deleted override records as 404", async () => {
    const a = await actor(),
      f = await seed(1, a.id),
      id = f.rows[0]?.id;
    if (!id) throw Error("Expected override");
    const record = await get(a.cookie, "/admin/video-ads/overrides/records/" + id);
    expect(record.statusCode).toBe(200);
    expect(record.json().video.id).toBe(f.videos[0]?.id);
    expect(Object.keys(record.json()).sort()).toEqual(keys);
    await prisma.video.deleteMany({ where: { channelId: f.owner.id } });
    expect(await prisma.videoAdOverride.findUnique({ where: { id } })).toBeNull();
    const list = await get(a.cookie, "/admin/video-ads/overrides/directory");
    expect(list.json().pagination.total).toBe(0);
    expect(list.json().items).toEqual([]);
    expect((await get(a.cookie, "/admin/video-ads/overrides/records/" + id)).statusCode).toBe(404);
  });

  it("distinguishes missing, actual stored and invalid stored settings without fabricated versions", async () => {
    const a = await actor();
    const missing = await get(a.cookie, "/admin/video-ads/settings/record");
    expect(missing.statusCode).toBe(200);
    expect(missing.json()).toEqual({
      settings: defaultVideoAdSettings,
      source: "DEFAULT",
      updatedAt: null,
    });
    const row = await prisma.platformSetting.create({
      data: {
        namespace: "ADVERTISING",
        key: "videoAdsV1",
        valueType: "JSON",
        value: defaultVideoAdSettings,
        updatedAt: new Date("2035-01-01T00:00:00Z"),
      },
    });
    const actual = await get(a.cookie, "/admin/video-ads/settings/record");
    expect(actual.json()).toEqual({
      settings: defaultVideoAdSettings,
      source: "STORED",
      updatedAt: row.updatedAt.toISOString(),
    });
    const invalid = await prisma.platformSetting.update({
      where: { id: row.id },
      data: { value: { privateInternal: "not-in-response" } },
    });
    const fallback = await get(a.cookie, "/admin/video-ads/settings/record");
    expect(fallback.json()).toEqual({
      settings: defaultVideoAdSettings,
      source: "INVALID_STORED_DEFAULT",
      updatedAt: invalid.updatedAt.toISOString(),
    });
    expect(fallback.body).not.toContain("privateInternal");
  });
});
