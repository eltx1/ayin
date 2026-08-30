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

databaseDescribe("Task 30 controlled content seeding", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-30-test-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET = "task-30-upload-secret-with-more-than-32-characters";
    process.env.AYIN_E2E_STORAGE = "1";
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

  it("imports validated rights metadata, uploads through the shared media abstraction and publishes", async () => {
    const admin = await register("Seed Admin", "seed-admin@example.com");
    const owner = await register("AYIN Catalog", "ayin-catalog@example.com");
    await prisma.adminRoleAssignment.create({
      data: { accountId: admin.user.account.id, role: "ADMIN" },
    });

    const markOwned = await app.inject({
      method: "PATCH",
      url: `/admin/control/channels/${owner.user.channel.id}`,
      headers: { cookie: admin.cookie },
      payload: { isPlatformOwned: true, reason: "AYIN catalog ownership" },
    });
    expect(markOwned.statusCode).toBe(200);
    expect(markOwned.json().isPlatformOwned).toBe(true);

    const created = await app.inject({
      method: "POST",
      url: "/admin/content-seeding/batches",
      headers: { cookie: admin.cookie },
      payload: {
        channelId: owner.user.channel.id,
        sourceLabel: "Rights-cleared launch catalog",
        items: [
          {
            title: "Archive Documentary",
            description: "Controlled launch import.",
            contentType: "DOCUMENTARY",
            rightsBasis: "LICENSED",
            sourceNotes: "Internal license record LIC-TEST-001; fixture only.",
          },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const item = created.json().items[0];
    expect(item.video.contentType).toBe("DOCUMENTARY");

    const rights = await prisma.contentRightsDeclaration.findFirstOrThrow({
      where: { videoId: item.video.id },
    });
    expect(rights.basis).toBe("LICENSED");
    expect(rights.statement).toContain("LIC-TEST-001");

    const upload = await app.inject({
      method: "POST",
      url: `/admin/content-seeding/items/${item.id}/upload-session`,
      headers: { cookie: admin.cookie },
      payload: { sizeBytes: 1024, mimeType: "video/mp4", durationMs: 60_000 },
    });
    expect(upload.statusCode).toBe(201);
    const session = upload.json();
    expect(session.mode).toBe("single");

    const complete = await app.inject({
      method: "POST",
      url: "/media/uploads/sessions/complete",
      headers: { cookie: admin.cookie },
      payload: { sessionToken: session.sessionToken, parts: [] },
    });
    expect(complete.statusCode).toBe(201);

    const confirm = await app.inject({
      method: "POST",
      url: `/admin/content-seeding/items/${item.id}/confirm-upload`,
      headers: { cookie: admin.cookie },
    });
    expect(confirm.statusCode).toBe(201);
    expect(confirm.json().status).toBe("READY");

    const publish = await app.inject({
      method: "POST",
      url: `/admin/content-seeding/items/${item.id}/publish`,
      headers: { cookie: admin.cookie },
    });
    expect(publish.statusCode).toBe(201);
    expect(publish.json().status).toBe("PUBLISHED");
    expect(await prisma.playlistItem.count({ where: { videoId: item.video.id } })).toBe(1);
  });

  it("rejects non-platform channels and safely rolls back unpublished batches", async () => {
    const admin = await register("Rollback Admin", "rollback-admin@example.com");
    const owner = await register("External Creator", "external-creator@example.com");
    await prisma.adminRoleAssignment.create({
      data: { accountId: admin.user.account.id, role: "ADMIN" },
    });

    const rejected = await app.inject({
      method: "POST",
      url: "/admin/content-seeding/batches",
      headers: { cookie: admin.cookie },
      payload: {
        channelId: owner.user.channel.id,
        sourceLabel: "Should fail",
        items: [
          {
            title: "Nope",
            contentType: "MOVIE",
            rightsBasis: "OWNED",
            sourceNotes: "Not a platform channel",
          },
        ],
      },
    });
    expect(rejected.statusCode).toBe(400);

    await prisma.channel.update({
      where: { id: owner.user.channel.id },
      data: { isPlatformOwned: true },
    });
    const created = await app.inject({
      method: "POST",
      url: "/admin/content-seeding/batches",
      headers: { cookie: admin.cookie },
      payload: {
        channelId: owner.user.channel.id,
        sourceLabel: "Rollback fixture",
        items: [
          {
            title: "Rollback Film",
            contentType: "MOVIE",
            rightsBasis: "OWNED",
            sourceNotes: "Owned fixture source note",
          },
        ],
      },
    });
    const batch = created.json().batch;
    const item = created.json().items[0];
    const rolledBack = await app.inject({
      method: "POST",
      url: `/admin/content-seeding/batches/${batch.id}/rollback`,
      headers: { cookie: admin.cookie },
    });
    expect(rolledBack.statusCode).toBe(201);
    expect(rolledBack.json().status).toBe("ROLLED_BACK");
    expect((await prisma.video.findUniqueOrThrow({ where: { id: item.video.id } })).status).toBe(
      "REMOVED",
    );
    expect(
      (await prisma.contentSeedItem.findUniqueOrThrow({ where: { id: item.id } })).status,
    ).toBe("ROLLED_BACK");
  });
});
