import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient, Prisma } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { AdminAuditLogService } from "../src/admin/admin-audit-log.service.js";
import { encryptPayoutDestination } from "../src/revenue/creator-finance.crypto.js";
import { enrollTestMfa } from "./mfa-test-helper.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
databaseDescribe("Immutable payout destination commit authority", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  let audit: AdminAuditLogService;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "payout-reveal-test-secret-with-more-than-32-characters";
    process.env.DATABASE_URL = databaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    process.env.PAYOUT_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    audit = module.get(AdminAuditLogService);
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
  async function actor(role: "FINANCE_MANAGER" | "OPERATIONS" = "FINANCE_MANAGER") {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Reveal Finance",
        email: `reveal-${randomUUID()}@example.com`,
        password: "strong-pass-123",
      },
    });
    expect(response.statusCode).toBe(201);
    const user = response.json().user;
    const cookies = response.headers["set-cookie"];
    const cookie = (Array.isArray(cookies) ? cookies[0] : cookies)?.split(";", 1)[0];
    if (!cookie) throw Error("Expected real session");
    await prisma.adminRoleAssignment.create({ data: { accountId: user.account.id, role } });
    return { user, cookie: (await enrollTestMfa(app, cookie)).cookie };
  }
  const secret = "IMMUTABLE TEST bank instruction 123456";
  async function payout(channelId: string) {
    return prisma.payout.create({
      data: {
        channelId,
        status: "PENDING",
        provider: "MANUAL",
        amount: "1.000001",
        currency: "USD",
        legalNameSnapshot: "Original beneficiary",
        destinationEncryptedSnapshot: encryptPayoutDestination(secret),
        destinationMaskSnapshot: "•••• 3456",
        countryCodeSnapshot: "US",
      },
    });
  }
  function reveal(cookie: string, payoutId: string, reason = "Executing approved original payout") {
    return Promise.resolve(
      app.inject({
        method: "POST",
        url: `/admin/revenue/payouts/${payoutId}/destination`,
        headers: { cookie },
        payload: { reason },
      }),
    );
  }
  it("rejects malformed/missing records and insufficient reasons with400/404, preserves Finance/Operations/anonymous boundaries, and never reveals through ordinary GET", async () => {
    const finance = await actor(),
      operations = await actor("OPERATIONS");
    const row = await payout(finance.user.channel.id);
    const detail = await app.inject({
      method: "GET",
      url: `/admin/revenue/payouts/${row.id}`,
      headers: { cookie: finance.cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).not.toContain(secret);
    expect(detail.body).not.toContain("destinationEncrypted");
    for (const [payoutId, statusCode] of [
      ["bad-id", 400],
      [randomUUID(), 404],
    ] as const)
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/admin/revenue/payouts/${payoutId}`,
            headers: { cookie: finance.cookie },
          })
        ).statusCode,
      ).toBe(statusCode);
    expect((await reveal(finance.cookie, "bad-id")).statusCode).toBe(400);
    expect((await reveal(finance.cookie, randomUUID())).statusCode).toBe(404);
    expect((await reveal(finance.cookie, row.id, "bad")).statusCode).toBe(400);
    expect((await reveal(operations.cookie, row.id)).statusCode).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/admin/revenue/payouts/${row.id}/destination`,
          payload: { reason: "No authenticated financial authority" },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      await prisma.adminAuditLog.count({ where: { action: "payout.destination_revealed" } }),
    ).toBe(0);
  });
  it("returns no sensitive payload after audit failure, then explicitly reveals the immutable snapshot once with a safe audit", async () => {
    const finance = await actor(),
      row = await payout(finance.user.channel.id);
    const original = audit.recordInTransaction.bind(audit);
    const spy = vi.spyOn(audit, "recordInTransaction").mockImplementation(async (tx, input) => {
      if (input.action === "payout.destination_revealed")
        throw Error("Injected reveal audit failure");
      return original(tx, input);
    });
    const failure = await reveal(finance.cookie, row.id);
    expect(failure.statusCode).toBe(500);
    expect(failure.body).not.toContain(secret);
    expect(
      await prisma.adminAuditLog.count({ where: { action: "payout.destination_revealed" } }),
    ).toBe(0);
    spy.mockRestore();
    const success = await reveal(finance.cookie, row.id);
    expect(success.statusCode).toBe(201);
    expect(success.headers["cache-control"]).toContain("no-store");
    expect(success.headers.pragma).toBe("no-cache");
    expect(success.json()).toMatchObject({
      payoutId: row.id,
      destination: secret,
      sensitive: true,
      cacheable: false,
    });
    const records = await prisma.adminAuditLog.findMany({
      where: { action: "payout.destination_revealed" },
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      actorAccountId: finance.user.account.id,
      entityId: row.id,
      metadata: { source: "IMMUTABLE_PAYOUT_SNAPSHOT", payoutStatus: "PENDING" },
    });
    expect(JSON.stringify(records)).not.toContain(secret);
  });
  for (const change of ["STATUS", "ROLE", "ACCOUNT"] as const) {
    it(`rechecks ${change} after an observed payout lock wait and denies disclosure without an audit`, async () => {
      const finance = await actor(),
        row = await payout(finance.user.channel.id);
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
            Prisma.sql`SELECT "id" FROM "Payout" WHERE "id" = ${row.id}::uuid FOR UPDATE`,
          );
          acquired();
          await gate;
          if (change === "STATUS")
            await tx.payout.update({ where: { id: row.id }, data: { status: "CANCELLED" } });
        },
        { timeout: 15000 },
      );
      await locked;
      const request = reveal(finance.cookie, row.id);
      try {
        await vi.waitFor(
          async () => {
            const waiters = await prisma.$queryRaw<Array<{ count: bigint }>>(
              Prisma.sql`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%ayin-payout-destination-lock%'`,
            );
            expect(Number(waiters[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);
          },
          { timeout: 4000, interval: 25 },
        );
        if (change === "ROLE")
          await prisma.adminRoleAssignment.deleteMany({
            where: { accountId: finance.user.account.id },
          });
        if (change === "ACCOUNT")
          await prisma.account.update({
            where: { id: finance.user.account.id },
            data: { status: "SUSPENDED" },
          });
      } finally {
        release();
      }
      await holder;
      const response = await request;
      expect(response.statusCode).toBe(change === "STATUS" ? 409 : 403);
      expect(response.body).not.toContain(secret);
      expect(
        await prisma.adminAuditLog.count({ where: { action: "payout.destination_revealed" } }),
      ).toBe(0);
      expect((await prisma.payout.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
        change === "STATUS" ? "CANCELLED" : "PENDING",
      );
    });
  }
});
