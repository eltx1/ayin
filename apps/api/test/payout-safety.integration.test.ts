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

  it("uses one authorized channel consistently when an older editor membership also exists", async () => {
    const editorChannelOwner = await register(
      "Editor Channel Owner",
      "editor-channel-owner@example.com",
    );
    const creator = await register("Multi Channel Creator", "multi-channel-creator@example.com");

    await prisma.channelMember.create({
      data: {
        channelId: editorChannelOwner.user.channel.id,
        accountId: creator.user.account.id,
        role: "EDITOR",
        createdAt: new Date("2000-01-01T00:00:00.000Z"),
      },
    });
    await prisma.earningsLedgerEntry.createMany({
      data: [
        {
          channelId: editorChannelOwner.user.channel.id,
          type: "AD_REVENUE",
          state: "FINAL",
          amount: "999.000000",
          currency: "USD",
        },
        {
          channelId: creator.user.channel.id,
          type: "AD_REVENUE",
          state: "FINAL",
          amount: "125.000000",
          currency: "USD",
        },
      ],
    });

    const profile = await app.inject({
      method: "PUT",
      url: "/creator/studio/revenue/payment-profile",
      headers: { cookie: creator.cookie },
      payload: {
        legalName: "Multi Channel Creator",
        preferredCurrency: "USD",
        provider: "MANUAL",
        destination: "bank account ending 4321",
        countryCode: "US",
      },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().channelId).toBe(creator.user.channel.id);

    const overview = await app.inject({
      method: "GET",
      url: "/creator/studio/revenue",
      headers: { cookie: creator.cookie },
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({
      channel: { id: creator.user.channel.id },
      currency: "USD",
      finalizedRevenue: "125.000000",
      availableForPayout: "125.000000",
      paymentProfile: { channelId: creator.user.channel.id },
    });

    const requested = await app.inject({
      method: "POST",
      url: "/creator/studio/revenue/payout-requests",
      headers: { cookie: creator.cookie },
      payload: { currency: "USD" },
    });
    expect(requested.statusCode).toBe(201);
    expect(requested.json().payout.channelId).toBe(creator.user.channel.id);
    expect(
      await prisma.payout.count({ where: { channelId: editorChannelOwner.user.channel.id } }),
    ).toBe(0);
  });

  it("neutralizes formula-leading creator statement cells", async () => {
    const creator = await register("Statement Creator", "statement-formula@example.com");
    await prisma.earningsLedgerEntry.create({
      data: {
        channelId: creator.user.channel.id,
        type: "ADJUSTMENT",
        state: "ADJUSTMENT",
        amount: "1.000000",
        currency: "USD",
        memo: '=HYPERLINK("https://example.invalid","click")',
      },
    });

    const statement = await app.inject({
      method: "GET",
      url: "/creator/studio/revenue/statement",
      headers: { cookie: creator.cookie },
    });
    expect(statement.statusCode).toBe(200);
    const content = statement.json().content as string;
    expect(content).toContain('"\'=HYPERLINK(""https://example.invalid"",""click"")"');
    expect(content).not.toContain('"=HYPERLINK(');
  });

  it("atomically snapshots creator payouts, keeps the snapshot immutable and never exposes ciphertext", async () => {
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
    expect(JSON.stringify(requested.json())).not.toContain("destinationEncryptedSnapshot");
    const payoutId = requested.json().payout.id as string;

    const storedSnapshot = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    expect(storedSnapshot).toMatchObject({
      requestSource: "CREATOR",
      provider: "MANUAL",
      legalNameSnapshot: "Payout Creator",
    });
    expect(storedSnapshot.paymentProfileId).not.toBeNull();
    expect(storedSnapshot.destinationEncryptedSnapshot).not.toBeNull();
    expect(storedSnapshot.destinationMaskSnapshot).not.toBeNull();

    const creatorOverview = await app.inject({
      method: "GET",
      url: "/creator/studio/revenue",
      headers: { cookie: creator.cookie },
    });
    expect(creatorOverview.statusCode).toBe(200);
    expect(JSON.stringify(creatorOverview.json())).not.toContain("destinationEncryptedSnapshot");

    const adminList = await app.inject({
      method: "GET",
      url: "/admin/revenue/payouts",
      headers: { cookie: finance.cookie },
    });
    expect(adminList.statusCode).toBe(200);
    expect(JSON.stringify(adminList.json())).not.toContain("destinationEncryptedSnapshot");

    const changedDestination = "Bank transfer: Other Bank / account 9988776655";
    const changedProfile = await app.inject({
      method: "PUT",
      url: "/creator/studio/revenue/payment-profile",
      headers: { cookie: creator.cookie },
      payload: {
        legalName: "Payout Creator",
        preferredCurrency: "USD",
        provider: "MANUAL",
        destination: changedDestination,
        countryCode: "US",
      },
    });
    expect(changedProfile.statusCode).toBe(200);

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
    expect(revealed.json().destination).not.toBe(changedDestination);

    const processing = await app.inject({
      method: "PATCH",
      url: `/admin/revenue/payouts/${payoutId}`,
      headers: { cookie: finance.cookie },
      payload: { status: "PROCESSING", reason: "Manual payout processing started" },
    });
    expect(processing.statusCode).toBe(200);
    expect(JSON.stringify(processing.json())).not.toContain("destinationEncryptedSnapshot");

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

  it("snapshots the beneficiary for finance-created payouts and never follows later profile edits", async () => {
    const creator = await register("Admin Payout Creator", "admin-payout-creator@example.com");
    const finance = await register("Admin Payout Finance", "admin-payout-finance@example.com");
    await prisma.adminRoleAssignment.create({
      data: { accountId: finance.user.account.id, role: "FINANCE_MANAGER" },
    });
    await prisma.earningsLedgerEntry.create({
      data: {
        channelId: creator.user.channel.id,
        type: "AD_REVENUE",
        state: "FINAL",
        amount: "210.000000",
        currency: "USD",
      },
    });

    const originalDestination = "Bank transfer: Snapshot Bank / account 111122223333";
    const profile = await app.inject({
      method: "PUT",
      url: "/creator/studio/revenue/payment-profile",
      headers: { cookie: creator.cookie },
      payload: {
        legalName: "Admin Payout Creator",
        preferredCurrency: "USD",
        provider: "MANUAL",
        destination: originalDestination,
        countryCode: "US",
      },
    });
    expect(profile.statusCode).toBe(200);

    const created = await app.inject({
      method: "POST",
      url: "/admin/revenue/payouts",
      headers: { cookie: finance.cookie },
      payload: { channelId: creator.user.channel.id, currency: "USD" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().destinationEncryptedSnapshot).toBeUndefined();
    expect(created.json()).toMatchObject({
      channelId: creator.user.channel.id,
      currency: "USD",
      requestSource: "ADMIN",
      provider: "MANUAL",
      legalNameSnapshot: "Admin Payout Creator",
    });
    const payoutId = created.json().id as string;

    const stored = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    expect(stored.requestSource).toBe("ADMIN");
    expect(stored.paymentProfileId).not.toBeNull();
    expect(stored.destinationEncryptedSnapshot).not.toBeNull();
    expect(stored.destinationMaskSnapshot).not.toBeNull();
    expect(stored.legalNameSnapshot).toBe("Admin Payout Creator");

    const changedDestination = "Bank transfer: Redirected Bank / account 999988887777";
    const changedProfile = await app.inject({
      method: "PUT",
      url: "/creator/studio/revenue/payment-profile",
      headers: { cookie: creator.cookie },
      payload: {
        legalName: "Admin Payout Creator",
        preferredCurrency: "USD",
        provider: "MANUAL",
        destination: changedDestination,
        countryCode: "US",
      },
    });
    expect(changedProfile.statusCode).toBe(200);

    const revealed = await app.inject({
      method: "POST",
      url: `/admin/revenue/payouts/${payoutId}/destination`,
      headers: { cookie: finance.cookie },
      payload: { reason: "Executing snapshotted admin payout" },
    });
    expect(revealed.statusCode).toBe(201);
    expect(revealed.json()).toMatchObject({
      payoutId,
      destination: originalDestination,
      legalName: "Admin Payout Creator",
      sensitive: true,
    });
    expect(revealed.json().destination).not.toBe(changedDestination);
  });

  it("refuses to reveal a mutable live profile for an active legacy payout without a snapshot", async () => {
    const creator = await register("Legacy Creator", "legacy-payout-creator@example.com");
    const finance = await register("Legacy Finance", "legacy-payout-finance@example.com");
    await prisma.adminRoleAssignment.create({
      data: { accountId: finance.user.account.id, role: "FINANCE_MANAGER" },
    });

    const liveDestination = "Bank transfer: Mutable Legacy Bank / account 555566667777";
    const profile = await app.inject({
      method: "PUT",
      url: "/creator/studio/revenue/payment-profile",
      headers: { cookie: creator.cookie },
      payload: {
        legalName: "Legacy Creator",
        preferredCurrency: "USD",
        provider: "MANUAL",
        destination: liveDestination,
        countryCode: "US",
      },
    });
    expect(profile.statusCode).toBe(200);

    const legacyPayout = await prisma.payout.create({
      data: {
        channelId: creator.user.channel.id,
        amount: "15.000000",
        currency: "USD",
        status: "PENDING",
        provider: "MANUAL",
        requestSource: "ADMIN",
      },
    });

    const details = await app.inject({
      method: "GET",
      url: `/admin/revenue/payouts/${legacyPayout.id}`,
      headers: { cookie: finance.cookie },
    });
    expect(details.statusCode).toBe(200);
    expect(details.json()).toMatchObject({
      payoutId: legacyPayout.id,
      beneficiarySnapshotAvailable: false,
      destinationRevealAllowed: false,
    });

    const reveal = await app.inject({
      method: "POST",
      url: `/admin/revenue/payouts/${legacyPayout.id}/destination`,
      headers: { cookie: finance.cookie },
      payload: { reason: "Attempt to reveal legacy mutable profile" },
    });
    expect(reveal.statusCode).not.toBe(201);
    expect(JSON.stringify(reveal.json())).not.toContain(liveDestination);
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
