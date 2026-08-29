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

databaseDescribe("Task 17 Admin control plane", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-17-test-auth-secret-with-more-than-32-characters";
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

  async function grant(accountId: string) {
    await prisma.adminRoleAssignment.create({ data: { accountId, role: "ADMIN" } });
  }

  it("keeps every control-plane endpoint behind admin RBAC", async () => {
    const viewer = await register("Viewer", "control-viewer@example.com");
    const response = await app.inject({
      method: "GET",
      url: "/admin/control/dashboard",
      headers: { cookie: viewer.cookie },
    });
    expect(response.statusCode).toBe(403);
  });

  it("searches and paginates users then suspends another account with audit and session invalidation", async () => {
    const admin = await register("Admin", "control-admin@example.com");
    const target = await register("Target User", "target-person@example.com");
    await grant(admin.user.account.id);

    const list = await app.inject({
      method: "GET",
      url: "/admin/control/users?query=target&take=1&page=1",
      headers: { cookie: admin.cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(1);
    expect(list.json().pagination).toMatchObject({ page: 1, take: 1, total: 1 });

    const before = await prisma.account.findUniqueOrThrow({ where: { id: target.user.account.id } });
    const suspended = await app.inject({
      method: "PATCH",
      url: `/admin/control/users/${target.user.account.id}`,
      headers: { cookie: admin.cookie },
      payload: { status: "SUSPENDED", reason: "Repeated platform abuse review" },
    });
    expect(suspended.statusCode).toBe(200);
    expect(suspended.json().status).toBe("SUSPENDED");

    const after = await prisma.account.findUniqueOrThrow({ where: { id: target.user.account.id } });
    expect(after.authVersion).toBe(before.authVersion + 1);
    const audit = await prisma.adminAuditLog.findFirst({
      where: { actorAccountId: admin.user.account.id, action: "account.status_updated", entityId: target.user.account.id },
    });
    expect(audit?.reason).toBe("Repeated platform abuse review");
  });

  it("manages video and TV state and records safe bulk actions", async () => {
    const admin = await register("Ops Admin", "ops-admin@example.com");
    const creator = await register("Creator", "ops-creator@example.com");
    await grant(admin.user.account.id);
    const video = await prisma.video.create({
      data: {
        channelId: creator.user.channel.id,
        slug: "admin-control-video",
        title: "Admin Control Video",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt: new Date(),
      },
    });

    const update = await app.inject({
      method: "PATCH",
      url: `/admin/control/videos/${video.id}`,
      headers: { cookie: admin.cookie },
      payload: { commentsEnabled: false, tvIncluded: false, reason: "Temporary moderation action" },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().commentsEnabled).toBe(false);

    const bulk = await app.inject({
      method: "POST",
      url: "/admin/control/videos/bulk",
      headers: { cookie: admin.cookie },
      payload: { ids: [video.id], action: "UNPUBLISH", reason: "Rights review in progress" },
    });
    expect(bulk.statusCode).toBe(201);
    expect(bulk.json()).toMatchObject({ affected: 1, action: "UNPUBLISH" });
    expect((await prisma.video.findUniqueOrThrow({ where: { id: video.id } })).status).toBe("DRAFT");

    const tv = await prisma.creatorTvChannel.findFirstOrThrow({ where: { channelId: creator.user.channel.id } });
    const disableTv = await app.inject({
      method: "PATCH",
      url: `/admin/control/tv/${tv.id}`,
      headers: { cookie: admin.cookie },
      payload: { status: "DISABLED", reason: "Channel review" },
    });
    expect(disableTv.statusCode).toBe(200);
    expect(disableTv.json().status).toBe("DISABLED");

    const actions = await prisma.adminAuditLog.findMany({ where: { actorAccountId: admin.user.account.id } });
    expect(actions.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["video.admin_updated", "video.bulk_updated", "creator_tv.status_updated"]),
    );
  });
});
