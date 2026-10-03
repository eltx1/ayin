import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient, Prisma } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { encryptPayoutDestination } from "../src/revenue/creator-finance.crypto.js";
import {
  EXTERNAL_PAYOUT_PROVIDER_ADAPTER,
  type ExternalPayoutProviderAdapter,
} from "../src/revenue/external-payout-provider.adapter.js";
import { enrollTestMfa } from "./mfa-test-helper.js";
const databaseUrl = process.env.TEST_DATABASE_URL,
  databaseDescribe = databaseUrl ? describe : describe.skip;
databaseDescribe("Private payout provider HTTP contracts", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication, adapter: ExternalPayoutProviderAdapter;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "payout-provider-privacy-secret-with-more-than-32-characters";
    process.env.DATABASE_URL = databaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    process.env.PAYOUT_DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    adapter = module.get(EXTERNAL_PAYOUT_PROVIDER_ADAPTER);
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
    const r = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Provider privacy actor",
        email: `provider-privacy-${randomUUID()}@example.com`,
        password: "strong-pass-123",
      },
    });
    expect(r.statusCode).toBe(201);
    const user = r.json().user,
      cookies = r.headers["set-cookie"];
    const cookie = (Array.isArray(cookies) ? cookies[0] : cookies)?.split(";", 1)[0];
    if (!cookie) throw Error("Expected actual session");
    await prisma.adminRoleAssignment.create({ data: { accountId: user.account.id, role } });
    return { user, cookie: (await enrollTestMfa(app, cookie)).cookie };
  }
  const secret = "IMMUTABLE provider privacy bank instruction 123456";
  async function payout(channelId: string) {
    return prisma.payout.create({
      data: {
        channelId,
        provider: "UNCONFIGURED_EXTERNAL",
        status: "PENDING",
        amount: "1.000001",
        currency: "USD",
        legalNameSnapshot: "Immutable provider beneficiary",
        destinationEncryptedSnapshot: encryptPayoutDestination(secret),
        providerDestinationTokenEncryptedSnapshot:
          encryptPayoutDestination("PRIVATE_PROVIDER_TOKEN"),
      },
    });
  }
  it("returns only private safe transfer facts and rejects malformed/missing/unauthorized reads without side effects", async () => {
    const finance = await actor(),
      operations = await actor("OPERATIONS"),
      row = await payout(finance.user.channel.id);
    const submit = vi.spyOn(adapter, "submitTransfer"),
      status = vi.spyOn(adapter, "retrieveTransferStatus"),
      cancel = vi.spyOn(adapter, "cancelTransfer");
    const transfer = await prisma.payoutProviderTransfer.create({
      data: {
        payoutId: row.id,
        provider: row.provider,
        idempotencyKey: `PRIVATE_STABLE_KEY_${randomUUID()}`,
        state: "SUBMISSION_UNKNOWN",
        submitAttempts: 0,
        lastErrorCode: "CONTROLLED_ERROR",
        lastErrorMessage: "RAW_PROVIDER_ERROR_MUST_NOT_REACH_BROWSER",
      },
    });
    const r = await app.inject({
      method: "GET",
      url: `/admin/revenue/payouts/${row.id}/provider`,
      headers: { cookie: finance.cookie },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toContain("private");
    expect(r.headers["cache-control"]).toContain("no-store");
    expect(r.headers.pragma).toBe("no-cache");
    expect(r.json()).toMatchObject({
      payout: { id: row.id, amount: "1.000001", provider: row.provider },
      transfer: {
        id: transfer.id,
        payoutId: row.id,
        submitAttempts: 0,
        state: "SUBMISSION_UNKNOWN",
      },
    });
    for (const value of [
      secret,
      "destinationEncrypted",
      "providerDestinationToken",
      transfer.idempotencyKey,
      "RAW_PROVIDER_ERROR",
      "lastErrorMessage",
    ])
      expect(r.body).not.toContain(value);
    const capabilities = await app.inject({
      method: "GET",
      url: "/admin/revenue/payout-provider/capabilities",
      headers: { cookie: finance.cookie },
    });
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.headers["cache-control"]).toContain("no-store");
    for (const [target, code] of [
      ["bad-id", 400],
      [randomUUID(), 404],
    ] as const)
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/admin/revenue/payouts/${target}/provider`,
            headers: { cookie: finance.cookie },
          })
        ).statusCode,
      ).toBe(code);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/admin/revenue/payouts/${row.id}/provider`,
          headers: { cookie: operations.cookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: "GET", url: `/admin/revenue/payouts/${row.id}/provider` }))
        .statusCode,
    ).toBe(401);
    expect(await prisma.adminAuditLog.count({ where: { entityId: row.id } })).toBe(0);
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      "PENDING",
    );
    expect(submit).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });
  it("cancels an unsubmitted reservation once with a safe acknowledgment and no external provider activation", async () => {
    const finance = await actor(),
      row = await payout(finance.user.channel.id),
      cancel = vi.spyOn(adapter, "cancelTransfer");
    const ledger = await prisma.earningsLedgerEntry.create({
      data: {
        channelId: row.channelId,
        type: "AD_REVENUE",
        state: "FINAL",
        amount: row.amount,
        currency: "USD",
        payoutId: row.id,
      },
    });
    const r = await app.inject({
      method: "POST",
      url: `/admin/revenue/payouts/${row.id}/provider/cancel`,
      headers: { cookie: finance.cookie, origin: "http://localhost:3000" },
      payload: { reason: "Cancel original unsubmitted reservation" },
    });
    expect(r.statusCode).toBe(201);
    expect(r.headers["cache-control"]).toContain("no-store");
    expect(r.headers["cache-control"]).toContain("private");
    expect(r.headers.pragma).toBe("no-cache");
    expect(r.json()).toMatchObject({
      payout: { id: row.id, provider: row.provider, amount: "1.000001", status: "CANCELLED" },
      transfer: null,
    });
    for (const value of [
      secret,
      "destinationEncrypted",
      "legalNameSnapshot",
      "providerDestinationToken",
      "PRIVATE_PROVIDER_TOKEN",
    ])
      expect(r.body).not.toContain(value);
    expect(
      (await prisma.earningsLedgerEntry.findUniqueOrThrow({ where: { id: ledger.id } })).payoutId,
    ).toBeNull();
    expect(
      await prisma.adminAuditLog.count({
        where: { entityId: row.id, action: "payout.provider_cancelled_before_submission" },
      }),
    ).toBe(1);
    expect(await prisma.payoutProviderTransfer.count({ where: { payoutId: row.id } })).toBe(0);
    expect(cancel).not.toHaveBeenCalled();
  });
  for (const change of ["STATUS", "ROLE", "ACCOUNT", "TRANSFER"] as const) {
    it(`rejects a waiting local cancellation after a winning ${change} change`, async () => {
      const finance = await actor(),
        row = await payout(finance.user.channel.id);
      const ledger = await prisma.earningsLedgerEntry.create({
        data: {
          channelId: row.channelId,
          type: "AD_REVENUE",
          state: "FINAL",
          amount: row.amount,
          currency: "USD",
          payoutId: row.id,
        },
      });
      if (change === "TRANSFER")
        await prisma.payoutProviderTransfer.create({
          data: {
            payoutId: row.id,
            provider: row.provider,
            idempotencyKey: `controlled-transfer-${randomUUID()}`,
            state: "READY",
          },
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
            Prisma.sql`SELECT "id" FROM "Payout" WHERE "id" = ${row.id}::uuid FOR UPDATE`,
          );
          acquired();
          await gate;
          if (change === "TRANSFER")
            await tx.payoutProviderTransfer.update({
              where: { payoutId: row.id },
              data: { state: "SUBMITTED", externalTransferId: "controlled-already-submitted" },
            });
          if (change === "STATUS")
            await tx.payout.update({
              where: { id: row.id },
              data: { status: "PAID", paidAt: new Date() },
            });
        },
        { timeout: 15000 },
      );
      await locked;
      const request = Promise.resolve(
        app.inject({
          method: "POST",
          url: `/admin/revenue/payouts/${row.id}/provider/cancel`,
          headers: { cookie: finance.cookie, origin: "http://localhost:3000" },
          payload: { reason: "Cancel original pending reservation" },
        }),
      );
      try {
        await vi.waitFor(
          async () => {
            const waiting = await prisma.$queryRaw<Array<{ count: bigint }>>(
              Prisma.sql`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%ayin-provider-cancel-lock%'`,
            );
            expect(Number(waiting[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);
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
      expect(response.statusCode).toBe(change === "STATUS" || change === "TRANSFER" ? 409 : 403);
      expect(response.body).not.toContain(secret);
      expect((await prisma.payout.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
        change === "STATUS" ? "PAID" : "PENDING",
      );
      expect(
        (await prisma.earningsLedgerEntry.findUniqueOrThrow({ where: { id: ledger.id } })).payoutId,
      ).toBe(row.id);
      expect(await prisma.adminAuditLog.count({ where: { entityId: row.id } })).toBe(0);
      expect(await prisma.payoutProviderTransfer.count({ where: { payoutId: row.id } })).toBe(
        change === "TRANSFER" ? 1 : 0,
      );
      if (change === "TRANSFER")
        expect(
          (await prisma.payoutProviderTransfer.findUniqueOrThrow({ where: { payoutId: row.id } }))
            .state,
        ).toBe("SUBMITTED");
    });
  }
  it("rolls back payout and ledger when the actual cancellation audit cannot commit, then explicitly recovers once", async () => {
    const finance = await actor(),
      row = await payout(finance.user.channel.id);
    const ledger = await prisma.earningsLedgerEntry.create({
      data: {
        channelId: row.channelId,
        type: "AD_REVENUE",
        state: "FINAL",
        amount: row.amount,
        currency: "USD",
        payoutId: row.id,
      },
    });
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ayin_test_reject_provider_cancel_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'payout.provider_cancelled_before_submission' THEN RAISE EXCEPTION 'Controlled cancellation audit failure'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ayin_test_provider_cancel_audit BEFORE INSERT ON "AdminAuditLog" FOR EACH ROW EXECUTE FUNCTION ayin_test_reject_provider_cancel_audit()`,
    );
    try {
      const response = await app.inject({
        method: "POST",
        url: `/admin/revenue/payouts/${row.id}/provider/cancel`,
        headers: { cookie: finance.cookie, origin: "http://localhost:3000" },
        payload: { reason: "Cancel original reservation with audit" },
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain(secret);
      expect((await prisma.payout.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
        "PENDING",
      );
      expect(
        (await prisma.earningsLedgerEntry.findUniqueOrThrow({ where: { id: ledger.id } })).payoutId,
      ).toBe(row.id);
      expect(await prisma.adminAuditLog.count({ where: { entityId: row.id } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER ayin_test_provider_cancel_audit ON "AdminAuditLog"',
      );
      await prisma.$executeRawUnsafe("DROP FUNCTION ayin_test_reject_provider_cancel_audit()");
    }
    const recovered = await app.inject({
      method: "POST",
      url: `/admin/revenue/payouts/${row.id}/provider/cancel`,
      headers: { cookie: finance.cookie, origin: "http://localhost:3000" },
      payload: { reason: "Explicitly cancel original reservation after audit recovery" },
    });
    expect(recovered.statusCode).toBe(201);
    expect(
      await prisma.adminAuditLog.count({
        where: { entityId: row.id, action: "payout.provider_cancelled_before_submission" },
      }),
    ).toBe(1);
    expect(
      (await prisma.earningsLedgerEntry.findUniqueOrThrow({ where: { id: ledger.id } })).payoutId,
    ).toBeNull();
  });
});
