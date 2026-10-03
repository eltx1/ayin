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
databaseDescribe("Admin Creator TV current authority, safe reads and target versions", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "admin-tv-write-test-secret-longer-than32";
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
  async function actor(role: "ADMIN" | "FINANCE_MANAGER" = "ADMIN") {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Actual TV actor",
        email: `tv-authority-${randomUUID()}@example.com`,
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
      data: { name: "Actual TV owner", handle: "actual-tv-owner" },
    });
    const tv = await prisma.creatorTvChannel.create({
      data: { channelId: channel.id, name: "Actual original TV", slug: "actual-original-tv" },
    });
    return { ...a, tv, channel };
  }
  function send(
    cookie: string,
    tvId: string,
    version: string,
    status: "ACTIVE" | "OFF_AIR" | "DISABLED" = "DISABLED",
  ) {
    return Promise.resolve(
      app.inject({
        method: "PATCH",
        url: `/admin/control/tv/${tvId}`,
        headers: { cookie, origin: "http://localhost:3000" },
        payload: {
          status,
          expectedUpdatedAt: version,
          reason: "Actual reviewed TV access decision",
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
    it(`rejects actual ${change} winner after an observed authority/TV wait without command audit effects`, async () => {
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
              Prisma.sql`SELECT id FROM "CreatorTvChannel" WHERE id = ${f.tv.id}::uuid FOR UPDATE`,
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
            await tx.creatorTvChannel.update({
              where: { id: f.tv.id },
              data: { status: "OFF_AIR", updatedAt: new Date(f.tv.updatedAt.getTime() + 1) },
            });
        },
        { timeout: 15000 },
      );
      await locked;
      const pending = send(f.cookie, f.tv.id, f.tv.updatedAt.toISOString());
      try {
        await observed(targetWait ? "ayin-admin-tv-write-lock" : "ayin-admin-account-write-lock");
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
            data: { revokedAt: new Date(), revokeReason: "CONTROLLED_TV_AUTHORITY_WINNER" },
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
      expect(await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } })).toEqual(priorAudits);
      const actual = await prisma.creatorTvChannel.findUniqueOrThrow({ where: { id: f.tv.id } });
      expect(actual).toEqual(
        change === "TARGET"
          ? { ...f.tv, status: "OFF_AIR", updatedAt: new Date(f.tv.updatedAt.getTime() + 1) }
          : f.tv,
      );
    });
  it("uses safe stable 25-row read pages and direct original-TV recovery without granting Finance or exposing account credentials", async () => {
    const f = await fixture(),
      finance = await actor("FINANCE_MANAGER");
    const ids = Array.from({ length: 26 }, () => randomUUID())
      .sort()
      .reverse();
    await prisma.creatorTvChannel.createMany({
      data: ids.map((id, n) => ({
        id,
        channelId: f.channel.id,
        name: "bounded-tv-" + n,
        slug: "bounded-tv-" + n,
        updatedAt: new Date("2030-01-01T00:00:00Z"),
      })),
    });
    const audit = await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } });
    for (const page of [1, 2]) {
      const r = await app.inject({
        url: `/admin/control/tv?query=bounded-tv-&take=25&page=${page}`,
        headers: { cookie: f.cookie },
      });
      expect(r.statusCode).toBe(200);
      expect(r.headers["cache-control"]).toBe("private, no-store");
      expect(r.headers.pragma).toBe("no-cache");
      expect(r.json().items.map((tv: { id: string }) => tv.id)).toEqual(
        page === 1 ? ids.slice(0, 25) : ids.slice(25),
      );
      expect(r.json().pagination).toMatchObject({ total: 26, pages: 2 });
    }
    const direct = await app.inject({
      url: `/admin/control/tv/${ids[0]}`,
      headers: { cookie: f.cookie },
    });
    expect(direct.statusCode).toBe(200);
    expect(direct.json()).toMatchObject({ id: ids[0], channel: { id: f.channel.id } });
    expect(Object.keys(direct.json()).sort()).toEqual(
      [
        "id",
        "slug",
        "name",
        "status",
        "disabledAt",
        "updatedAt",
        "channel",
        "scheduleItems",
      ].sort(),
    );
    expect(
      (
        await app.inject({
          url: `/admin/control/tv/${ids[0]}`,
          headers: { cookie: finance.cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: "/admin/control/tv/not-uuid", headers: { cookie: f.cookie } }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          url: `/admin/control/tv/${randomUUID()}`,
          headers: { cookie: f.cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: "/admin/control/tv?unknown=value", headers: { cookie: f.cookie } }))
        .statusCode,
    ).toBe(400);
    expect(await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } })).toEqual(audit);
  });
  it("advances future TV versions and rejects stale/malformed decisions without inventing a full record acknowledgment", async () => {
    const f = await fixture();
    const future = new Date("2035-01-01T00:00:00Z");
    await prisma.creatorTvChannel.update({ where: { id: f.tv.id }, data: { updatedAt: future } });
    const first = await send(f.cookie, f.tv.id, future.toISOString());
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ id: f.tv.id, status: "DISABLED" });
    expect(new Date(first.json().updatedAt).getTime()).toBe(future.getTime() + 1);
    expect(first.json()).not.toHaveProperty("channel");
    expect(first.json()).not.toHaveProperty("scheduleItems");
    expect((await send(f.cookie, f.tv.id, future.toISOString(), "ACTIVE")).statusCode).toBe(409);
    expect((await send(f.cookie, f.tv.id, "yesterday")).statusCode).toBe(400);
    const second = await send(f.cookie, f.tv.id, first.json().updatedAt, "OFF_AIR");
    expect(second.statusCode).toBe(200);
    expect(second.json().disabledAt).toBeNull();
    expect(new Date(second.json().updatedAt).getTime()).toBe(future.getTime() + 2);
    expect(await prisma.adminAuditLog.count({ where: { entityId: f.tv.id } })).toBe(2);
  });
  it("rolls back TV status/version/disabledAt on actual audit insertion failure before one explicit retry", async () => {
    const f = await fixture();
    const audits = await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } });
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ayin_test_reject_tv_status_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityId" = '${f.tv.id}' THEN RAISE EXCEPTION 'Controlled TV status audit failure'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER ayin_test_tv_status_audit_trigger BEFORE INSERT ON "AdminAuditLog" FOR EACH ROW EXECUTE FUNCTION ayin_test_reject_tv_status_audit()',
    );
    try {
      expect((await send(f.cookie, f.tv.id, f.tv.updatedAt.toISOString())).statusCode).toBe(500);
      expect(await prisma.creatorTvChannel.findUniqueOrThrow({ where: { id: f.tv.id } })).toEqual(
        f.tv,
      );
      expect(await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } })).toEqual(audits);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS ayin_test_tv_status_audit_trigger ON "AdminAuditLog"',
      );
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS ayin_test_reject_tv_status_audit()");
    }
    expect((await send(f.cookie, f.tv.id, f.tv.updatedAt.toISOString())).statusCode).toBe(200);
    expect(await prisma.adminAuditLog.count({ where: { entityId: f.tv.id } })).toBe(1);
  });
});
