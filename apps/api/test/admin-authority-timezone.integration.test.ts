import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient, Prisma } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { lockAdminAccountWrite } from "../src/admin/admin-account-write-authority.js";
import { AuthService } from "../src/auth/auth.service.js";
import { DatabaseService } from "../src/database/database.service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const targetId = "00000000-0000-4000-8000-000000000001";

for (const timezone of ["UTC", "Africa/Cairo", "America/Los_Angeles"] as const)
  databaseDescribe(`Administrator session expiry in ${timezone}`, () => {
    const url = new URL(databaseUrl ?? "postgresql://ayin@127.0.0.1/ayin_test");
    // Scope the timezone to these test connections, never ALTER a database/server setting.
    url.searchParams.set("options", `-c timezone=${timezone}`);
    const prisma = createPrismaClient(url.toString());
    let app: NestFastifyApplication;
    beforeAll(async () => {
      process.env.APP_ENV = "test";
      process.env.AUTH_TOKEN_SECRET = "admin-authority-timezone-test-secret-more-than32";
      process.env.DATABASE_URL = databaseUrl;
      process.env.WEB_ORIGIN = "http://localhost:3000";
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(DatabaseService)
        .useValue({ client: prisma })
        .compile();
      app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      const [row] = await prisma.$queryRaw<
        Array<{ timezone: string }>
      >`SELECT current_setting('TimeZone') AS timezone`;
      expect(row?.timezone).toBe(timezone);
    });
    beforeEach(async () => {
      await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account" CASCADE');
      await prisma.adminAuditLog.deleteMany();
    });
    afterAll(async () => {
      await app.close();
      await prisma.$disconnect();
    });
    async function fixture() {
      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          name: "Actual timezone actor",
          email: `timezone-${randomUUID()}@example.com`,
          password: "strong-pass-123",
        },
      });
      expect(response.statusCode).toBe(201);
      const cookies = response.headers["set-cookie"];
      const cookie = (Array.isArray(cookies) ? cookies[0] : cookies)?.split(";", 1)[0];
      if (!cookie) throw Error("Expected actual authenticated cookie");
      const actor = await app
        .get(AuthService)
        .authenticate(decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1)));
      await prisma.adminRoleAssignment.create({
        data: { accountId: actor.accountId, role: "OPERATIONS" },
      });
      const target = await prisma.account.create({
        data: {
          id: targetId,
          email: "timezone-target@example.com",
          displayName: "Original target",
        },
      });
      return { actor, cookie, target };
    }
    function send(cookie: string) {
      return Promise.resolve(
        app.inject({
          method: "PATCH",
          url: `/admin/control/users/${targetId}`,
          headers: { cookie },
          payload: {
            displayName: "Reviewed timezone target",
            reason: "Actual timezone authority regression",
          },
        }),
      );
    }
    it("accepts a genuinely live session through the locked helper and actual HTTP path", async () => {
      const f = await fixture();
      await prisma.accountSession.update({
        where: { id: f.actor.sessionId },
        data: { expiresAt: new Date(Date.now() + 30000) },
      });
      const actor = await prisma.$transaction((tx) =>
        lockAdminAccountWrite(tx, f.actor, f.actor.accountId),
      );
      expect(actor.id).toBe(f.actor.accountId);
      expect((await send(f.cookie)).statusCode).toBe(200);
      expect(
        (await prisma.account.findUniqueOrThrow({ where: { id: targetId } })).displayName,
      ).toBe("Reviewed timezone target");
    });
    it("rejects an expired session in the locked helper and HTTP guard without target or audit changes", async () => {
      const f = await fixture();
      await prisma.accountSession.update({
        where: { id: f.actor.sessionId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await expect(
        prisma.$transaction((tx) => lockAdminAccountWrite(tx, f.actor, f.actor.accountId)),
      ).rejects.toMatchObject({ status: 401 });
      expect((await send(f.cookie)).statusCode).toBe(401);
      expect(await prisma.account.findUniqueOrThrow({ where: { id: targetId } })).toEqual(f.target);
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });
    it("rejects actual database-clock expiry after an observed HTTP account-lock wait", async () => {
      const f = await fixture();
      await prisma.accountSession.update({
        where: { id: f.actor.sessionId },
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
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "Account" WHERE "id" = ${targetId}::uuid FOR UPDATE`,
          );
          acquired();
          await gate;
        },
        { timeout: 15000 },
      );
      await locked;
      const request = send(f.cookie);
      try {
        await vi.waitFor(
          async () => {
            const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>(
              Prisma.sql`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%ayin-admin-account-write-lock%'`,
            );
            expect(Number(row?.count ?? 0)).toBeGreaterThan(0);
          },
          { timeout: 4000, interval: 25 },
        );
        await vi.waitFor(
          async () => {
            const [row] = await prisma.$queryRaw<Array<{ expired: boolean }>>(
              Prisma.sql`SELECT "expiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC') AS expired FROM "AccountSession" WHERE "id" = ${f.actor.sessionId}::uuid`,
            );
            expect(row?.expired).toBe(true);
          },
          { timeout: 3000, interval: 25 },
        );
      } finally {
        release();
      }
      await holder;
      expect((await request).statusCode).toBe(401);
      expect(await prisma.account.findUniqueOrThrow({ where: { id: targetId } })).toEqual(f.target);
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });
  });
