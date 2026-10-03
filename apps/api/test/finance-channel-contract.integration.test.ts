import "reflect-metadata";
import { createPrismaClient, Prisma } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
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
