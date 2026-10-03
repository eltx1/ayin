import "reflect-metadata";

import { createPrismaClient, Prisma } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AppModule } from "../src/app.module.js";
import { RevenueService } from "../src/revenue/revenue.service.js";
import {
  CREATOR_COMPLIANCE_ADAPTER,
  type CreatorComplianceAdapter,
} from "../src/revenue/creator-compliance.adapter.js";

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
    // Other integration files update platform settings; isolate these readiness cases.
    await prisma.platformSetting.deleteMany({ where: { namespace: "MONETIZATION" } });
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
    await prisma.platformSetting.create({
      data: {
        namespace: "MONETIZATION",
        key: "payoutThresholdMicros",
        valueType: "STRING",
        schemaVersion: 1,
        value: "100000000",
      },
    });
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
      canRequestPayout: false,
      payoutEligibility: {
        eligible: false,
        actionsRequired: ["Reach the minimum payout amount."],
      },
    });
  });

  it("keeps actual overview payouts blocked while required identity verification is pending", async () => {
    const creator = await register("Pending Identity Creator", "pending-identity@example.com");
    await prisma.earningsLedgerEntry.create({
      data: {
        channelId: creator.user.channel.id,
        type: "AD_REVENUE",
        state: "FINAL",
        amount: "150.000000",
        currency: "USD",
      },
    });
    const profile = await app.inject({
      method: "PUT",
      url: "/creator/studio/revenue/payment-profile",
      headers: { cookie: creator.cookie },
      payload: {
        legalName: "Pending Identity Creator",
        preferredCurrency: "USD",
        provider: "MANUAL",
        destination: "bank account ending 8765",
        countryCode: "US",
      },
    });
    expect(profile.statusCode).toBe(200);
    // Only the external requirements boundary is controlled; API, ledger, profile,
    // compliance evaluation and currency normalization execute their real code.
    const adapter = moduleReference.get<CreatorComplianceAdapter>(CREATOR_COMPLIANCE_ADAPTER);
    const requirements = vi.spyOn(adapter, "requirements").mockResolvedValue({
      identityRequired: true,
      taxRequired: false,
      payoutDestinationVerificationRequired: false,
      source: "PROVIDER",
      version: "isolated-test-v1",
    });
    try {
      const overview = await app.inject({
        method: "GET",
        url: "/creator/studio/revenue",
        headers: { cookie: creator.cookie },
      });
      expect(overview.statusCode).toBe(200);
      expect(overview.json()).toMatchObject({
        currency: "USD",
        availableForPayout: "150.000000",
        payoutReadiness: {
          profileReady: true,
          thresholdMet: true,
          providerReady: true,
          complianceReady: false,
        },
        compliance: {
          identity: { required: true, status: "NOT_STARTED" },
          payoutComplianceEligible: false,
        },
        canRequestPayout: false,
        payoutEligibility: { eligible: false },
      });
      expect(overview.json().payoutEligibility.actionsRequired).toEqual(
        overview.json().compliance.actionsRequired,
      );
      expect(overview.json().compliance.actionsRequired.length).toBeGreaterThan(0);
    } finally {
      requirements.mockRestore();
    }
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
  async function holdFinanceChannel(
    channelId: string,
    change: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
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
          Prisma.sql`SELECT "id" FROM "Channel" WHERE "id" = ${channelId}::uuid FOR UPDATE`,
        );
        acquired();
        await gate;
        await change(tx);
      },
      { timeout: 15000 },
    );
    await ready;
    return { release, holder };
  }
  async function financialWaiters(count: number) {
    await vi.waitFor(
      async () => {
        const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(
          Prisma.sql`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%ayin-finance-channel-lock%'`,
        );
        expect(Number(rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(count);
      },
      { timeout: 4000, interval: 25 },
    );
  }
  for (const change of ["membership", "removal", "account"] as const)
    it(`rechecks actual ${change} after waiting before profile/dispute writes`, async () => {
      const creator = await register(
        "Revoked finance creator",
        `revoked-finance-${change}@example.com`,
      );
      const channelId = creator.user.channel.id;
      const lock = await holdFinanceChannel(channelId, async (tx) => {
        if (change === "membership")
          await tx.channelMember.updateMany({
            where: { channelId, accountId: creator.user.account.id },
            data: { role: "EDITOR" },
          });
        else if (change === "account")
          await tx.account.update({
            where: { id: creator.user.account.id },
            data: { status: "SUSPENDED" },
          });
        else await tx.channel.update({ where: { id: channelId }, data: { status: "REMOVED" } });
      });
      const profile = Promise.resolve(
        app.inject({
          method: "PUT",
          url: "/creator/studio/revenue/payment-profile",
          headers: { cookie: creator.cookie },
          payload: {
            legalName: "Retained unsent beneficiary",
            preferredCurrency: "USD",
            provider: "MANUAL",
            destination: "isolated bank account ending 1234",
            countryCode: "US",
          },
        }),
      );
      const dispute = Promise.resolve(
        app.inject({
          method: "POST",
          url: "/creator/studio/revenue/disputes",
          headers: { cookie: creator.cookie },
          payload: {
            category: "EARNINGS",
            message: "Actual blocked creator dispute must not commit after authority revocation.",
          },
        }),
      );
      try {
        await financialWaiters(2);
      } finally {
        lock.release();
      }
      await lock.holder;
      expect((await Promise.all([profile, dispute])).map((r) => r.statusCode)).toEqual([403, 403]);
      expect(await prisma.creatorPayoutProfile.count({ where: { channelId } })).toBe(0);
      expect(await prisma.revenueDispute.count({ where: { channelId } })).toBe(0);
      expect(
        await prisma.adminAuditLog.count({
          where: {
            actorAccountId: creator.user.account.id,
            action: { in: ["creator.payout_profile_updated", "creator.revenue_dispute_created"] },
          },
        }),
      ).toBe(0);
      expect(
        await prisma.notification.count({
          where: { accountId: creator.user.account.id, title: "Revenue dispute opened" },
        }),
      ).toBe(0);
    });

  it("rechecks creator authority before reserving a payable balance after a real concurrent revocation", async () => {
    const creator = await register("Revoked payout creator", "revoked-payout-creator@example.com"),
      channelId = creator.user.channel.id;
    const profile = await app.inject({
      method: "PUT",
      url: "/creator/studio/revenue/payment-profile",
      headers: { cookie: creator.cookie },
      payload: {
        legalName: "Revoked payout creator",
        preferredCurrency: "USD",
        provider: "MANUAL",
        destination: "isolated bank account ending 4455",
        countryCode: "US",
      },
    });
    expect(profile.statusCode).toBe(200);
    const entry = await prisma.earningsLedgerEntry.create({
      data: {
        channelId,
        type: "AD_REVENUE",
        state: "FINAL",
        amount: "210.000000",
        currency: "USD",
      },
    });
    const lock = await holdFinanceChannel(channelId, async (tx) => {
      await tx.channelMember.updateMany({
        where: { channelId, accountId: creator.user.account.id },
        data: { role: "EDITOR" },
      });
    });
    const request = Promise.resolve(
      app.inject({
        method: "POST",
        url: "/creator/studio/revenue/payout-requests",
        headers: { cookie: creator.cookie },
        payload: { currency: "USD" },
      }),
    );
    try {
      await financialWaiters(1);
    } finally {
      lock.release();
    }
    await lock.holder;
    expect((await request).statusCode).toBe(403);
    expect(await prisma.payout.count({ where: { channelId } })).toBe(0);
    expect(
      (await prisma.earningsLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } })).payoutId,
    ).toBeNull();
    expect(
      await prisma.adminAuditLog.count({
        where: {
          actorAccountId: creator.user.account.id,
          action: { in: ["PAYOUT_CREATED", "creator.payout_requested"] },
        },
      }),
    ).toBe(0);
  });

  it("serializes two actual Finance payout requests while retaining one exact beneficiary and ledger reservation", async () => {
    const creator = await register(
        "Serialized payout creator",
        "serialized-payout-creator@example.com",
      ),
      channelId = creator.user.channel.id;
    const finance = await register("Serialized Finance", "serialized-payout-finance@example.com");
    await prisma.adminRoleAssignment.create({
      data: { accountId: finance.user.account.id, role: "FINANCE_MANAGER" },
    });
    const profile = await app.inject({
      method: "PUT",
      url: "/creator/studio/revenue/payment-profile",
      headers: { cookie: creator.cookie },
      payload: {
        legalName: "Serialized payout creator",
        preferredCurrency: "USD",
        provider: "MANUAL",
        destination: "isolated bank account ending 4455",
        countryCode: "US",
      },
    });
    expect(profile.statusCode).toBe(200);
    const entry = await prisma.earningsLedgerEntry.create({
      data: {
        channelId,
        type: "AD_REVENUE",
        state: "FINAL",
        amount: "210.123456",
        currency: "USD",
      },
    });
    const lock = await holdFinanceChannel(channelId, async () => undefined);
    const request = () =>
      Promise.resolve(
        app.inject({
          method: "POST",
          url: "/admin/revenue/payouts",
          headers: { cookie: finance.cookie },
          payload: { channelId, currency: "USD" },
        }),
      );
    const first = request(),
      second = request();
    try {
      await financialWaiters(2);
    } finally {
      lock.release();
    }
    await lock.holder;
    const responses = await Promise.all([first, second]);
    expect(responses.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.statusCode >= 400)).toHaveLength(1);
    const payout = await prisma.payout.findFirstOrThrow({ where: { channelId } });
    expect(String(payout.amount)).toBe("210.123456");
    expect(payout.legalNameSnapshot).toBe("Serialized payout creator");
    expect(payout.destinationEncryptedSnapshot).toBeTruthy();
    expect(
      (await prisma.earningsLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } })).payoutId,
    ).toBe(payout.id);
    expect(await prisma.payout.count({ where: { channelId } })).toBe(1);
    expect(
      await prisma.adminAuditLog.count({
        where: {
          actorAccountId: finance.user.account.id,
          action: "PAYOUT_CREATED",
          entityId: payout.id,
        },
      }),
    ).toBe(1);
  });
  async function compliantFixture(suffix: string) {
    const creator = await register(
      "Actual compliant creator",
      `compliance-race-${suffix}@example.com`,
    );
    const finance = await register(
      "Actual compliance Finance",
      `compliance-finance-${suffix}@example.com`,
    );
    await prisma.adminRoleAssignment.create({
      data: { accountId: finance.user.account.id, role: "FINANCE_MANAGER" },
    });
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/creator/studio/revenue/payment-profile",
          headers: { cookie: creator.cookie },
          payload: {
            legalName: "Actual compliant creator",
            preferredCurrency: "USD",
            provider: "MANUAL",
            destination: "isolated bank account ending 4455",
            countryCode: "US",
          },
        })
      ).statusCode,
    ).toBe(200);
    const profile = await prisma.creatorPayoutProfile.update({
      where: { channelId: creator.user.channel.id },
      data: { identityStatus: "VERIFIED" },
    });
    const entry = await prisma.earningsLedgerEntry.create({
      data: {
        channelId: creator.user.channel.id,
        type: "AD_REVENUE",
        state: "FINAL",
        amount: "210.123456",
        currency: "USD",
      },
    });
    return { creator, finance, profile, entry, channelId: creator.user.channel.id };
  }
  function requiredIdentity() {
    const adapter = moduleReference.get<CreatorComplianceAdapter>(CREATOR_COMPLIANCE_ADAPTER);
    return vi.spyOn(adapter, "requirements").mockResolvedValue({
      identityRequired: true,
      taxRequired: false,
      payoutDestinationVerificationRequired: false,
      source: "PROVIDER",
      version: "isolated-requirement-v1",
    });
  }
  it("rechecks actual compliance after both Creator and Finance payout requests wait for the channel", async () => {
    const { creator, finance, entry, profile, channelId } = await compliantFixture("state");
    const requirements = requiredIdentity();
    try {
      const lock = await holdFinanceChannel(channelId, async (tx) => {
        await tx.creatorPayoutProfile.update({
          where: { id: profile.id },
          data: { identityStatus: "REJECTED" },
        });
      });
      const creatorRequest = Promise.resolve(
        app.inject({
          method: "POST",
          url: "/creator/studio/revenue/payout-requests",
          headers: { cookie: creator.cookie },
          payload: { currency: "USD" },
        }),
      );
      const financeRequest = Promise.resolve(
        app.inject({
          method: "POST",
          url: "/admin/revenue/payouts",
          headers: { cookie: finance.cookie },
          payload: { channelId, currency: "USD" },
        }),
      );
      try {
        await financialWaiters(2);
        expect(requirements).toHaveBeenCalledTimes(2);
      } finally {
        lock.release();
      }
      await lock.holder;
      expect(
        (await Promise.all([creatorRequest, financeRequest])).map((r) => r.statusCode),
      ).toEqual([409, 409]);
      expect(requirements).toHaveBeenCalledTimes(2);
      expect(await prisma.payout.count({ where: { channelId } })).toBe(0);
      expect(
        (await prisma.earningsLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } })).payoutId,
      ).toBeNull();
      expect(
        await prisma.adminAuditLog.count({
          where: {
            entityType: "Payout",
            actorAccountId: { in: [creator.user.account.id, finance.user.account.id] },
          },
        }),
      ).toBe(0);
      expect(
        await prisma.notification.count({
          where: {
            accountId: creator.user.account.id,
            title: { in: ["Payout created", "Payout request received"] },
          },
        }),
      ).toBe(0);
    } finally {
      requirements.mockRestore();
    }
  });
  it("rejects a changed actual requirement context without another provider call while locks are held", async () => {
    const { creator, entry, profile, channelId } = await compliantFixture("context");
    const requirements = requiredIdentity();
    try {
      const lock = await holdFinanceChannel(channelId, async (tx) => {
        await tx.creatorPayoutProfile.update({
          where: { id: profile.id },
          data: { countryCode: "GB" },
        });
      });
      const request = Promise.resolve(
        app.inject({
          method: "POST",
          url: "/creator/studio/revenue/payout-requests",
          headers: { cookie: creator.cookie },
          payload: { currency: "USD" },
        }),
      );
      try {
        await financialWaiters(1);
        expect(requirements).toHaveBeenCalledTimes(1);
      } finally {
        lock.release();
      }
      await lock.holder;
      const response = await request;
      expect(response.statusCode).toBe(409);
      expect(response.json().message).toBe("PAYOUT_COMPLIANCE_CONTEXT_CHANGED");
      expect(requirements).toHaveBeenCalledTimes(1);
      expect(await prisma.payout.count({ where: { channelId } })).toBe(0);
      expect(
        (await prisma.earningsLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } })).payoutId,
      ).toBeNull();
    } finally {
      requirements.mockRestore();
    }
  });
  it("serializes actual compliance overrides and audits the real immediately preceding state", async () => {
    const { finance, profile, channelId } = await compliantFixture("override");
    const lock = await holdFinanceChannel(channelId, async () => {});
    const requests = ["PENDING", "REJECTED"].map((status) =>
      Promise.resolve(
        app.inject({
          method: "PATCH",
          url: `/admin/revenue/channels/${channelId}/compliance`,
          headers: { cookie: finance.cookie },
          payload: {
            field: "IDENTITY",
            status,
            reason: "Actual independently reviewed compliance override",
          },
        }),
      ),
    );
    try {
      await financialWaiters(2);
    } finally {
      lock.release();
    }
    await lock.holder;
    expect((await Promise.all(requests)).map((r) => r.statusCode)).toEqual([200, 200]);
    const logs = await prisma.adminAuditLog.findMany({
      where: {
        action: "creator.compliance_status_overridden",
        entityId: profile.id,
        actorAccountId: finance.user.account.id,
      },
    });
    expect(logs).toHaveLength(2);
    const steps = logs.map(
      (l) =>
        l.metadata as {
          from: string;
          to: string;
          channelId: string;
          rawIdentityDataAccessed: boolean;
          taxIdentifierAccessed: boolean;
          bankDataAccessed: boolean;
        },
    );
    const first = steps.find((l) => l.from === "VERIFIED");
    expect(first).toBeDefined();
    const second = steps.find((l) => l.from === first?.to);
    expect(second).toBeDefined();
    expect(
      (await prisma.creatorPayoutProfile.findUniqueOrThrow({ where: { id: profile.id } }))
        .identityStatus,
    ).toBe(second?.to);
    expect(
      steps.every(
        (l) =>
          l.channelId === channelId &&
          !l.rawIdentityDataAccessed &&
          !l.taxIdentifierAccessed &&
          !l.bankDataAccessed,
      ),
    ).toBe(true);
  });
  for (const change of ["creator-account", "finance-account", "finance-role"] as const)
    it(`denies actual payout after blocked ${change} authority is revoked`, async () => {
      const { creator, finance, entry, channelId } = await compliantFixture(change);
      const actor = change === "creator-account" ? creator : finance;
      const lock = await holdFinanceChannel(channelId, async (tx) => {
        if (change === "finance-role")
          await tx.adminRoleAssignment.deleteMany({
            where: { accountId: finance.user.account.id },
          });
        else
          await tx.account.update({
            where: { id: actor.user.account.id },
            data: { status: "SUSPENDED" },
          });
      });
      const request = Promise.resolve(
        app.inject({
          method: "POST",
          url:
            change === "creator-account"
              ? "/creator/studio/revenue/payout-requests"
              : "/admin/revenue/payouts",
          headers: { cookie: actor.cookie },
          payload:
            change === "creator-account" ? { currency: "USD" } : { channelId, currency: "USD" },
        }),
      );
      try {
        await financialWaiters(1);
      } finally {
        lock.release();
      }
      await lock.holder;
      expect((await request).statusCode).toBe(403);
      expect(await prisma.payout.count({ where: { channelId } })).toBe(0);
      expect(
        (await prisma.earningsLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } })).payoutId,
      ).toBeNull();
      expect(
        await prisma.adminAuditLog.count({
          where: { entityType: "Payout", actorAccountId: actor.user.account.id },
        }),
      ).toBe(0);
      expect(
        await prisma.notification.count({
          where: {
            accountId: creator.user.account.id,
            title: { in: ["Payout created", "Payout request received"] },
          },
        }),
      ).toBe(0);
    });

  it("reads a newly inserted threshold after Creator and Finance wait, without reserving either payout", async () => {
    const { creator, finance, entry, channelId } = await compliantFixture("threshold");
    expect(await prisma.platformSetting.count({ where: { namespace: "MONETIZATION" } })).toBe(0);
    const lock = await holdFinanceChannel(channelId, async (tx) => {
      await tx.platformSetting.create({
        data: {
          namespace: "MONETIZATION",
          key: "payoutThresholdMicros",
          valueType: "STRING",
          schemaVersion: 1,
          value: "300000000",
        },
      });
    });
    const requests = [
      Promise.resolve(
        app.inject({
          method: "POST",
          url: "/creator/studio/revenue/payout-requests",
          headers: { cookie: creator.cookie },
          payload: { currency: "USD" },
        }),
      ),
      Promise.resolve(
        app.inject({
          method: "POST",
          url: "/admin/revenue/payouts",
          headers: { cookie: finance.cookie },
          payload: { channelId, currency: "USD" },
        }),
      ),
    ];
    try {
      await financialWaiters(2);
    } finally {
      lock.release();
    }
    await lock.holder;
    const results = await Promise.all(requests);
    expect(results.map((r) => r.statusCode)).toEqual([409, 409]);
    for (const r of results) expect(r.json().message).toBe("PAYOUT_THRESHOLD_NOT_MET");
    expect(await prisma.payout.count({ where: { channelId } })).toBe(0);
    expect(
      (await prisma.earningsLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } })).payoutId,
    ).toBeNull();
    expect(
      await prisma.adminAuditLog.count({
        where: {
          entityType: "Payout",
          actorAccountId: { in: [creator.user.account.id, finance.user.account.id] },
        },
      }),
    ).toBe(0);
    expect(
      await prisma.notification.count({
        where: {
          accountId: creator.user.account.id,
          title: { in: ["Payout created", "Payout request received"] },
        },
      }),
    ).toBe(0);
  });

  it("serializes actual settings insertion with the held payout settings lock even when no setting rows exist", async () => {
    const { finance } = await compliantFixture("settings-lock");
    let release!: () => void, ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const revenue = moduleReference.get(RevenueService);
    const holder = prisma.$transaction(
      async (tx) => {
        expect(await revenue.getPayoutSettings(tx)).toEqual({
          defaultCreatorRevenueShareBps: 0,
          payoutThresholdMicros: "0",
        });
        ready();
        await gate;
      },
      { timeout: 15000 },
    );
    await acquired;
    const write = Promise.resolve(
      app.inject({
        method: "PATCH",
        url: "/admin/revenue/settings",
        headers: { cookie: finance.cookie },
        payload: { defaultCreatorRevenueShareBps: 0, payoutThresholdMicros: "300000000" },
      }),
    );
    try {
      await vi.waitFor(
        async () => {
          const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(
            Prisma.sql`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%ayin-settings-update-lock%'`,
          );
          expect(Number(rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);
        },
        { timeout: 4000, interval: 25 },
      );
      expect(await prisma.platformSetting.count({ where: { namespace: "MONETIZATION" } })).toBe(0);
      expect(
        await prisma.adminAuditLog.count({
          where: { actorAccountId: finance.user.account.id, action: "REVENUE_SETTINGS_UPDATED" },
        }),
      ).toBe(0);
    } finally {
      release();
    }
    await holder;
    expect((await write).statusCode).toBe(200);
    expect(await revenue.getSettings()).toEqual({
      defaultCreatorRevenueShareBps: 0,
      payoutThresholdMicros: "300000000",
    });
    expect(
      await prisma.adminAuditLog.count({
        where: { actorAccountId: finance.user.account.id, action: "REVENUE_SETTINGS_UPDATED" },
      }),
    ).toBe(1);
  });
});
