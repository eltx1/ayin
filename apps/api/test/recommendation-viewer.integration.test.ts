import { randomUUID } from "node:crypto";

import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import {
  MEDIA_STORAGE_ADAPTER,
  type MediaStorageAdapter,
} from "../src/media/media-storage.adapter.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const storage = { kind: "r2", available: true } as unknown as MediaStorageAdapter;

databaseDescribe("Viewer recommendation controls", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_TOKEN_SECRET = "recommendation-viewer-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET =
      "recommendation-viewer-upload-secret-with-more-than-32-characters";

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MEDIA_STORAGE_ADAPTER)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "AnalyticsSubscriptionEpisode", "Account", "Channel" CASCADE',
    );
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
    const body = response.json().user as {
      account: { id: string };
      profile: { id: string };
      channel: { id: string };
    };
    return { cookie: raw?.split(";", 1)[0] ?? "", user: body };
  }

  async function publish(channelId: string) {
    const id = randomUUID();
    const video = await prisma.video.create({
      data: {
        id,
        channelId,
        slug: `recommendation-viewer-${id.slice(0, 8)}`,
        title: "Recommendation Viewer Fixture",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        durationMs: 120_000,
        publishedAt: new Date(),
      },
    });
    await prisma.mediaAsset.create({
      data: {
        videoId: video.id,
        channelId,
        kind: "SOURCE_VIDEO",
        status: "VALIDATED",
        r2ObjectKey: `test/recommendation-viewer/${video.id}.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 2048n,
        durationMs: 120_000,
      },
    });
    return video.id;
  }

  it("keeps feedback and reset controls profile-owned and transactional", async () => {
    const viewer = await register("Lens Viewer", "lens-viewer@example.com");
    const other = await register("Lens Other", "lens-other@example.com");
    const videoId = await publish(other.user.channel.id);

    const anonymous = await app.inject({
      method: "POST",
      url: "/recommendations/not-interested",
      payload: { videoId },
    });
    expect(anonymous.statusCode).toBe(401);

    const crossProfile = await app.inject({
      method: "POST",
      url: "/recommendations/not-interested",
      headers: { cookie: other.cookie },
      payload: { profileId: viewer.user.profile.id, videoId },
    });
    expect(crossProfile.statusCode).toBe(403);

    const feedback = await app.inject({
      method: "POST",
      url: "/recommendations/not-interested",
      headers: { cookie: viewer.cookie },
      payload: { profileId: viewer.user.profile.id, videoId },
    });
    expect(feedback.statusCode).toBeLessThan(300);
    expect(feedback.json()).toEqual({
      profileId: viewer.user.profile.id,
      videoId,
      state: "NOT_INTERESTED",
    });
    expect(
      await prisma.recommendationFeedback.count({
        where: { profileId: viewer.user.profile.id, videoId, type: "NOT_INTERESTED" },
      }),
    ).toBe(1);

    const reset = await app.inject({
      method: "POST",
      url: "/recommendations/reset",
      headers: { cookie: viewer.cookie },
      payload: { profileId: viewer.user.profile.id },
    });
    expect(reset.statusCode).toBeLessThan(300);
    expect(reset.json()).toMatchObject({ profileId: viewer.user.profile.id });
    expect(Date.parse(reset.json().resetAt)).not.toBeNaN();
    expect(
      await prisma.recommendationFeedback.count({
        where: { profileId: viewer.user.profile.id },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.recommendationProfileState.findUniqueOrThrow({
          where: { profileId: viewer.user.profile.id },
        })
      ).resetAt,
    ).not.toBeNull();

    const crossReset = await app.inject({
      method: "POST",
      url: "/recommendations/reset",
      headers: { cookie: other.cookie },
      payload: { profileId: viewer.user.profile.id },
    });
    expect(crossReset.statusCode).toBe(403);
  });
});
