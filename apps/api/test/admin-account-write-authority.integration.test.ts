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
databaseDescribe("Current account-write authority and target versions", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  const targetId = "00000000-0000-4000-8000-000000000001";
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "account-write-authority-test-secret-longer-than32";
    process.env.DATABASE_URL = databaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account" CASCADE');
    await prisma.adminAuditLog.deleteMany();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  async function actor() {
    const r = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Actual account-write actor",
        email: `authority-${randomUUID()}@example.com`,
        password: "strong-pass-123",
      },
    });
    expect(r.statusCode).toBe(201);
    const id = r.json().user.account.id as string;
    expect(id > targetId).toBe(true);
    const cookies = r.headers["set-cookie"];
    const original = (Array.isArray(cookies) ? cookies[0] : cookies)?.split(";", 1)[0];
    if (!original) throw Error("Expected actual session");
    const { cookie } = await enrollTestMfa(app, original);
    await prisma.adminRoleAssignment.create({ data: { accountId: id, role: "ADMIN" } });
    return { id, cookie };
  }
  async function fixture() {
    const { id, cookie } = await actor();
    const target = await prisma.account.create({
      data: {
        id: targetId,
        email: "actual-authority-target@example.com",
        displayName: "Original target",
      },
    });
    const session = await prisma.accountSession.create({
      data: {
        accountId: targetId,
        authVersion: 0,
        deviceLabel: "Actual target session",
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    return { id, cookie, target, session };
  }
  function send(cookie: string, kind: "status" | "sessions", expectedUpdatedAt?: string) {
    return Promise.resolve(
      app.inject({
        method: kind === "status" ? "PATCH" : "POST",
        url:
          kind === "status"
            ? `/admin/control/users/${targetId}`
            : `/admin/operations/accounts/${targetId}/revoke-sessions`,
        headers: { cookie, origin: "http://localhost:3000" },
        payload: {
          reason: "Actual reviewed access decision",
          ...(kind === "status" ? { status: "SUSPENDED" } : {}),
          ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        },
      }),
    );
  }
  for (const kind of ["status", "sessions"] as const)
    for (const change of [
      "ROLE",
      "ACCOUNT",
      "AUTHVERSION",
      "SESSION",
      "MFA",
      "TARGET",
      "REAUTHTIME",
    ] as const)
      it(`rejects actual ${change} winner after observed ${kind} lock wait without target/audit/session side effects`, async () => {
        const f = await fixture();
        const priorAudits = await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } });
        let acquired!: () => void, release!: () => void;
        const locked = new Promise<void>((resolve) => {
          acquired = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const holder = prisma.$transaction(
          async (tx) => {
            if (change === "MFA")
              await tx.$queryRaw(
                Prisma.sql`SELECT "accountId" FROM "AccountMfaCredential" WHERE "accountId" = ${f.id}::uuid FOR UPDATE`,
              );
            else
              await tx.$queryRaw(
                Prisma.sql`SELECT "id" FROM "Account" WHERE "id" = ${targetId}::uuid FOR UPDATE`,
              );
            acquired();
            await gate;
            if (change === "MFA")
              await tx.accountMfaCredential.update({
                where: { accountId: f.id },
                data: { version: { increment: 1 } },
              });
            if (change === "TARGET")
              await tx.account.update({
                where: { id: targetId },
                data: {
                  displayName: "Winner target",
                  updatedAt: new Date(f.target.updatedAt.getTime() + 1),
                },
              });
          },
          { timeout: 15000 },
        );
        await locked;
        const request = send(f.cookie, kind, f.target.updatedAt.toISOString());
        try {
          await vi.waitFor(
            async () => {
              const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(
                Prisma.sql`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%ayin-admin-account-write-lock%'`,
              );
              expect(Number(rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);
            },
            { timeout: 4000, interval: 25 },
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
              data: { revokedAt: new Date(), revokeReason: "CONTROLLED_AUTHORITY_WINNER" },
            });
          if (change === "REAUTHTIME") {
            const now = Date.now();
            vi.spyOn(Date, "now").mockReturnValue(now + 301000);
          }
        } finally {
          release();
        }
        await holder;
        const response = await request;
        vi.restoreAllMocks();
        expect(response.statusCode).toBe(
          change === "TARGET" ? 409 : change === "ROLE" || change === "REAUTHTIME" ? 403 : 401,
        );
        expect(await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } })).toEqual(
          priorAudits,
        );
        const target = await prisma.account.findUniqueOrThrow({ where: { id: targetId } });
        expect(target).toMatchObject({
          displayName: change === "TARGET" ? "Winner target" : "Original target",
          status: "ACTIVE",
          authVersion: 0,
        });
        expect(
          (await prisma.accountSession.findUniqueOrThrow({ where: { id: f.session.id } }))
            .revokedAt,
        ).toBeNull();
      });
  it("advances a future target version monotonically and rejects stale status/session writes without extra audits", async () => {
    const f = await fixture();
    const future = new Date("2035-01-01T00:00:00Z");
    await prisma.account.update({ where: { id: targetId }, data: { updatedAt: future } });
    const first = await send(f.cookie, "status", future.toISOString());
    expect(first.statusCode).toBe(200);
    expect(new Date(first.json().updatedAt).getTime()).toBe(future.getTime() + 1);
    for (const kind of ["status", "sessions"] as const)
      expect((await send(f.cookie, kind, future.toISOString())).statusCode).toBe(409);
    expect(await prisma.adminAuditLog.count({ where: { entityId: targetId } })).toBe(1);
    const current = await prisma.account.findUniqueOrThrow({ where: { id: targetId } });
    expect(current.authVersion).toBe(1);
    const revoked = await send(f.cookie, "sessions", current.updatedAt.toISOString());
    expect(revoked.statusCode).toBe(201);
    expect(revoked.json()).toMatchObject({ id: targetId, sessionsRevoked: true, authVersion: 2 });
    expect(revoked.json()).not.toHaveProperty("updatedAt");
    expect(
      (await prisma.account.findUniqueOrThrow({ where: { id: targetId } })).updatedAt.getTime(),
    ).toBe(future.getTime() + 2);
    expect(await prisma.adminAuditLog.count({ where: { entityId: targetId } })).toBe(2);
  });
  it("rejects CLOSED status decisions and malformed versions while allowing safe explicit session cleanup", async () => {
    const f = await fixture();
    const closed = await prisma.account.update({
      where: { id: targetId },
      data: { status: "CLOSED" },
    });
    expect((await send(f.cookie, "status", closed.updatedAt.toISOString())).statusCode).toBe(409);
    expect((await send(f.cookie, "status", "yesterday")).statusCode).toBe(400);
    expect((await send(f.cookie, "sessions", "yesterday")).statusCode).toBe(400);
    expect(await prisma.adminAuditLog.count({ where: { entityId: targetId } })).toBe(0);
    expect((await send(f.cookie, "sessions", closed.updatedAt.toISOString())).statusCode).toBe(201);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: targetId } })).status).toBe(
      "CLOSED",
    );
    expect(await prisma.adminAuditLog.count({ where: { entityId: targetId } })).toBe(1);
  });
  for (const kind of ["status", "sessions"] as const)
    it(`rolls back actual ${kind} target/version/session changes when its audit fails then explicitly retries once`, async () => {
      const f = await fixture();
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION ayin_test_reject_account_write_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityId" = '${targetId}' THEN RAISE EXCEPTION 'Controlled account audit failure'; END IF; RETURN NEW; END $$`,
      );
      await prisma.$executeRawUnsafe(
        'CREATE TRIGGER ayin_test_account_write_audit BEFORE INSERT ON "AdminAuditLog" FOR EACH ROW EXECUTE FUNCTION ayin_test_reject_account_write_audit()',
      );
      try {
        expect((await send(f.cookie, kind, f.target.updatedAt.toISOString())).statusCode).toBe(500);
        expect(await prisma.account.findUniqueOrThrow({ where: { id: targetId } })).toEqual(
          f.target,
        );
        expect(
          (await prisma.accountSession.findUniqueOrThrow({ where: { id: f.session.id } }))
            .revokedAt,
        ).toBeNull();
        expect(await prisma.adminAuditLog.count({ where: { entityId: targetId } })).toBe(0);
      } finally {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER ayin_test_account_write_audit ON "AdminAuditLog"',
        );
        await prisma.$executeRawUnsafe("DROP FUNCTION ayin_test_reject_account_write_audit()");
      }
      const response = await send(f.cookie, kind, f.target.updatedAt.toISOString());
      expect(response.statusCode).toBe(kind === "status" ? 200 : 201);
      expect(await prisma.adminAuditLog.count({ where: { entityId: targetId } })).toBe(1);
      expect(
        (await prisma.account.findUniqueOrThrow({ where: { id: targetId } })).authVersion,
      ).toBe(1);
      expect(
        (await prisma.accountSession.findUniqueOrThrow({ where: { id: f.session.id } })).revokedAt,
      ).not.toBeNull();
    });
  it("serializes two actual original-version access decisions with one commit and one conflict", async () => {
    const f = await fixture();
    let acquired!: () => void, release!: () => void;
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Account" WHERE "id" = ${targetId}::uuid FOR UPDATE`,
        );
        acquired();
        await gate;
      },
      { timeout: 15000 },
    );
    await locked;
    const first = send(f.cookie, "status", f.target.updatedAt.toISOString());
    let second: ReturnType<typeof send> | undefined;
    try {
      await vi.waitFor(
        async () => {
          const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(
            Prisma.sql`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%ayin-admin-account-write-lock%'`,
          );
          expect(Number(rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);
        },
        { timeout: 4000, interval: 25 },
      );
      second = send(f.cookie, "sessions", f.target.updatedAt.toISOString());
      await vi.waitFor(
        async () => {
          const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(
            Prisma.sql`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%pg_advisory_xact_lock(1096379721, 1398034002)%'`,
          );
          expect(Number(rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);
        },
        { timeout: 4000, interval: 25 },
      );
    } finally {
      release();
    }
    await holder;
    expect((await first).statusCode).toBe(200);
    if (!second) throw Error("Expected actual queued second request");
    expect((await second).statusCode).toBe(409);
    expect(await prisma.account.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({
      status: "SUSPENDED",
      authVersion: 1,
    });
    expect(await prisma.adminAuditLog.count({ where: { entityId: targetId } })).toBe(1);
    expect(
      (await prisma.accountSession.findUniqueOrThrow({ where: { id: f.session.id } })).revokeReason,
    ).toBe("ACCOUNT_STATUS_CHANGED");
  });
  it("commits actual reciprocal name edits without cross-account deadlock or session invalidation", async () => {
    const a = await actor(),
      b = await actor();
    const aa = await prisma.account.findUniqueOrThrow({ where: { id: a.id } });
    const bb = await prisma.account.findUniqueOrThrow({ where: { id: b.id } });
    const sessionsBefore = await prisma.accountSession.findMany({
      where: { accountId: { in: [a.id, b.id] } },
      orderBy: { id: "asc" },
    });
    const responses = await Promise.all([
      app.inject({
        method: "PATCH",
        url: `/admin/control/users/${b.id}`,
        headers: { cookie: a.cookie, origin: "http://localhost:3000" },
        payload: { displayName: "Reviewed B", expectedUpdatedAt: bb.updatedAt.toISOString() },
      }),
      app.inject({
        method: "PATCH",
        url: `/admin/control/users/${a.id}`,
        headers: { cookie: b.cookie, origin: "http://localhost:3000" },
        payload: { displayName: "Reviewed A", expectedUpdatedAt: aa.updatedAt.toISOString() },
      }),
    ]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(await prisma.account.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      displayName: "Reviewed A",
      authVersion: aa.authVersion,
    });
    expect(await prisma.account.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({
      displayName: "Reviewed B",
      authVersion: bb.authVersion,
    });
    expect(
      await prisma.accountSession.findMany({
        where: { accountId: { in: [a.id, b.id] } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(sessionsBefore);
    expect(
      await prisma.adminAuditLog.count({
        where: { action: "account.updated", entityId: { in: [a.id, b.id] } },
      }),
    ).toBe(2);
  });
});
