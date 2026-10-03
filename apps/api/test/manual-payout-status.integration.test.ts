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
databaseDescribe("Manual payout status transaction", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "manual-payout-status-test-secret-with-more-than-32-characters";
    process.env.DATABASE_URL = databaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account" CASCADE');
    await prisma.adminAuditLog.deleteMany();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  async function actor(finance: boolean, suffix: string) {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Actual payout actor",
        email: `manual-status-${suffix}@example.com`,
        password: "strong-pass-123",
      },
    });
    expect(response.statusCode).toBe(201);
    const user = response.json().user;
    const cookies = response.headers["set-cookie"];
    const cookie = (Array.isArray(cookies) ? cookies[0] : cookies)?.split(";", 1)[0];
    if (!cookie) throw Error("Expected actual session");
    if (finance)
      await prisma.adminRoleAssignment.create({
        data: { accountId: user.account.id, role: "FINANCE_MANAGER" },
      });
    return { user, cookie: (await enrollTestMfa(app, cookie)).cookie };
  }
  async function fixture(suffix: string) {
    const finance = await actor(true, suffix);
    const payout = await prisma.payout.create({
      data: {
        channelId: finance.user.channel.id,
        status: "PROCESSING",
        provider: "MANUAL",
        amount: "210.123456",
        currency: "USD",
      },
    });
    const entry = await prisma.earningsLedgerEntry.create({
      data: {
        channelId: payout.channelId,
        payoutId: payout.id,
        type: "AD_REVENUE",
        state: "FINAL",
        amount: "210.123456",
        currency: "USD",
      },
    });
    return { finance, payout, entry };
  }
  function change(cookie: string, id: string, status: string) {
    return app.inject({
      method: "PATCH",
      url: `/admin/revenue/payouts/${id}`,
      headers: { cookie },
      payload: { status, reason: "Actual independently reviewed payout status decision" },
    });
  }
  async function hold(id: string, mutate?: (tx: Prisma.TransactionClient) => Promise<void>) {
    let release!: () => void, acquired!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Payout" WHERE "id" = ${id}::uuid FOR UPDATE`,
        );
        acquired();
        await gate;
        await mutate?.(tx);
      },
      { timeout: 15000 },
    );
    await ready;
    return { release, holder };
  }
  async function waiters(count: number) {
    await vi.waitFor(
      async () => {
        const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(
          Prisma.sql`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%ayin-manual-payout-status-lock%'`,
        );
        expect(Number(rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(count);
      },
      { timeout: 4000, interval: 25 },
    );
  }
  it("serializes contradictory paid/cancelled decisions and keeps the actual ledger reservation consistent", async () => {
    const { finance, payout, entry } = await fixture("race");
    const lock = await hold(payout.id);
    const requests = [
      Promise.resolve(change(finance.cookie, payout.id, "PAID")),
      Promise.resolve(change(finance.cookie, payout.id, "CANCELLED")),
    ];
    try {
      await waiters(2);
    } finally {
      lock.release();
    }
    await lock.holder;
    const responses = await Promise.all(requests);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const stored = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(["PAID", "CANCELLED"]).toContain(stored.status);
    expect(String(stored.amount)).toBe("210.123456");
    expect(
      (await prisma.earningsLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } })).payoutId,
    ).toBe(stored.status === "PAID" ? payout.id : null);
    const logs = await prisma.adminAuditLog.findMany({
      where: {
        actorAccountId: finance.user.account.id,
        action: "PAYOUT_STATUS_UPDATED",
        entityId: payout.id,
      },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.metadata).toMatchObject({ from: "PROCESSING", to: stored.status });
    expect(
      await prisma.notification.count({
        where: {
          accountId: finance.user.account.id,
          title: `Payout ${stored.status.toLowerCase()}`,
        },
      }),
    ).toBe(1);
  });
  it("reads the actual provider after waiting and denies manual mutation of a provider-managed payout", async () => {
    const { finance, payout, entry } = await fixture("provider");
    const lock = await hold(payout.id, async (tx) => {
      await tx.payout.update({ where: { id: payout.id }, data: { provider: "EXTERNAL_TEST" } });
    });
    const request = Promise.resolve(change(finance.cookie, payout.id, "CANCELLED"));
    try {
      await waiters(1);
    } finally {
      lock.release();
    }
    await lock.holder;
    expect((await request).statusCode).toBe(409);
    expect(await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).toMatchObject({
      status: "PROCESSING",
      provider: "EXTERNAL_TEST",
    });
    expect(
      (await prisma.earningsLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } })).payoutId,
    ).toBe(payout.id);
    expect(
      await prisma.adminAuditLog.count({
        where: { action: "PAYOUT_STATUS_UPDATED", entityId: payout.id },
      }),
    ).toBe(0);
  });
  it("rolls back status and released ledger rows if the actual correlated audit fails, then recovers", async () => {
    const { finance, payout, entry } = await fixture("audit");
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ayin_test_manual_status_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."action" = 'PAYOUT_STATUS_UPDATED' THEN RAISE EXCEPTION 'isolated manual payout audit failure'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER ayin_test_manual_status_audit_failure BEFORE INSERT ON "AdminAuditLog" FOR EACH ROW EXECUTE FUNCTION ayin_test_manual_status_audit_failure()',
    );
    try {
      expect((await change(finance.cookie, payout.id, "CANCELLED")).statusCode).toBe(500);
      expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe(
        "PROCESSING",
      );
      expect(
        (await prisma.earningsLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } })).payoutId,
      ).toBe(payout.id);
      expect(
        await prisma.adminAuditLog.count({
          where: { action: "PAYOUT_STATUS_UPDATED", entityId: payout.id },
        }),
      ).toBe(0);
      expect(
        await prisma.notification.count({
          where: { accountId: finance.user.account.id, title: "Payout cancelled" },
        }),
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS ayin_test_manual_status_audit_failure ON "AdminAuditLog"',
      );
      await prisma.$executeRawUnsafe(
        "DROP FUNCTION IF EXISTS ayin_test_manual_status_audit_failure()",
      );
    }
    expect((await change(finance.cookie, payout.id, "CANCELLED")).statusCode).toBe(200);
    expect(
      (await prisma.earningsLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } })).payoutId,
    ).toBeNull();
    expect(
      await prisma.adminAuditLog.count({
        where: { action: "PAYOUT_STATUS_UPDATED", entityId: payout.id },
      }),
    ).toBe(1);
  });
  it("rejects invalid identifiers, missing payouts, unauthorized actors and terminal reversals without a second audit", async () => {
    const { finance, payout, entry } = await fixture("validation");
    const viewer = await actor(false, "viewer");
    expect((await change(viewer.cookie, payout.id, "PAID")).statusCode).toBe(403);
    expect((await change(finance.cookie, "invalid-id", "PAID")).statusCode).toBe(400);
    expect((await change(finance.cookie, randomUUID(), "PAID")).statusCode).toBe(404);
    expect((await change(finance.cookie, payout.id, "INVALID")).statusCode).toBe(400);
    expect((await change(finance.cookie, payout.id, "PAID")).statusCode).toBe(200);
    expect((await change(finance.cookie, payout.id, "CANCELLED")).statusCode).toBe(409);
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe(
      "PAID",
    );
    expect(
      (await prisma.earningsLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } })).payoutId,
    ).toBe(payout.id);
    expect(
      await prisma.adminAuditLog.count({
        where: { action: "PAYOUT_STATUS_UPDATED", entityId: payout.id },
      }),
    ).toBe(1);
  });
  for (const revoke of ["role", "account"] as const)
    it(`rechecks actual ${revoke} authority after waiting before a manual financial decision`, async () => {
      const { finance, payout, entry } = await fixture(`authority-${revoke}`);
      const lock = await hold(payout.id, async (tx) => {
        if (revoke === "role")
          await tx.adminRoleAssignment.deleteMany({
            where: { accountId: finance.user.account.id, role: "FINANCE_MANAGER" },
          });
        else
          await tx.account.update({
            where: { id: finance.user.account.id },
            data: { status: "SUSPENDED" },
          });
      });
      const request = Promise.resolve(change(finance.cookie, payout.id, "CANCELLED"));
      try {
        await waiters(1);
      } finally {
        lock.release();
      }
      await lock.holder;
      expect((await request).statusCode).toBe(403);
      expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe(
        "PROCESSING",
      );
      expect(
        (await prisma.earningsLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } })).payoutId,
      ).toBe(payout.id);
      expect(
        await prisma.adminAuditLog.count({
          where: { action: "PAYOUT_STATUS_UPDATED", entityId: payout.id },
        }),
      ).toBe(0);
      expect(
        await prisma.notification.count({
          where: { accountId: finance.user.account.id, title: "Payout cancelled" },
        }),
      ).toBe(0);
    });
});
