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
  if (!value) {
    throw new Error("Expected a session cookie.");
  }
  return value.split(";", 1)[0] ?? value;
}

databaseDescribe("Task 04 platform settings and admin authorization", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-04-test-auth-secret-with-more-than-32-characters";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";

    moduleReference = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleReference.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account" CASCADE');
    await prisma.platformSetting.deleteMany();
    await prisma.featureFlag.deleteMany();
    await prisma.adminAuditLog.deleteMany();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function register(email: string) {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name: "Admin Test", email, password: "strong-pass-123" },
    });
    expect(response.statusCode).toBe(201);
    return {
      accountId: response.json().user.account.id as string,
      cookie: cookiePair(response.headers["set-cookie"]),
    };
  }

  async function grant(accountId: string, role: "ADMIN" | "SUPERADMIN") {
    await prisma.adminRoleAssignment.create({ data: { accountId, role } });
  }

  it("rejects a settings mutation from a non-admin account", async () => {
    const user = await register("viewer@example.com");
    const response = await app.inject({
      method: "PATCH",
      url: "/admin/settings/defaultCommentsEnabled",
      headers: { cookie: user.cookie },
      payload: { value: false },
    });
    expect(response.statusCode).toBe(403);
  });

  it("allows ADMIN to change a validated ordinary setting", async () => {
    const admin = await register("admin@example.com");
    await grant(admin.accountId, "ADMIN");

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/settings/defaultCommentsEnabled",
      headers: { cookie: admin.cookie },
      payload: { value: false },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().value).toBe(false);

    const stored = await prisma.platformSetting.findUnique({
      where: { namespace_key: { namespace: "CREATOR", key: "defaultCommentsEnabled" } },
    });
    expect(stored?.value).toBe(false);
  });

  it("rejects an invalid typed setting value", async () => {
    const admin = await register("invalid@example.com");
    await grant(admin.accountId, "ADMIN");

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/settings/uploadMaxSizeBytes",
      headers: { cookie: admin.cookie },
      payload: { value: 1 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_PLATFORM_SETTING");
  });

  it("requires SUPERADMIN confirmation and audits a sensitive settings change", async () => {
    const superadmin = await register("superadmin@example.com");
    await grant(superadmin.accountId, "SUPERADMIN");

    const unconfirmed = await app.inject({
      method: "PATCH",
      url: "/admin/settings/automaticCreatorProvisioningEnabled",
      headers: { cookie: superadmin.cookie },
      payload: { value: false },
    });
    expect(unconfirmed.statusCode).toBe(400);
    expect(unconfirmed.json().error.code).toBe("HIGH_IMPACT_CONFIRMATION_REQUIRED");

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/settings/automaticCreatorProvisioningEnabled",
      headers: { cookie: superadmin.cookie },
      payload: {
        value: false,
        confirmHighImpact: true,
        reason: "Temporarily pause creator identity creation",
      },
    });
    expect(response.statusCode).toBe(200);

    const audit = await prisma.adminAuditLog.findFirst({
      where: {
        actorAccountId: superadmin.accountId,
        action: "platform_setting.updated",
        entityId: "CREATOR.automaticCreatorProvisioningEnabled",
      },
    });
    expect(audit).not.toBeNull();
    expect(audit?.reason).toContain("pause creator identity");
  });

  it("falls back to safe defaults when a setting is not stored", async () => {
    const admin = await register("fallback@example.com");
    await grant(admin.accountId, "ADMIN");
    await prisma.platformSetting.deleteMany({ where: { key: "maintenanceMode" } });

    const response = await app.inject({
      method: "GET",
      url: "/admin/settings",
      headers: { cookie: admin.cookie },
    });
    expect(response.statusCode).toBe(200);
    const settings = response
      .json()
      .sections.flatMap((section: { settings: Array<{ key: string; source: string; value: unknown }> }) =>
        section.settings,
      );
    expect(settings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "maintenanceMode", source: "default", value: false }),
      ]),
    );
  });

  it("keeps unknown feature flags disabled and allows an admin to define a validated flag", async () => {
    const admin = await register("flags@example.com");
    await grant(admin.accountId, "ADMIN");

    const missing = await prisma.featureFlag.findUnique({ where: { key: "catalog.movies" } });
    expect(missing).toBeNull();

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/feature-flags/catalog.movies",
      headers: { cookie: admin.cookie },
      payload: { enabled: true, rolloutPercentage: 100, description: "Movies navigation" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().enabled).toBe(true);
  });
});
