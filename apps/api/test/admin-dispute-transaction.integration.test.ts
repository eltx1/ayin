import "reflect-metadata";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { enrollTestMfa } from "./mfa-test-helper.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
databaseDescribe("Admin dispute/audit transaction", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET =
      "admin-dispute-transaction-test-secret-with-more-than-32-characters";
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
  async function register(suffix: string, finance = false) {
    const result = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Actual dispute actor",
        email: `admin-dispute-${suffix}@example.com`,
        password: "strong-pass-123",
      },
    });
    expect(result.statusCode).toBe(201);
    const user = result.json().user;
    const cookies = result.headers["set-cookie"];
    const cookie = (Array.isArray(cookies) ? cookies[0] : cookies)?.split(";", 1)[0];
    if (!cookie) throw Error("Expected actual session");
    if (finance)
      await prisma.adminRoleAssignment.create({
        data: { accountId: user.account.id, role: "FINANCE_MANAGER" },
      });
    return { user, cookie: (await enrollTestMfa(app, cookie)).cookie };
  }
  async function fixture(suffix: string) {
    const creator = await register(`creator-${suffix}`),
      finance = await register(`finance-${suffix}`, true);
    const created = await app.inject({
      method: "POST",
      url: "/creator/studio/revenue/disputes",
      headers: { cookie: creator.cookie },
      payload: {
        category: "EARNINGS",
        message: "Actual creator dispute awaiting an audited finance decision.",
      },
    });
    expect(created.statusCode).toBe(201);
    const original = await prisma.revenueDispute.findUniqueOrThrow({
      where: { id: created.json().id },
    });
    return { creator, finance, original };
  }
  function decide(cookie: string, id: string, status = "RESOLVED") {
    return app.inject({
      method: "PATCH",
      url: `/admin/revenue/disputes/${id}`,
      headers: { cookie },
      payload: {
        status,
        resolution: "Actual finance review resolved the isolated creator dispute.",
        reason: "Actual independently reviewed finance decision",
      },
    });
  }
  it("rolls back all dispute decision fields and suppresses notification when the actual audit insert fails", async () => {
    const { creator, finance, original } = await fixture("rollback");
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ayin_test_admin_dispute_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."action" = 'revenue.dispute_updated' THEN RAISE EXCEPTION 'isolated admin dispute audit failure'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER ayin_test_admin_dispute_audit_failure BEFORE INSERT ON "AdminAuditLog" FOR EACH ROW EXECUTE FUNCTION ayin_test_admin_dispute_audit_failure()',
    );
    try {
      expect((await decide(finance.cookie, original.id)).statusCode).toBe(500);
      expect(await prisma.revenueDispute.findUniqueOrThrow({ where: { id: original.id } })).toEqual(
        original,
      );
      expect(
        await prisma.adminAuditLog.count({
          where: { action: "revenue.dispute_updated", entityId: original.id },
        }),
      ).toBe(0);
      expect(
        await prisma.notification.count({
          where: { accountId: creator.user.account.id, title: "Revenue dispute resolved" },
        }),
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS ayin_test_admin_dispute_audit_failure ON "AdminAuditLog"',
      );
      await prisma.$executeRawUnsafe(
        "DROP FUNCTION IF EXISTS ayin_test_admin_dispute_audit_failure()",
      );
    }
    const recovered = await decide(finance.cookie, original.id);
    expect(recovered.statusCode).toBe(200);
    const stored = await prisma.revenueDispute.findUniqueOrThrow({ where: { id: original.id } });
    expect(stored).toMatchObject({
      status: "RESOLVED",
      resolvedByAccountId: finance.user.account.id,
      resolution: "Actual finance review resolved the isolated creator dispute.",
    });
    expect(stored.resolvedAt).not.toBeNull();
    expect(
      await prisma.adminAuditLog.count({
        where: {
          action: "revenue.dispute_updated",
          entityId: original.id,
          actorAccountId: finance.user.account.id,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.notification.count({
        where: { accountId: creator.user.account.id, title: "Revenue dispute resolved" },
      }),
    ).toBe(1);
  });
  it("retains reopening semantics and correlates both committed decisions with their actual audit", async () => {
    const { finance, original } = await fixture("reopen");
    expect((await decide(finance.cookie, original.id)).statusCode).toBe(200);
    expect((await decide(finance.cookie, original.id, "REVIEWING")).statusCode).toBe(200);
    const stored = await prisma.revenueDispute.findUniqueOrThrow({ where: { id: original.id } });
    expect(stored).toMatchObject({
      status: "REVIEWING",
      resolvedByAccountId: null,
      resolvedAt: null,
    });
    const logs = await prisma.adminAuditLog.findMany({
      where: {
        action: "revenue.dispute_updated",
        entityId: original.id,
        actorAccountId: finance.user.account.id,
      },
    });
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => (l.metadata as { status: string }).status).sort()).toEqual([
      "RESOLVED",
      "REVIEWING",
    ]);
    expect(logs.every((l) => l.reason === "Actual independently reviewed finance decision")).toBe(
      true,
    );
  });
  it("denies the actual creator and Operations scope without modifying the dispute or audit", async () => {
    const { creator, original } = await fixture("scope");
    const operations = await register("operations");
    await prisma.adminRoleAssignment.create({
      data: { accountId: operations.user.account.id, role: "OPERATIONS" },
    });
    expect((await decide(creator.cookie, original.id)).statusCode).toBe(403);
    expect((await decide(operations.cookie, original.id)).statusCode).toBe(403);
    expect(await prisma.revenueDispute.findUniqueOrThrow({ where: { id: original.id } })).toEqual(
      original,
    );
    expect(
      await prisma.adminAuditLog.count({
        where: { action: "revenue.dispute_updated", entityId: original.id },
      }),
    ).toBe(0);
  });
});
