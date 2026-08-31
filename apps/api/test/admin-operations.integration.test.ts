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

databaseDescribe("Admin operations, support and monetization governance", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "admin-operations-test-secret-with-more-than-32-characters";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
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

  async function grant(accountId: string, role: string) {
    await prisma.adminRoleAssignment.create({ data: { accountId, role } });
  }

  it("isolates scoped staff roles while privileged admins retain control-plane access", async () => {
    const finance = await register("Finance", "finance-role@example.com");
    const operations = await register("Operations", "operations-role@example.com");
    const admin = await register("Admin", "privileged-admin@example.com");
    await grant(finance.user.account.id, "FINANCE_MANAGER");
    await grant(operations.user.account.id, "OPERATIONS");
    await grant(admin.user.account.id, "ADMIN");

    const financeSummary = await app.inject({
      method: "GET",
      url: "/admin/revenue/finance-summary",
      headers: { cookie: finance.cookie },
    });
    expect(financeSummary.statusCode).toBe(200);

    const financeOperations = await app.inject({
      method: "GET",
      url: "/admin/operations/roles",
      headers: { cookie: finance.cookie },
    });
    expect(financeOperations.statusCode).toBe(403);

    const operationsRoles = await app.inject({
      method: "GET",
      url: "/admin/operations/roles",
      headers: { cookie: operations.cookie },
    });
    expect(operationsRoles.statusCode).toBe(200);

    const operationsFinance = await app.inject({
      method: "GET",
      url: "/admin/revenue/finance-summary",
      headers: { cookie: operations.cookie },
    });
    expect(operationsFinance.statusCode).toBe(403);

    const adminHealth = await app.inject({
      method: "GET",
      url: "/admin/control/health",
      headers: { cookie: admin.cookie },
    });
    expect(adminHealth.statusCode).toBe(200);
    expect(adminHealth.json().backgroundProcessing).toMatchObject({
      queues: { status: "NOT_CONFIGURED" },
      workers: { status: "NOT_CONFIGURED" },
    });
    expect(adminHealth.json().mediaStorage.directUploadArchitecture).toBe(true);
  });

  it("lets only superadmin change staff roles and revokes existing sessions", async () => {
    const superadmin = await register("Superadmin", "superadmin-role@example.com");
    const operations = await register("Operations", "role-editor@example.com");
    const target = await register("Target", "staff-target@example.com");
    await grant(superadmin.user.account.id, "SUPERADMIN");
    await grant(operations.user.account.id, "OPERATIONS");

    const forbidden = await app.inject({
      method: "PATCH",
      url: `/admin/operations/staff/${target.user.account.id}/roles`,
      headers: { cookie: operations.cookie },
      payload: { roles: ["FINANCE_MANAGER"], reason: "Finance access assignment" },
    });
    expect(forbidden.statusCode).toBe(403);

    const before = await prisma.account.findUniqueOrThrow({
      where: { id: target.user.account.id },
    });
    const updated = await app.inject({
      method: "PATCH",
      url: `/admin/operations/staff/${target.user.account.id}/roles`,
      headers: { cookie: superadmin.cookie },
      payload: { roles: ["FINANCE_MANAGER"], reason: "Finance access assignment" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      accountId: target.user.account.id,
      roles: ["FINANCE_MANAGER"],
      sessionsRevoked: true,
    });

    const after = await prisma.account.findUniqueOrThrow({ where: { id: target.user.account.id } });
    expect(after.authVersion).toBe(before.authVersion + 1);
    expect(
      await prisma.adminRoleAssignment.findMany({ where: { accountId: target.user.account.id } }),
    ).toEqual([expect.objectContaining({ role: "FINANCE_MANAGER" })]);
    expect(
      await prisma.adminAuditLog.findFirst({
        where: { action: "staff.roles_updated", entityId: target.user.account.id },
      }),
    ).toMatchObject({ reason: "Finance access assignment" });
  });

  it("runs creator support through an audited operations lifecycle", async () => {
    const creator = await register("Creator", "support-creator@example.com");
    const operations = await register("Support Ops", "support-ops@example.com");
    await grant(operations.user.account.id, "OPERATIONS");

    const created = await app.inject({
      method: "POST",
      url: "/support/tickets",
      headers: { cookie: creator.cookie },
      payload: {
        category: "MONETIZATION",
        priority: "HIGH",
        subject: "Revenue statement question",
        description: "Please review the finalized revenue shown in my creator statement.",
      },
    });
    expect(created.statusCode).toBe(201);
    const ticket = created.json();

    const queue = await app.inject({
      method: "GET",
      url: "/admin/operations/support?status=OPEN&priority=HIGH",
      headers: { cookie: operations.cookie },
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().items).toEqual([expect.objectContaining({ id: ticket.id })]);

    const resolved = await app.inject({
      method: "PATCH",
      url: `/admin/operations/support/${ticket.id}`,
      headers: { cookie: operations.cookie },
      payload: {
        status: "RESOLVED",
        resolution: "The statement is based on finalized ledger entries and is correct.",
        reason: "Creator statement reviewed and reconciled",
      },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().status).toBe("RESOLVED");

    const creatorTickets = await app.inject({
      method: "GET",
      url: "/support/tickets",
      headers: { cookie: creator.cookie },
    });
    expect(creatorTickets.statusCode).toBe(200);
    expect(creatorTickets.json().items[0]).toMatchObject({
      id: ticket.id,
      status: "RESOLVED",
    });
    expect(
      await prisma.adminAuditLog.findFirst({
        where: { action: "support.ticket_updated", entityId: ticket.id },
      }),
    ).not.toBeNull();
  });

  it("creates in-app monetization notifications when a revenue dispute changes", async () => {
    const creator = await register("Revenue Creator", "revenue-notify@example.com");
    const finance = await register("Finance Reviewer", "finance-reviewer@example.com");
    await grant(finance.user.account.id, "FINANCE_MANAGER");

    const created = await app.inject({
      method: "POST",
      url: "/creator/studio/revenue/disputes",
      headers: { cookie: creator.cookie },
      payload: {
        category: "EARNINGS",
        message: "The finalized earnings total needs a finance review before the next payout.",
      },
    });
    expect(created.statusCode).toBe(201);
    const dispute = created.json();

    const openedNotification = await prisma.notification.findFirst({
      where: {
        accountId: creator.user.account.id,
        type: "MONETIZATION",
        title: "Revenue dispute opened",
      },
    });
    expect(openedNotification).not.toBeNull();

    const resolved = await app.inject({
      method: "PATCH",
      url: `/admin/revenue/disputes/${dispute.id}`,
      headers: { cookie: finance.cookie },
      payload: {
        status: "RESOLVED",
        resolution: "Finance reconciled the ledger and confirmed the finalized earnings total.",
        reason: "Ledger reconciliation completed successfully",
      },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().status).toBe("RESOLVED");

    const notifications = await prisma.notification.findMany({
      where: { accountId: creator.user.account.id, type: "MONETIZATION" },
      orderBy: { createdAt: "asc" },
    });
    expect(notifications.map((item) => item.title)).toEqual(
      expect.arrayContaining(["Revenue dispute opened", "Revenue dispute resolved"]),
    );
  });
});
