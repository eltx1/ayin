import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import {
  MEDIA_STORAGE_ADAPTER,
  type MediaStorageAdapter,
} from "../src/media/media-storage.adapter.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const storage = { kind: "r2", available: true } as unknown as MediaStorageAdapter;

databaseDescribe("Task 14 social graph", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_TOKEN_SECRET = "task-14-test-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET = "task-14-upload-secret-with-more-than-32-characters";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MEDIA_STORAGE_ADAPTER)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    vi.clearAllMocks();
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
    const setCookie = response.headers["set-cookie"];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    return {
      cookie: raw?.split(";", 1)[0] ?? "",
      user: response.json().user as {
        account: { id: string };
        profile: { id: string };
        channel: { id: string };
      },
    };
  }
  async function publish(channelId: string) {
    const id = randomUUID();
    await prisma.video.create({
      data: {
        id,
        channelId,
        slug: `social-${id.slice(0, 8)}`,
        title: "Social video",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt: new Date(),
      },
    });
    return id;
  }

  it("requires authentication and keeps subscription toggles idempotent", async () => {
    const owner = await register("Owner", "task14-owner@example.com");
    const viewer = await register("Viewer", "task14-viewer@example.com");
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/social/channels/${owner.user.channel.id}/subscription`,
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
    for (let index = 0; index < 2; index += 1) {
      const response = await app.inject({
        method: "PUT",
        url: `/social/channels/${owner.user.channel.id}/subscription`,
        headers: { cookie: viewer.cookie },
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().subscriberCount).toBe(1);
    }
    expect(await prisma.subscription.count()).toBe(1);
    expect(await prisma.notification.count({ where: { accountId: owner.user.account.id } })).toBe(
      1,
    );
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/social/channels/${owner.user.channel.id}/subscription`,
          headers: { cookie: owner.cookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
  });

  it("makes reactions and both saved lists idempotent and profile isolated", async () => {
    const owner = await register("Video Owner", "task14-video@example.com");
    const viewer = await register("Social Viewer", "task14-social@example.com");
    const videoId = await publish(owner.user.channel.id);
    for (let index = 0; index < 2; index += 1) {
      expect(
        (
          await app.inject({
            method: "PUT",
            url: `/social/videos/${videoId}/reaction`,
            headers: { cookie: viewer.cookie },
            payload: { type: "LIKE" },
          })
        ).json().likeCount,
      ).toBe(1);
      await app.inject({
        method: "PUT",
        url: `/social/videos/${videoId}/watch-later`,
        headers: { cookie: viewer.cookie },
        payload: {},
      });
      await app.inject({
        method: "PUT",
        url: `/social/videos/${videoId}/my-list`,
        headers: { cookie: viewer.cookie },
        payload: {},
      });
    }
    expect(await prisma.reaction.count()).toBe(1);
    expect(await prisma.watchLaterItem.count()).toBe(1);
    expect(await prisma.myListItem.count()).toBe(1);
    const privateFeedback = await app.inject({
      method: "PUT",
      url: `/social/videos/${videoId}/reaction`,
      headers: { cookie: viewer.cookie },
      payload: { type: "DISLIKE" },
    });
    expect(privateFeedback.json()).toMatchObject({ reaction: "DISLIKE", likeCount: 0 });
    expect(privateFeedback.json()).not.toHaveProperty("dislikeCount");
    const crossProfile = await app.inject({
      method: "GET",
      url: `/social/videos/${videoId}?profileId=${owner.user.profile.id}`,
      headers: { cookie: viewer.cookie },
    });
    expect(crossProfile.statusCode).toBe(403);
  });
});
