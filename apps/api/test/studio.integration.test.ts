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

databaseDescribe("Task 16 Creator Studio", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-16-test-auth-secret-with-more-than-32-characters";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";

    moduleReference = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleReference.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account", "Channel" CASCADE');
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
    return { cookie: cookiePair(response.headers["set-cookie"]), user: response.json().user };
  }

  it("shows real dashboard counters and lets the owner manage content", async () => {
    const owner = await register("Studio Owner", "studio-owner@example.com");
    const video = await prisma.video.create({
      data: {
        channelId: owner.user.channel.id,
        slug: "studio-video",
        title: "Studio Video",
        description: "Before",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        commentsEnabled: true,
        publishedAt: new Date(),
      },
    });
    await prisma.subscription.create({
      data: { profileId: owner.user.profile.id, channelId: owner.user.channel.id },
    });
    await prisma.comment.create({
      data: {
        videoId: video.id,
        authorProfileId: owner.user.profile.id,
        body: "A real comment",
      },
    });

    const overview = await app.inject({
      method: "GET",
      url: "/creator/studio/overview",
      headers: { cookie: owner.cookie },
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().counters).toMatchObject({ videos: 1, publishedVideos: 1, subscribers: 1, comments: 1 });
    expect(overview.json().analytics.available).toBe(false);
    expect(overview.json().analytics.views).toBeNull();

    const update = await app.inject({
      method: "PATCH",
      url: `/creator/studio/videos/${video.id}`,
      headers: { cookie: owner.cookie },
      payload: {
        title: "Studio Video Updated",
        description: "After",
        visibility: "PRIVATE",
        commentsEnabled: false,
        tvIncluded: false,
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toMatchObject({
      title: "Studio Video Updated",
      description: "After",
      visibility: "PRIVATE",
      commentsEnabled: false,
    });

    const content = await app.inject({
      method: "GET",
      url: "/creator/studio/content?visibility=PRIVATE",
      headers: { cookie: owner.cookie },
    });
    expect(content.statusCode).toBe(200);
    expect(content.json().videos).toHaveLength(1);
    expect(content.json().videos[0].tvIncluded).toBe(false);

    const comments = await app.inject({
      method: "GET",
      url: "/creator/studio/comments",
      headers: { cookie: owner.cookie },
    });
    expect(comments.statusCode).toBe(200);
    expect(comments.json().comments[0]).toMatchObject({ body: "A real comment" });
  });

  it("isolates another creator and supports unpublish plus soft removal", async () => {
    const owner = await register("Video Owner", "studio-video-owner@example.com");
    const other = await register("Other Studio", "other-studio@example.com");
    const video = await prisma.video.create({
      data: {
        channelId: owner.user.channel.id,
        slug: "studio-owned-video",
        title: "Owned Video",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt: new Date(),
      },
    });

    const denied = await app.inject({
      method: "PATCH",
      url: `/creator/studio/videos/${video.id}`,
      headers: { cookie: other.cookie },
      payload: { title: "Hijacked" },
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.json().error.code).toBe("VIDEO_NOT_FOUND");

    const unpublish = await app.inject({
      method: "POST",
      url: `/creator/studio/videos/${video.id}/unpublish`,
      headers: { cookie: owner.cookie },
    });
    expect(unpublish.statusCode).toBe(201);
    expect(unpublish.json().status).toBe("DRAFT");

    const remove = await app.inject({
      method: "DELETE",
      url: `/creator/studio/videos/${video.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json().status).toBe("REMOVED");

    const stored = await prisma.video.findUnique({ where: { id: video.id } });
    expect(stored?.status).toBe("REMOVED");
    expect(stored?.removedAt).toBeTruthy();
  });
});
