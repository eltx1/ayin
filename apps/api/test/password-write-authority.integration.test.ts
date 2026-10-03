import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { PasswordService } from "../src/auth/password.service.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
databaseDescribe(
  "Password writes retain current session authority and verified password under actual locks",
  () => {
    const prisma = createPrismaClient(databaseUrl);
    let app: NestFastifyApplication, passwords: PasswordService;
    beforeAll(async () => {
      process.env.APP_ENV = "test";
      process.env.AUTH_TOKEN_SECRET = "password-write-authority-test-secret-more-than32";
      process.env.DATABASE_URL = databaseUrl;
      process.env.WEB_ORIGIN = "http://localhost:3000";
      const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
      passwords = module.get(PasswordService);
      app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
    });
    beforeEach(async () => {
      await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account" CASCADE');
    });
    afterAll(async () => {
      await app.close();
      await prisma.$disconnect();
    });
    async function fixture() {
      const email = `password-authority-${randomUUID()}@example.com`,
        password = "strong-pass-123";
      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { name: "Actual password owner", email, password },
      });
      expect(response.statusCode).toBe(201);
      const id = response.json().user.account.id as string;
      const raw = response.headers["set-cookie"],
        cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(";", 1)[0];
      if (!cookie) throw Error("Expected actual registered session");
      const current = await prisma.accountSession.findFirstOrThrow({
        where: { accountId: id },
        select: { id: true },
      });
      await prisma.accountSession.create({
        data: {
          accountId: id,
          authVersion: 0,
          expiresAt: new Date(Date.now() + 3600000),
          deviceLabel: "Actual other session",
        },
      });
      return { id, cookie, currentId: current.id, password };
    }
    async function evidence(id: string) {
      const account = await prisma.account.findUniqueOrThrow({
        where: { id },
        select: { passwordHash: true, status: true, authVersion: true },
      });
      const sessions = await prisma.accountSession.findMany({
        where: { accountId: id },
        orderBy: { id: "asc" },
        select: {
          id: true,
          authVersion: true,
          revokedAt: true,
          revokeReason: true,
          expiresAt: true,
        },
      });
      return { account, sessions };
    }
    const command = (
      cookie: string,
      currentPassword: string,
      newPassword = "requested-new-password-456",
    ) =>
      Promise.resolve(
        app.inject({
          method: "POST",
          url: "/auth/password/change",
          headers: { cookie, origin: "http://localhost:3000" },
          payload: { currentPassword, newPassword, revokeOtherSessions: true },
        }),
      );
    async function observedWait() {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const rows = await prisma.$queryRaw<
          Array<{ waiting: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%ayin-password-account-lock%') AS waiting`;
        if (rows[0]?.waiting) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw Error("Expected actual password account-row wait");
    }
    for (const winner of [
      "STATUS",
      "AUTH_VERSION",
      "SESSION_VERSION",
      "REVOKED",
      "EXPIRED",
      "CLOCK_EXPIRY",
      "DELETED_SESSION",
      "PASSWORD",
    ] as const)
      it(
        "rejects actual held-row winner " + winner + " without password or other-session effects",
        async () => {
          const actor = await fixture();
          const expiresWhileWaiting = winner === "CLOCK_EXPIRY" ? Date.now() + 1800 : null;
          if (expiresWhileWaiting)
            await prisma.accountSession.update({
              where: { id: actor.currentId },
              data: { expiresAt: new Date(expiresWhileWaiting) },
            });
          const winnerHash =
            winner === "PASSWORD" ? await passwords.hash("actual-winning-password-789") : null;
          let release!: () => void, locked!: () => void;
          const held = new Promise<void>((resolve) => {
              locked = resolve;
            }),
            gate = new Promise<void>((resolve) => {
              release = resolve;
            });
          const blocker = prisma.$transaction(
            async (tx) => {
              await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${actor.id}::uuid FOR UPDATE`;
              locked();
              await gate;
              if (winner === "STATUS")
                await tx.account.update({ where: { id: actor.id }, data: { status: "SUSPENDED" } });
              if (winner === "AUTH_VERSION")
                await tx.account.update({
                  where: { id: actor.id },
                  data: { authVersion: { increment: 1 } },
                });
              if (winner === "SESSION_VERSION")
                await tx.accountSession.update({
                  where: { id: actor.currentId },
                  data: { authVersion: 1 },
                });
              if (winner === "REVOKED")
                await tx.accountSession.update({
                  where: { id: actor.currentId },
                  data: { revokedAt: new Date(), revokeReason: "ACTUAL_WINNER" },
                });
              if (winner === "EXPIRED")
                await tx.accountSession.update({
                  where: { id: actor.currentId },
                  data: { expiresAt: new Date(Date.now() - 1) },
                });
              if (winner === "DELETED_SESSION")
                await tx.accountSession.delete({ where: { id: actor.currentId } });
              if (winnerHash)
                await tx.account.update({
                  where: { id: actor.id },
                  data: { passwordHash: winnerHash },
                });
            },
            { timeout: 15000 },
          );
          await held;
          const pending = command(actor.cookie, actor.password);
          try {
            await observedWait();
            if (expiresWhileWaiting)
              while (Date.now() <= expiresWhileWaiting)
                await new Promise((resolve) => setTimeout(resolve, 20));
          } finally {
            release();
            await blocker;
          }
          const won = await evidence(actor.id),
            response = await pending;
          expect(response.statusCode).toBe(winner === "PASSWORD" ? 409 : 401);
          expect(await evidence(actor.id)).toEqual(won);
          expect(
            await passwords.verify(
              winner === "PASSWORD" ? "actual-winning-password-789" : actor.password,
              won.account.passwordHash!,
            ),
          ).toBe(true);
        },
      );
    it("rolls back password and all session revocations on actual database failure and retries once explicitly", async () => {
      const actor = await fixture(),
        before = await evidence(actor.id);
      await prisma.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION ayin_test_password_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."passwordHash" IS DISTINCT FROM OLD."passwordHash" THEN RAISE EXCEPTION 'controlled password failure'; END IF; RETURN NEW; END $$`,
      );
      await prisma.$executeRawUnsafe(
        'CREATE TRIGGER ayin_test_password_failure BEFORE UPDATE ON "Account" FOR EACH ROW EXECUTE FUNCTION ayin_test_password_failure()',
      );
      try {
        expect((await command(actor.cookie, actor.password)).statusCode).toBe(500);
        expect(await evidence(actor.id)).toEqual(before);
      } finally {
        await prisma.$executeRawUnsafe('DROP TRIGGER ayin_test_password_failure ON "Account"');
        await prisma.$executeRawUnsafe("DROP FUNCTION ayin_test_password_failure()");
      }
      const retry = await command(actor.cookie, actor.password);
      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toEqual({ changed: true, otherSessionsRevoked: 1 });
      const after = await evidence(actor.id);
      expect(
        await passwords.verify("requested-new-password-456", after.account.passwordHash!),
      ).toBe(true);
      expect(after.sessions.find((s) => s.id === actor.currentId)?.revokedAt).toBeNull();
      expect(
        after.sessions
          .filter((s) => s.id !== actor.currentId)
          .every((s) => s.revokeReason === "PASSWORD_CHANGED" && s.revokedAt !== null),
      ).toBe(true);
    });
    it("serializes two verified old-password requests so only one can overwrite the current password", async () => {
      const actor = await fixture();
      let release!: () => void, locked!: () => void;
      const held = new Promise<void>((resolve) => {
          locked = resolve;
        }),
        gate = new Promise<void>((resolve) => {
          release = resolve;
        });
      const blocker = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${actor.id}::uuid FOR UPDATE`;
          locked();
          await gate;
        },
        { timeout: 15000 },
      );
      await held;
      const first = command(actor.cookie, actor.password, "first-new-password-456"),
        second = command(actor.cookie, actor.password, "second-new-password-456");
      try {
        const deadline = Date.now() + 8000;
        let count = 0;
        while (Date.now() < deadline && count < 2) {
          const rows = await prisma.$queryRaw<
            Array<{ count: number }>
          >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%ayin-password-account-lock%'`;
          count = rows[0]?.count ?? 0;
          if (count < 2) await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(count).toBe(2);
      } finally {
        release();
        await blocker;
      }
      const results = await Promise.all([first, second]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const winner =
        results[0]!.statusCode === 200 ? "first-new-password-456" : "second-new-password-456";
      const after = await evidence(actor.id);
      expect(await passwords.verify(winner, after.account.passwordHash!)).toBe(true);
      expect(after.sessions.filter((s) => s.revokedAt !== null)).toHaveLength(1);
    });
  },
);
