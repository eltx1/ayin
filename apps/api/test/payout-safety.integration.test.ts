import "reflect-metadata";

import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;

function cookiePair(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) throw new Error("Expected a session cookie.");
  return value.split(";", 1)[0] ?? value;
}

databaseDescribe("Creator payout safety", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "payout-safety-test-secret-with-more-than-32-characters";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    process.env.PAYOUT_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    moduleReference = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleReference.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
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

  async function register(name: string, email: string) {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name, email, password: "strong-pass-123" },
    });
    expect(response.statusCode).toBe(201);
    return {
      cookie: cookiePair(response.headers["set-cookie"]),
      user: response.json().user,
    };
  }

  it("calculates payout readiness only from the creator's preferred currency", async () => {
    const creator = await register("Currency Creator", "currency-creator@example.com");
    await prisma.earningsLedgerEntry.createMany({
      data: [
        {
          channelId: creator.user.channel.id,
          type: "AD_REVENUE",
          state: "FINAL",
          amount: "50.000000",
          currency: "USD",
        },
        {
          channelId: creator.user.channel.id,
          type: "AD_REVENUE",
          state: "FINAL",
          amount: "100.000000",
          currency: "EUR",
        },
      ],
    });

    const profile = await app.inject({
      method: "PUT",
      url: "/creator/studio/revenue/payment-profile",
      headers: { cookie: creator.cookie },
      payload: {
        legalName: "Currency Creator",
        preferredCurrency: "USD",
        provider: "MANUAL",
        destination: "bank account ending 1234",
        countryCode: "US",
      },
    });
    expect(profile.statusCode).toBe(200);

    const overview = await app.inject({
      method: "GET",
      url: "/creator/studio/revenue",
      headers: { cookie: creator.cookie },
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({
      currency: "USD",
      finalizedRevenue: "50.000000",
      availableForPayout: "50.000000",
      onHoldForPayout: "0.000000",
    });
  });

  it("allows only finance staff to reveal an actionable manual payout destination and audits access", async () => {
    const creator = await register("Payout Creator", "payout-creator@example.com");
    const finance = await register("Finance", "payout-finance@example.com");
    const viewer = await register("Viewer", "payout-viewer@example.com");
    await prisma.adminRoleAssignment.create({
      data: { accountId: finance.user.account.id, role: "FINANCE_MANAGER" },
    });
    await prisma.earningsLedgerEntry.create({
      data: {
        channelId: creator.user.channel.id,
        type: "AD_REVENUE",
        state: "FINAL",
        amount: "125.000000",
        currency: "USD",
      },
    });

    const destination = "Bank transfer: Example Bank / account 0011223344";
    const profile = await app.inject({
      method: "PUT",
      url: "/creator/studio/revenue/payment-profile",
      headers: { cookie: creator.cookie },
      payload: {
        legalName: "Payout Creator",
        preferredCurrency: "USD",
        provider: "MANUAL",
        destination,
        countryCode: "US",
      },
    });
    expect(profile.statusCode).toBe(200);

    const requested = await app.inject({
      method: "POST",
      url: "/creator/studio/revenue/payout-requests",
      headers: { cookie: creator.cookie },
      payload: { currency: "USD" },
    });
    expect(requested.statusCode).toBe(201);
    const payoutId = requested.json().payout.id as string;

    const forbidden = await app.inject({
      method: "POST",
      url: `/admin/revenue/payouts/${payoutId}/destination`,
      headers: { cookie: viewer.cookie },
      payload: { reason: "Attempted payout processing" },
    });
    expect(forbidden.statusCode).toBe(403);

    const revealed = await app.inject({
      method: "POST",
      url: `/admin/revenue/payouts/${payoutId}/destination`,
      headers: { cookie: finance.cookie },
      payload: { reason: "Executing approved manual payout" },
    });
    expect(revealed.statusCode).toBe(201);
    expect(revealed.headers["cache-control"]).toContain("no-store");
    expect(revealed.json()).toMatchObject({
      payoutId,
      provider: "MANUAL",
      legalName: "Payout Creator",
      destination,
      sensitive: true,
      cacheable: false,
    });
    expect(
      await prisma.adminAuditLog.findFirst({
        where: {
          actorAccountId: finance.user.account.id,
          action: "payout.destination_revealed",
          entityId: payoutId,
        },
      }),
    ).toMatchObject({ reason: "Executing approved manual payout" });
  });

  it("enforces one active payout per channel and currency at the database boundary", async () => {
    const creator = await register("Concurrent Creator", "concurrent-payout@example.com");
    await prisma.payout.create({
      data: {
        channelId: creator.user.channel.id,
        amount: "10.000000",
        currency: "USD",
        status: "PENDING",
      },
    });

    await expect(
      prisma.payout.create({
        data: {
          channelId: creator.user.channel.id,
          amount: "20.000000",
          currency: "USD",
          status: "PROCESSING",
        },
      }),
    ).rejects.toBeTruthy();

    await expect(
      prisma.payout.create({
        data: {
          channelId: creator.user.channel.id,
          amount: "30.000000",
          currency: "EUR",
          status: "PENDING",
        },
      }),
    ).resolves.toBeTruthy();
  });
});
