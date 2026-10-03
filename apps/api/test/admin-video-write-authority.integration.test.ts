import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient, Prisma } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { enrollTestMfa } from "./mfa-test-helper.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
databaseDescribe("Admin video current authority, original reads and atomic bulk versions", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "admin-video-write-test-secret-longer-than32";
    process.env.DATABASE_URL = databaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account", "Channel" CASCADE');
    await prisma.adminAuditLog.deleteMany();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  async function actor(role: "ADMIN" | "FINANCE_MANAGER" | "CONTENT_MODERATOR" = "ADMIN") {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Actual video actor",
        email: `video-authority-${randomUUID()}@example.com`,
        password: "strong-pass-123",
      },
    });
    expect(response.statusCode).toBe(201);
    const id = response.json().user.account.id as string;
    const header = response.headers["set-cookie"],
      raw = (Array.isArray(header) ? header[0] : header)?.split(";", 1)[0];
    if (!raw) throw Error("Expected session");
    const { cookie } = await enrollTestMfa(app, raw);
    await prisma.adminRoleAssignment.create({ data: { accountId: id, role } });
    return { id, cookie };
  }
  async function fixture() {
    const a = await actor();
    const channel = await prisma.channel.create({
      data: { name: "Actual video owner", handle: "actual-video-owner" },
    });
    const video = await prisma.video.create({
      data: {
        channelId: channel.id,
        title: "Actual original video",
        slug: "actual-original-video",
        status: "PUBLISHED",
        updatedAt: new Date("2035-01-01T00:00:00Z"),
      },
    });
    return { ...a, video, channel };
  }
  function send(cookie: string, videoId: string, version: string, title = "Actual reviewed title") {
    return Promise.resolve(
      app.inject({
        method: "PATCH",
        url: `/admin/control/videos/${videoId}`,
        headers: { cookie, origin: "http://localhost:3000" },
        payload: {
          title,
          expectedUpdatedAt: version,
          reason: "Actual reviewed video access decision",
        },
      }),
    );
  }
  async function observed(marker: string) {
    await vi.waitFor(
      async () => {
        const rows = await prisma.$queryRaw<{ count: bigint }[]>(
          Prisma.sql`SELECT COUNT(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${"%" + marker + "%"}`,
        );
        expect(Number(rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);
      },
      { timeout: 4000, interval: 25 },
    );
  }
  for (const command of ["UPDATE", "BULK"] as const)
    for (const change of [
      "ROLE",
      "ACCOUNT",
      "AUTHVERSION",
      "SESSION",
      "MFA",
      "TARGET",
      "REAUTHTIME",
      "SESSIONEXPIRY",
    ] as const)
      it(`rejects actual ${change} winner for ${command} after an observed authority/video wait without command audit effects`, async () => {
        const f = await fixture();
        const priorAudits = await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } });
        const targetWait = ["TARGET", "REAUTHTIME", "SESSIONEXPIRY"].includes(change);
        if (change === "SESSIONEXPIRY")
          await prisma.accountSession.updateMany({
            where: { accountId: f.id, revokedAt: null },
            data: { expiresAt: new Date(Date.now() + 1500) },
          });
        let acquired!: () => void, release!: () => void;
        const locked = new Promise<void>((resolve) => {
          acquired = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const holder = prisma.$transaction(
          async (tx) => {
            if (targetWait)
              await tx.$queryRaw(
                Prisma.sql`SELECT id FROM "Video" WHERE id = ${f.video.id}::uuid FOR UPDATE`,
              );
            else
              await tx.$queryRaw(
                Prisma.sql`SELECT "accountId" FROM "AccountMfaCredential" WHERE "accountId" = ${f.id}::uuid FOR UPDATE`,
              );
            acquired();
            await gate;
            if (change === "MFA")
              await tx.accountMfaCredential.update({
                where: { accountId: f.id },
                data: { version: { increment: 1 } },
              });
            if (change === "TARGET")
              await tx.video.update({
                where: { id: f.video.id },
                data: { status: "DRAFT", updatedAt: new Date(f.video.updatedAt.getTime() + 1) },
              });
          },
          { timeout: 15000 },
        );
        await locked;
        const pending =
          command === "UPDATE"
            ? send(f.cookie, f.video.id, f.video.updatedAt.toISOString())
            : Promise.resolve(
                bulk(
                  f.cookie,
                  [f.video.id],
                  [{ id: f.video.id, updatedAt: f.video.updatedAt.toISOString() }],
                ),
              );
        try {
          await observed(
            targetWait ? "ayin-admin-video-write-lock" : "ayin-admin-account-write-lock",
          );
          if (change === "ROLE")
            await prisma.adminRoleAssignment.deleteMany({ where: { accountId: f.id } });
          if (change === "ACCOUNT")
            await prisma.account.update({ where: { id: f.id }, data: { status: "SUSPENDED" } });
          if (change === "AUTHVERSION")
            await prisma.account.update({
              where: { id: f.id },
              data: { authVersion: { increment: 1 } },
            });
          if (change === "SESSION")
            await prisma.accountSession.updateMany({
              where: { accountId: f.id },
              data: { revokedAt: new Date(), revokeReason: "CONTROLLED_VIDEO_AUTHORITY_WINNER" },
            });
          if (change === "REAUTHTIME") vi.spyOn(Date, "now").mockReturnValue(Date.now() + 301000);
          if (change === "SESSIONEXPIRY")
            await vi.waitFor(
              async () => {
                const [row] = await prisma.$queryRaw<{ expired: boolean }[]>(
                  Prisma.sql`SELECT bool_and("expiresAt" <= clock_timestamp()) AS expired FROM "AccountSession" WHERE "accountId" = ${f.id}::uuid AND "revokedAt" IS NULL`,
                );
                expect(row?.expired).toBe(true);
              },
              { timeout: 3000, interval: 25 },
            );
        } finally {
          release();
        }
        await holder;
        const response = await pending;
        vi.restoreAllMocks();
        expect(response.statusCode).toBe(
          change === "TARGET" ? 409 : change === "ROLE" || change === "REAUTHTIME" ? 403 : 401,
        );
        expect(await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } })).toEqual(
          priorAudits,
        );
        const actual = await prisma.video.findUniqueOrThrow({ where: { id: f.video.id } });
        expect(actual).toEqual(
          change === "TARGET"
            ? { ...f.video, status: "DRAFT", updatedAt: new Date(f.video.updatedAt.getTime() + 1) }
            : f.video,
        );
      });
  it("reads all26actual rows in stable25-row pages and safe direct recovery; rejects Finance, malformed IDs and unknown filters", async () => {
    const f = await fixture();
    const same = new Date("2035-01-01T00:00:00Z");
    await prisma.video.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        channelId: f.channel.id,
        title: `Actual extra ${i}`,
        slug: `actual-extra-${i}`,
        updatedAt: same,
      })),
    });
    const prior = await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } });
    const ordered = await prisma.video.findMany({
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    const get = (url: string, cookie = f.cookie) =>
      app.inject({ method: "GET", url, headers: { cookie } });
    const a = await get("/admin/control/videos?take=25&page=1");
    const b = await get("/admin/control/videos?take=25&page=2");
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json().pagination.total).toBe(26);
    expect([...a.json().items, ...b.json().items].map((r: { id: string }) => r.id)).toEqual(
      ordered.map((r) => r.id),
    );
    expect(a.headers["cache-control"]).toBe("private, no-store");
    const direct = await get(`/admin/control/videos/${f.video.id}`);
    expect(direct.statusCode).toBe(200);
    expect(Object.keys(direct.json()).sort()).toEqual(
      [
        "id",
        "slug",
        "title",
        "description",
        "status",
        "visibility",
        "videoForm",
        "commentsEnabled",
        "publishedAt",
        "updatedAt",
        "channel",
        "tvPreferences",
        "_count",
      ].sort(),
    );
    expect(direct.headers.pragma).toBe("no-cache");
    expect((await get("/admin/control/videos/not-a-uuid")).statusCode).toBe(400);
    expect((await get(`/admin/control/videos/${randomUUID()}`)).statusCode).toBe(404);
    expect((await get("/admin/control/videos?unexpected=1")).statusCode).toBe(400);
    expect(await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } })).toEqual(prior);
    const finance = await actor("FINANCE_MANAGER");
    expect((await get("/admin/control/videos", finance.cookie)).statusCode).toBe(403);
    expect((await get(`/admin/control/videos/${f.video.id}`, finance.cookie)).statusCode).toBe(403);
  });
  it("preserves Content Moderator authority, monotonic future versions and stale409 without granting account or TV authority", async () => {
    const f = await fixture(),
      mod = await actor("CONTENT_MODERATOR");
    const prior = await prisma.adminAuditLog.count();
    const response = await send(mod.cookie, f.video.id, f.video.updatedAt.toISOString());
    expect(response.statusCode).toBe(200);
    expect(response.json().updatedAt).toBe(new Date(f.video.updatedAt.getTime() + 1).toISOString());
    expect((await send(mod.cookie, f.video.id, f.video.updatedAt.toISOString())).statusCode).toBe(
      409,
    );
    expect(await prisma.adminAuditLog.count()).toBe(prior + 1);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/admin/control/users",
          headers: { cookie: mod.cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/admin/control/tv",
          headers: { cookie: mod.cookie },
        })
      ).statusCode,
    ).toBe(403);
    const missing = await send(f.cookie, randomUUID(), f.video.updatedAt.toISOString());
    expect(missing.statusCode).toBe(404);
  });
  function bulk(
    cookie: string,
    ids: string[],
    expectedVideos?: Array<{ id: string; updatedAt: string }>,
  ) {
    return app.inject({
      method: "POST",
      url: "/admin/control/videos/bulk",
      headers: { cookie, origin: "http://localhost:3000" },
      payload: {
        ids,
        action: "DISABLE_COMMENTS",
        reason: "Actual reviewed bulk decision",
        ...(expectedVideos ? { expectedVideos } : {}),
      },
    });
  }
  it("rejects an actual newer bulk target atomically, rejects incomplete/duplicate versions and commits one verified bulk audit", async () => {
    const f = await fixture();
    const second = await prisma.video.create({
      data: {
        channelId: f.channel.id,
        title: "Second actual target",
        slug: "second-target",
        updatedAt: f.video.updatedAt,
      },
    });
    const prior = await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } });
    const snapshots = [f.video, second].map((r) => ({
      id: r.id,
      updatedAt: r.updatedAt.toISOString(),
    }));
    await prisma.video.update({
      where: { id: second.id },
      data: { title: "Actual newer title", updatedAt: new Date(second.updatedAt.getTime() + 1) },
    });
    expect((await bulk(f.cookie, [f.video.id, second.id], snapshots)).statusCode).toBe(409);
    expect(await prisma.video.findUniqueOrThrow({ where: { id: f.video.id } })).toEqual(f.video);
    expect(await prisma.video.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({
      title: "Actual newer title",
      commentsEnabled: true,
    });
    expect(await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } })).toEqual(prior);
    expect((await bulk(f.cookie, [f.video.id, second.id], [snapshots[0]!])).statusCode).toBe(400);
    expect((await bulk(f.cookie, [f.video.id], [snapshots[0]!, snapshots[0]!])).statusCode).toBe(
      400,
    );
    const current = await prisma.video.findMany({ where: { id: { in: [f.video.id, second.id] } } });
    const response = await bulk(
      f.cookie,
      current.map((r) => r.id),
      current.map((r) => ({ id: r.id, updatedAt: r.updatedAt.toISOString() })),
    );
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ affected: 2, action: "DISABLE_COMMENTS" });
    const rows = await prisma.video.findMany({ where: { id: { in: current.map((r) => r.id) } } });
    expect(
      rows.every(
        (r) =>
          !r.commentsEnabled &&
          r.updatedAt.getTime() > current.find((c) => c.id === r.id)!.updatedAt.getTime(),
      ),
    ).toBe(true);
    expect(await prisma.adminAuditLog.count()).toBe(prior.length + 1);
    await prisma.video.update({
      where: { id: second.id },
      data: { status: "REMOVED", removedAt: new Date() },
    });
    const before = await prisma.video.findUniqueOrThrow({ where: { id: f.video.id } });
    expect((await bulk(f.cookie, [f.video.id, second.id])).statusCode).toBe(409);
    expect(await prisma.video.findUniqueOrThrow({ where: { id: f.video.id } })).toEqual(before);
    expect(
      (
        await send(
          f.cookie,
          second.id,
          rows.find((r) => r.id === second.id)!.updatedAt.toISOString(),
        )
      ).statusCode,
    ).toBe(409);
    expect(await prisma.adminAuditLog.count()).toBe(prior.length + 1);
  });
  it("rolls back video and TV preference changes on actual audit failure, then commits one explicit retry", async () => {
    const f = await fixture();
    const tv = await prisma.creatorTvChannel.create({
      data: { channelId: f.channel.id, name: "Actual TV target", slug: "actual-tv-target" },
    });
    await prisma.creatorTvVideoPreference.create({
      data: { tvChannelId: tv.id, videoId: f.video.id, included: true },
    });
    const prior = await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } });
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION reject_video_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('video.admin_updated','video.bulk_updated') THEN RAISE EXCEPTION 'controlled video audit failure'; END IF; RETURN NEW; END; $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER video_test_audit_failure BEFORE INSERT ON "AdminAuditLog" FOR EACH ROW EXECUTE FUNCTION reject_video_test_audit()`,
    );
    const remove = () =>
      app.inject({
        method: "PATCH",
        url: `/admin/control/videos/${f.video.id}`,
        headers: { cookie: f.cookie, origin: "http://localhost:3000" },
        payload: {
          status: "REMOVED",
          expectedUpdatedAt: f.video.updatedAt.toISOString(),
          reason: "Actual reviewed removal",
        },
      });
    try {
      expect((await remove()).statusCode).toBe(500);
      expect((await bulk(f.cookie, [f.video.id])).statusCode).toBe(500);
      expect(await prisma.video.findUniqueOrThrow({ where: { id: f.video.id } })).toEqual(f.video);
      expect(
        (
          await prisma.creatorTvVideoPreference.findUniqueOrThrow({
            where: { tvChannelId_videoId: { tvChannelId: tv.id, videoId: f.video.id } },
          })
        ).included,
      ).toBe(true);
      expect(await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } })).toEqual(prior);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS video_test_audit_failure ON "AdminAuditLog"',
      );
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS reject_video_test_audit()");
    }
    expect((await remove()).statusCode).toBe(200);
    expect(
      (
        await prisma.creatorTvVideoPreference.findUniqueOrThrow({
          where: { tvChannelId_videoId: { tvChannelId: tv.id, videoId: f.video.id } },
        })
      ).included,
    ).toBe(false);
    expect(await prisma.adminAuditLog.count()).toBe(prior.length + 1);
  });
});
