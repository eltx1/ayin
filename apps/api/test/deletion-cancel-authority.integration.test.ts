import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { PrivacyLifecycleService } from "../src/privacy/privacy-lifecycle.service.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
databaseDescribe(
  "Deletion cancellation retains captured session authority with account-before-request locking",
  () => {
    const prisma = createPrismaClient(databaseUrl);
    let app: NestFastifyApplication, lifecycle: PrivacyLifecycleService;
    beforeAll(async () => {
      process.env.APP_ENV = "test";
      process.env.AUTH_TOKEN_SECRET = "deletion-cancel-authority-secret-more-than32";
      process.env.DATABASE_URL = databaseUrl;
      process.env.WEB_ORIGIN = "http://localhost:3000";
      const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
      lifecycle = module.get(PrivacyLifecycleService);
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
      const email = `deletion-authority-${randomUUID()}@example.com`,
        password = "strong-pass-123";
      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { name: "Actual deletion owner", email, password },
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
      const deletion = await app.inject({
        method: "POST",
        url: "/privacy/deletion",
        headers: { cookie, origin: "http://localhost:3000" },
        payload: { password, confirmation: "DELETE MY AYIN ACCOUNT" },
      });
      expect(deletion.statusCode).toBe(202);
      return {
        id,
        cookie,
        currentId: current.id,
        password,
        requestId: deletion.json().id as string,
      };
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
      const requests = await prisma.accountDeletionRequest.findMany({ orderBy: { id: "asc" } });
      const audits = await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } });
      return { account, sessions, requests, audits };
    }
    const command = (cookie: string) =>
      Promise.resolve(
        app.inject({
          method: "POST",
          url: "/privacy/deletion/cancel",
          headers: { cookie, origin: "http://localhost:3000" },
        }),
      );
    async function observedWait() {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const rows = await prisma.$queryRaw<
          Array<{ waiting: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%ayin-deletion-cancel-account-lock%') AS waiting`;
        if (rows[0]?.waiting) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw Error("Expected actual cancellation account-row wait");
    }
    for (const winner of [
      "STATUS",
      "AUTH_VERSION",
      "SESSION_VERSION",
      "REVOKED",
      "EXPIRED",
      "CLOCK_EXPIRY",
      "DELETED_SESSION",
    ] as const)
      it(
        "rejects actual held-row winner " + winner + " without deletion or other-session effects",
        async () => {
          const actor = await fixture();
          const expiresWhileWaiting = winner === "CLOCK_EXPIRY" ? Date.now() + 1800 : null;
          if (expiresWhileWaiting)
            await prisma.accountSession.update({
              where: { id: actor.currentId },
              data: { expiresAt: new Date(expiresWhileWaiting) },
            });
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
            },
            { timeout: 15000 },
          );
          await held;
          const pending = command(actor.cookie);
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
          expect(response.statusCode).toBe(401);
          expect(await evidence(actor.id)).toEqual(won);
        },
      );

    it("actual audit failure rolls back cancellation and explicit retry commits exactly once", async () => {
      const actor = await fixture(),
        before = await evidence(actor.id);
      await prisma.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION ayin_test_deletion_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'privacy.deletion_cancelled' THEN RAISE EXCEPTION 'controlled deletion audit failure'; END IF; RETURN NEW; END $$`,
      );
      await prisma.$executeRawUnsafe(
        'CREATE TRIGGER ayin_test_deletion_audit_failure BEFORE INSERT ON "AdminAuditLog" FOR EACH ROW EXECUTE FUNCTION ayin_test_deletion_audit_failure()',
      );
      try {
        expect((await command(actor.cookie)).statusCode).toBe(500);
        expect(await evidence(actor.id)).toEqual(before);
      } finally {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER ayin_test_deletion_audit_failure ON "AdminAuditLog"',
        );
        await prisma.$executeRawUnsafe("DROP FUNCTION ayin_test_deletion_audit_failure()");
      }
      const response = await command(actor.cookie);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ cancelled: true });
      expect(
        (await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: actor.requestId } }))
          .state,
      ).toBe("CANCELLED");
      expect(await prisma.accountDeletionRequest.count({ where: { accountId: actor.id } })).toBe(1);
      expect(
        await prisma.adminAuditLog.count({
          where: { actorAccountId: actor.id, action: "privacy.deletion_cancelled" },
        }),
      ).toBe(1);
      expect((await evidence(actor.id)).sessions).toEqual(before.sessions);
    });
    it("two actual cancellations serialize and produce only one cancellation audit", async () => {
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
      const first = command(actor.cookie),
        second = command(actor.cookie);
      try {
        const deadline = Date.now() + 8000;
        let count = 0;
        while (Date.now() < deadline && count < 2) {
          const rows = await prisma.$queryRaw<
            Array<{ count: number }>
          >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%ayin-deletion-cancel-account-lock%'`;
          count = rows[0]?.count ?? 0;
          if (count < 2) await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(count).toBe(2);
      } finally {
        release();
        await blocker;
      }
      expect((await Promise.all([first, second])).map((r) => r.statusCode).sort()).toEqual([
        200, 409,
      ]);
      expect(await prisma.accountDeletionRequest.count({ where: { accountId: actor.id } })).toBe(1);
      expect(
        await prisma.adminAuditLog.count({
          where: { actorAccountId: actor.id, action: "privacy.deletion_cancelled" },
        }),
      ).toBe(1);
    });

    it("request-state winner prevents cancellation and leaves its audit unchanged", async () => {
      const actor = await fixture();
      let release!: () => void, locked!: () => void;
      const held = new Promise<void>((r) => {
          locked = r;
        }),
        gate = new Promise<void>((r) => {
          release = r;
        });
      const blocker = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${actor.id}::uuid FOR UPDATE`;
          locked();
          await gate;
          await tx.accountDeletionRequest.update({
            where: { id: actor.requestId },
            data: { state: "CANCELLED", cancelledAt: new Date() },
          });
        },
        { timeout: 15000 },
      );
      await held;
      const pending = command(actor.cookie);
      try {
        await observedWait();
      } finally {
        release();
        await blocker;
      }
      const won = await evidence(actor.id);
      expect((await pending).statusCode).toBe(409);
      expect(await evidence(actor.id)).toEqual(won);
    });
    it("actual expiry while waiting on the request row prevents cancellation after that wait", async () => {
      const actor = await fixture(),
        expiry = Date.now() + 1800;
      await prisma.accountSession.update({
        where: { id: actor.currentId },
        data: { expiresAt: new Date(expiry) },
      });
      let release!: () => void, locked!: () => void;
      const held = new Promise<void>((r) => {
          locked = r;
        }),
        gate = new Promise<void>((r) => {
          release = r;
        });
      const blocker = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "AccountDeletionRequest" WHERE id=${actor.requestId}::uuid FOR UPDATE`;
          locked();
          await gate;
        },
        { timeout: 15000 },
      );
      await held;
      const before = await evidence(actor.id),
        pending = command(actor.cookie);
      try {
        const deadline = Date.now() + 8000;
        let waiting = false;
        while (Date.now() < deadline) {
          const rows = await prisma.$queryRaw<
            Array<{ waiting: boolean }>
          >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%ayin-deletion-cancel-request-lock%') AS waiting`;
          if (rows[0]?.waiting) {
            waiting = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 20));
        }
        expect(waiting).toBe(true);
        while (Date.now() <= expiry) await new Promise((r) => setTimeout(r, 20));
      } finally {
        release();
        await blocker;
      }
      expect((await pending).statusCode).toBe(401);
      expect(await evidence(actor.id)).toEqual(before);
    });
    for (const winner of ["CANCEL", "WORKER"] as const)
      it(
        "actual deactivation and cancellation use compatible lock order; winner " + winner,
        async () => {
          const actor = await fixture();
          await prisma.accountDeletionRequest.update({
            where: { id: actor.requestId },
            data: { state: "GRACE_PERIOD", graceEndsAt: new Date(Date.now() - 1000) },
          });
          let release!: () => void, locked!: () => void;
          const held = new Promise<void>((r) => {
              locked = r;
            }),
            gate = new Promise<void>((r) => {
              release = r;
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
          let cancellation: ReturnType<typeof command> | undefined,
            worker: Promise<number> | undefined;
          try {
            if (winner === "CANCEL") {
              cancellation = command(actor.cookie);
              await observedWait();
            }
            worker = lifecycle.advanceDue(new Date(), 1);
            const deadline = Date.now() + 8000;
            let waiting = false;
            while (Date.now() < deadline) {
              const rows = await prisma.$queryRaw<
                Array<{ waiting: boolean }>
              >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%ayin-deletion-deactivate-account-lock%') AS waiting`;
              if (rows[0]?.waiting) {
                waiting = true;
                break;
              }
              await new Promise((r) => setTimeout(r, 20));
            }
            expect(waiting).toBe(true);
            if (winner === "WORKER") {
              cancellation = command(actor.cookie);
              await observedWait();
            }
          } finally {
            release();
            await blocker;
          }
          expect(await worker).toBe(1);
          expect((await cancellation!).statusCode).toBe(winner === "CANCEL" ? 200 : 401);
          const state = await evidence(actor.id);
          expect(state.requests[0]?.state).toBe(winner === "CANCEL" ? "CANCELLED" : "DEACTIVATED");
          expect(state.account.status).toBe(winner === "CANCEL" ? "ACTIVE" : "CLOSED");
          expect(
            state.audits.filter((a) => a.action === "privacy.deletion_cancelled"),
          ).toHaveLength(winner === "CANCEL" ? 1 : 0);
          expect(
            state.audits.filter((a) => a.action === "privacy.account_deactivated"),
          ).toHaveLength(winner === "CANCEL" ? 0 : 1);
        },
      );
    it("recovery rereads deactivated state after the actual worker wins instead of leaving a cancelled closed account", async () => {
      const target = await fixture();
      const actor = await fixture();
      // Only target is due; actor's real request remains outside this worker batch.
      await prisma.accountDeletionRequest.update({
        where: { id: actor.requestId },
        data: { state: "CANCELLED", cancelledAt: new Date() },
      });
      await prisma.accountDeletionRequest.update({
        where: { id: target.requestId },
        data: { state: "GRACE_PERIOD", graceEndsAt: new Date(Date.now() - 1000) },
      });
      let release!: () => void, locked!: () => void;
      const held = new Promise<void>((r) => {
          locked = r;
        }),
        gate = new Promise<void>((r) => {
          release = r;
        });
      const blocker = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${target.id}::uuid FOR UPDATE`;
          locked();
          await gate;
        },
        { timeout: 15000 },
      );
      async function waitFor(marker: string) {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const rows = await prisma.$queryRaw<
            Array<{ waiting: boolean }>
          >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE ${"%" + marker + "%"}) AS waiting`;
          if (rows[0]?.waiting) return;
          await new Promise((r) => setTimeout(r, 20));
        }
        throw Error("Expected actual lifecycle account-row wait: " + marker);
      }
      await held;
      const worker = lifecycle.advanceDue(new Date(), 1);
      let recovery: ReturnType<PrivacyLifecycleService["adminRecover"]> | undefined;
      try {
        await waitFor("ayin-deletion-deactivate-account-lock");
        recovery = lifecycle.adminRecover(actor.id, target.id, "Actual recovery state race review");
        await waitFor("ayin-deletion-recovery-account-lock");
      } finally {
        release();
        await blocker;
      }
      expect(await worker).toBe(1);
      expect(await recovery).toEqual({ recovered: true, previousState: "DEACTIVATED" });
      const state = await evidence(target.id);
      expect(state.account.status).toBe("ACTIVE");
      expect(state.requests.find((r) => r.id === target.requestId)?.state).toBe("CANCELLED");
      const audit = state.audits.find(
        (a) => a.action === "privacy.deletion_admin_recovered" && a.entityId === target.id,
      );
      expect(audit?.metadata).toMatchObject({
        requestId: target.requestId,
        previousState: "DEACTIVATED",
      });
      // This service-level state-race case does not certify the administrative HTTP guard or actor authority.
    });
  },
);
