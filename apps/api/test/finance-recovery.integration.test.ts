import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { enrollTestMfa } from "./mfa-test-helper.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
databaseDescribe("Finance explicit recovery reads", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "finance-recovery-test-secret-with-more-than-32-characters";
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
  async function actor(role: "FINANCE_MANAGER" | "OPERATIONS", suffix: string) {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Finance recovery actor",
        email: `finance-recovery-${suffix}@example.com`,
        password: "strong-pass-123",
      },
    });
    expect(response.statusCode).toBe(201);
    const user = response.json().user;
    const cookies = response.headers["set-cookie"];
    const cookie = (Array.isArray(cookies) ? cookies[0] : cookies)?.split(";", 1)[0];
    if (!cookie) throw Error("Expected actual session");
    await prisma.adminRoleAssignment.create({ data: { accountId: user.account.id, role } });
    return { user, cookie: (await enrollTestMfa(app, cookie)).cookie };
  }
  it("returns only the current Finance actor's latest100 decisions, ordered deterministically and projected without sensitive metadata", async () => {
    const first = await actor("FINANCE_MANAGER", "first"),
      other = await actor("FINANCE_MANAGER", "other");
    const stamp = new Date("2026-10-01T00:00:00Z");
    const channelId = first.user.channel.id;
    const own = Array.from({ length: 103 }, () => ({
      id: randomUUID(),
      actorAccountId: first.user.account.id,
      action: "PAYOUT_CREATED",
      entityType: "Payout",
      entityId: randomUUID(),
      createdAt: stamp,
      reason: "Actual retained finance reason",
      metadata: {
        channelId,
        amount: "99999999999999.123456",
        currency: "USD",
        entryCount: 0,
        beneficiarySnapshotted: false,
        destinationEncrypted: "must-not-leak",
        providerDestinationToken: "must-not-leak",
        providerResponse: { secret: "must-not-leak" },
        legalName: "must-not-leak",
        arbitrary: "must-not-leak",
      },
    }));
    await prisma.adminAuditLog.createMany({ data: own });
    await prisma.adminAuditLog.createMany({
      data: [
        {
          actorAccountId: other.user.account.id,
          action: "PAYOUT_CREATED",
          entityType: "Payout",
          entityId: randomUUID(),
        },
        {
          actorAccountId: first.user.account.id,
          action: "payout.destination_revealed",
          entityType: "Payout",
          entityId: randomUUID(),
        },
      ],
    });
    const response = await app.inject({
      method: "GET",
      url: `/admin/revenue/actions?actorAccountId=${other.user.account.id}&take=1000`,
      headers: { cookie: first.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const result = response.json();
    expect(result.actorAccountId).toBe(first.user.account.id);
    expect(result.limit).toBe(100);
    expect(result.items.map((row: { id: string }) => row.id)).toEqual(
      own
        .map((row) => row.id)
        .sort()
        .reverse()
        .slice(0, 100),
    );
    for (const row of result.items)
      expect(row.metadata).toEqual({
        channelId,
        amount: "99999999999999.123456",
        currency: "USD",
        entryCount: 0,
        beneficiarySnapshotted: false,
      });
    expect(response.body).not.toContain("must-not-leak");
    expect(await prisma.adminAuditLog.count()).toBe(105);
  });
  it("denies Operations and an actual Finance actor after role revocation without exposing decisions", async () => {
    const finance = await actor("FINANCE_MANAGER", "revoke"),
      operations = await actor("OPERATIONS", "operations");
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/admin/revenue/actions",
          headers: { cookie: operations.cookie },
        })
      ).statusCode,
    ).toBe(403);
    await prisma.adminRoleAssignment.deleteMany({ where: { accountId: finance.user.account.id } });
    const response = await app.inject({
      method: "GET",
      url: "/admin/revenue/actions",
      headers: { cookie: finance.cookie },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().items).toBeUndefined();
    expect((await app.inject({ method: "GET", url: "/admin/revenue/actions" })).statusCode).toBe(
      401,
    );
  });
  it("marks successful existing financial and reconciliation reads private/no-store without changing their guards or data", async () => {
    const finance = await actor("FINANCE_MANAGER", "headers");
    const urls = [
      "/admin/revenue/settings",
      `/admin/revenue/channels/${finance.user.channel.id}/contracts`,
      "/admin/revenue/ledger?page=1&take=25",
      "/admin/revenue/payouts?page=1&take=25",
      "/admin/revenue/finance-summary",
      "/admin/revenue/disputes",
      "/admin/operations/directory/revenue-channels?query=Finance",
      "/admin/revenue/reconciliation/capabilities",
      "/admin/revenue/reconciliation/reports?page=1&take=25",
    ];
    for (const url of urls) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { cookie: finance.cookie },
      });
      expect(response.statusCode, url).toBe(200);
      expect(response.headers["cache-control"], url).toBe("private, no-store");
    }
  });
});
