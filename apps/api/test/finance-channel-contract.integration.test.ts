import "reflect-metadata";
import { createPrismaClient, Prisma } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { AdminGovernanceService } from "../src/admin/admin-governance.service.js";
import { assertAdminFinanceAuthority } from "../src/revenue/admin-finance-authority.js";
import { enrollTestMfa } from "./mfa-test-helper.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
databaseDescribe("Finance contract/channel atomic aggregate", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "contract-transaction-test-secret-with-more-than-32-characters";
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
  async function register(suffix: string) {
    const result = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Actual contract actor",
        email: `contract-${suffix}@example.com`,
        password: "strong-pass-123",
      },
    });
    expect(result.statusCode).toBe(201);
    const cookies = result.headers["set-cookie"];
    const cookie = (Array.isArray(cookies) ? cookies[0] : cookies)?.split(";", 1)[0];
    if (!cookie) throw Error("Expected actual session");
    return { user: result.json().user, cookie: (await enrollTestMfa(app, cookie)).cookie };
  }
  async function finance(suffix: string) {
    const actor = await register(suffix);
    await prisma.adminRoleAssignment.create({
      data: { accountId: actor.user.account.id, role: "FINANCE_MANAGER" },
    });
    return actor;
  }
  function create(cookie: string, channelId: string, share: number) {
    return app.inject({
      method: "POST",
      url: `/admin/revenue/channels/${channelId}/contracts`,
      headers: { cookie },
      payload: {
        revenueShareBps: share,
        status: "ACTIVE",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
      },
    });
  }
  for (const action of ["contract", "import", "adjustment"] as const)
    it.each(["role", "account"] as const)(
      `rejects ${action} when %s revocation wins before its authority lock`,
      async (revoke) => {
        const actor = await finance(`authority-${action}-${revoke}`);
        const accountId = actor.user.account.id;
        const channelId = actor.user.channel.id;
        const initialContracts = await prisma.creatorContract.count({ where: { channelId } });
        let acquired!: () => void, release!: () => void;
        const ready = new Promise<void>((resolve) => (acquired = resolve));
        const gate = new Promise<void>((resolve) => (release = resolve));
        const holder = prisma.$transaction(
          async (tx) => {
            // Guards read the committed active account. The baseline eventually
            // waits on the audit FK; the authority fence waits before any write.
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "Account" WHERE "id" = ${accountId}::uuid FOR UPDATE`,
            );
            acquired();
            await gate;
            if (revoke === "role")
              await tx.adminRoleAssignment.deleteMany({ where: { accountId } });
            else
              await tx.account.update({ where: { id: accountId }, data: { status: "SUSPENDED" } });
          },
          { timeout: 15000 },
        );
        await ready;
        const requested = Promise.allSettled([
          action === "contract"
            ? Promise.resolve(create(actor.cookie, channelId, 6000))
            : Promise.resolve(
                app.inject({
                  method: "POST",
                  url:
                    action === "import" ? "/admin/revenue/imports" : "/admin/revenue/adjustments",
                  headers: { cookie: actor.cookie },
                  payload:
                    action === "import"
                      ? {
                          source: `isolated-authority-${accountId}`,
                          entries: [
                            {
                              idempotencyKey: "isolated-authority-row",
                              channelId,
                              periodStart: "2026-09-01T00:00:00Z",
                              periodEnd: "2026-10-01T00:00:00Z",
                              grossAmount: "100.000000",
                              currency: "USD",
                              state: "FINAL",
                            },
                          ],
                        }
                      : {
                          channelId,
                          amount: "60.000000",
                          currency: "USD",
                          reason: "Isolated reviewed financial adjustment",
                        },
                }),
              ),
        ]);
        let observationFailure: unknown;
        try {
          await vi.waitFor(
            async () => {
              const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
              SELECT count(*)::bigint AS count FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'
                AND (query LIKE '%INSERT INTO%"AdminAuditLog"%'
                  OR query LIKE '%SELECT "id" FROM "Account"%FOR SHARE%')
            `);
              expect(Number(rows[0]?.count ?? 0)).toBe(1);
            },
            { timeout: 4000, interval: 25 },
          );
        } catch (error) {
          observationFailure = error;
        } finally {
          release();
          await holder;
        }
        const [result] = await requested;
        if (observationFailure) throw observationFailure;
        if (result?.status !== "fulfilled") throw new Error("Financial request did not complete.");
        expect(result.value.statusCode).toBe(403);
        expect(await prisma.creatorContract.count({ where: { channelId } })).toBe(initialContracts);
        expect(await prisma.earningsLedgerEntry.count({ where: { channelId } })).toBe(0);
        expect(
          await prisma.adminAuditLog.count({
            where: {
              actorAccountId: accountId,
              action: {
                in: ["CREATOR_CONTRACT_CREATED", "REVENUE_IMPORTED", "REVENUE_ADJUSTMENT_CREATED"],
              },
            },
          }),
        ).toBe(0);
      },
    );
  it("serializes real staff revocation before the finance account/role fence without a deadlock", async () => {
    const root = await finance("governance-root");
    await prisma.adminRoleAssignment.create({
      data: { accountId: root.user.account.id, role: "SUPERADMIN" },
    });
    const actor = await finance("governance-target");
    const accountId = actor.user.account.id;
    // Fixture-generated UUID is the only interpolation into this test-only DDL.
    expect(accountId).toMatch(/^[0-9a-f-]{36}$/);
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ayin_test_finance_role_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(9816672234::bigint); RETURN OLD; END; $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ayin_test_finance_role_gate AFTER DELETE ON "AdminRoleAssignment" FOR EACH ROW WHEN (OLD."accountId" = '${accountId}'::uuid) EXECUTE FUNCTION ayin_test_finance_role_gate()`,
    );
    let release!: () => void, acquired!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const ready = new Promise<void>((resolve) => (acquired = resolve));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(9816672234::bigint)::text`);
        acquired();
        await gate;
      },
      { timeout: 15000 },
    );
    await ready;
    const revoked = Promise.allSettled([
      app
        .get(AdminGovernanceService)
        .setStaffRoles(
          root.user.account.id,
          accountId,
          [],
          "Isolated financial lock-order regression",
        ),
    ]);
    let authority: Promise<PromiseSettledResult<void>[]> | undefined;
    let observationFailure: unknown;
    try {
      await vi.waitFor(
        async () => {
          const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
          SELECT count(*)::bigint AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%DELETE FROM%"AdminRoleAssignment"%'
        `);
          expect(Number(rows[0]?.count ?? 0)).toBe(1);
        },
        { timeout: 4000, interval: 25 },
      );
      authority = Promise.allSettled([
        prisma.$transaction(async (tx) => {
          await assertAdminFinanceAuthority(tx, accountId);
        }),
      ]);
      await vi.waitFor(
        async () => {
          const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
          SELECT count(*)::bigint AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND (query LIKE '%SELECT "id" FROM "Account"%FOR SHARE%'
              OR query LIKE '%SELECT "id" FROM "AdminRoleAssignment"%FOR SHARE%')
        `);
          expect(Number(rows[0]?.count ?? 0)).toBe(1);
        },
        { timeout: 4000, interval: 25 },
      );
    } catch (error) {
      observationFailure = error;
    } finally {
      release();
      await holder;
    }
    const [revocation] = await revoked;
    const [authorization] = (await authority) ?? [];
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS ayin_test_finance_role_gate ON "AdminRoleAssignment"',
    );
    await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS ayin_test_finance_role_gate()");
    if (observationFailure) throw observationFailure;
    expect(revocation?.status).toBe("fulfilled");
    expect(authorization?.status).toBe("rejected");
    if (authorization?.status === "rejected") expect(authorization.reason.getStatus?.()).toBe(403);
    expect(await prisma.adminRoleAssignment.count({ where: { accountId } })).toBe(0);
  });
  it("waits for the actual channel row and advances the observed aggregate monotonically for concurrent Finance contracts", async () => {
    const actor = await finance("race");
    const channelId = actor.user.channel.id;
    const original = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
    const initialContracts = await prisma.creatorContract.count({ where: { channelId } });
    const heldVersion = new Date(original.updatedAt.getTime() + 1000);
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
        await tx.channel.update({ where: { id: channelId }, data: { updatedAt: heldVersion } });
      },
      { timeout: 15000 },
    );
    await ready;
    const first = Promise.resolve(create(actor.cookie, channelId, 0));
    const second = Promise.resolve(create(actor.cookie, channelId, 3210));
    try {
      await vi.waitFor(
        async () => {
          const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(
            Prisma.sql`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%ayin-contract-write-lock%'`,
          );
          expect(Number(rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(2);
        },
        { timeout: 4000, interval: 25 },
      );
      expect(await prisma.creatorContract.count({ where: { channelId } })).toBe(initialContracts);
    } finally {
      release();
    }
    await holder;
    const responses = await Promise.all([first, second]);
    expect(responses.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(responses.map((r) => r.json().revenueShareBps)).toEqual([0, 3210]);
    expect(await prisma.creatorContract.count({ where: { channelId } })).toBe(initialContracts + 2);
    expect(
      await prisma.adminAuditLog.count({
        where: { actorAccountId: actor.user.account.id, action: "CREATOR_CONTRACT_CREATED" },
      }),
    ).toBe(2);
    const after = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(heldVersion.getTime() + 2);
    expect(after.name).toBe(original.name);
  });
  it("rolls back the actual contract and aggregate version when its audit insertion fails", async () => {
    const actor = await finance("rollback"),
      channelId = actor.user.channel.id;
    const before = await prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
    const initialContracts = await prisma.creatorContract.count({ where: { channelId } });
    await prisma.$executeRawUnsafe(
      "CREATE FUNCTION ayin_test_contract_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'CREATOR_CONTRACT_CREATED' THEN RAISE EXCEPTION 'test contract audit failure'; END IF; RETURN NEW; END; $$",
    );
    try {
      await prisma.$executeRawUnsafe(
        'CREATE TRIGGER ayin_test_contract_audit_failure BEFORE INSERT ON "AdminAuditLog" FOR EACH ROW EXECUTE FUNCTION ayin_test_contract_audit_failure()',
      );
      expect((await create(actor.cookie, channelId, 0)).statusCode).toBe(500);
      expect(await prisma.creatorContract.count({ where: { channelId } })).toBe(initialContracts);
      expect(
        await prisma.adminAuditLog.count({ where: { action: "CREATOR_CONTRACT_CREATED" } }),
      ).toBe(0);
      expect(
        (await prisma.channel.findUniqueOrThrow({ where: { id: channelId } })).updatedAt,
      ).toEqual(before.updatedAt);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS ayin_test_contract_audit_failure ON "AdminAuditLog"',
      );
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS ayin_test_contract_audit_failure()");
    }
    const saved = await create(actor.cookie, channelId, 0);
    expect(saved.statusCode).toBe(201);
    expect(await prisma.creatorContract.count({ where: { channelId } })).toBe(initialContracts + 1);
    expect(
      await prisma.adminAuditLog.count({
        where: { action: "CREATOR_CONTRACT_CREATED", entityId: saved.json().id },
      }),
    ).toBe(1);
    expect(
      (await prisma.channel.findUniqueOrThrow({ where: { id: channelId } })).updatedAt.getTime(),
    ).toBeGreaterThan(before.updatedAt.getTime());
  });
  it("keeps Finance scope and returns safe invalid/missing-channel failures without writes", async () => {
    const creator = await register("denied");
    expect((await create(creator.cookie, creator.user.channel.id, 0)).statusCode).toBe(403);
    const actor = await finance("invalid");
    const initialContracts = await prisma.creatorContract.count();
    expect((await create(actor.cookie, "invalid-id", 0)).statusCode).toBe(400);
    expect((await create(actor.cookie, "00000000-0000-4000-8000-000000000000", 0)).statusCode).toBe(
      404,
    );
    expect((await create(actor.cookie, actor.user.channel.id, 10001)).statusCode).toBe(400);
    expect(await prisma.creatorContract.count()).toBe(initialContracts);
    expect(
      await prisma.adminAuditLog.count({ where: { action: "CREATOR_CONTRACT_CREATED" } }),
    ).toBe(0);
  });
});
