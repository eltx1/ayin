import { randomUUID } from "node:crypto";

import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AppModule } from "../src/app.module.js";
import {
  MEDIA_STORAGE_ADAPTER,
  type MediaStorageAdapter,
} from "../src/media/media-storage.adapter.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;

const storage: MediaStorageAdapter = {
  kind: "r2",
  available: true,
  createMultipartUpload: vi.fn(async () => ({ uploadId: "watch-upload" })),
  authorizeMultipartPart: vi.fn(async () => ({
    url: "https://example.invalid/part",
    expiresAt: new Date(Date.now() + 60_000),
  })),
  authorizeSinglePut: vi.fn(async () => ({
    url: "https://example.invalid/upload",
    expiresAt: new Date(Date.now() + 60_000),
  })),
  listParts: vi.fn(async () => []),
  completeMultipartUpload: vi.fn(async () => ({ etag: '"complete"' })),
  abortMultipartUpload: vi.fn(async () => undefined),
  headObject: vi.fn(async () => ({ sizeBytes: 1024, contentType: "video/mp4", etag: '"video"' })),
  deleteObject: vi.fn(async () => undefined),
  listMultipartUploads: vi.fn(async () => []),
};

function cookiePair(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) throw new Error("Expected a session cookie.");
  return value.split(";", 1)[0] ?? value;
}

interface RegisteredUser {
  cookie: string;
  user: {
    account: { id: string };
    profile: { id: string };
    channel: { id: string };
  };
}

databaseDescribe("Task 11 AYIN Player watch progress", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-11-test-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET = "task-11-upload-secret-with-more-than-32-characters";
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";

    moduleReference = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MEDIA_STORAGE_ADAPTER)
      .useValue(storage)
      .compile();
    app = moduleReference.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account", "Channel" CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "AdminRoleAssignment" CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "PlatformSetting" CASCADE');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function register(name: string, email: string): Promise<RegisteredUser> {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name, email, password: "strong-pass-123" },
    });
    expect(response.statusCode).toBe(201);
    return {
      cookie: cookiePair(response.headers["set-cookie"]),
      user: response.json().user as RegisteredUser["user"],
    };
  }

  async function publishVideo(channelId: string, title: string, durationMs = 100_000) {
    const id = randomUUID();
    const slug = `task11-${id.slice(0, 8)}`;
    await prisma.video.create({
      data: {
        id,
        channelId,
        slug,
        title,
        status: "PUBLISHED",
        visibility: "PUBLIC",
        durationMs,
        publishedAt: new Date(),
      },
    });
    await prisma.mediaAsset.create({
      data: {
        id: randomUUID(),
        channelId,
        videoId: id,
        kind: "SOURCE_VIDEO",
        status: "VALIDATED",
        r2ObjectKey: `channels/${channelId}/media/${id}/source.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 1024n,
        durationMs,
      },
    });
    return { id, slug };
  }

  it("returns a progressive MP4 playback contract and resumes persisted progress", async () => {
    const viewer = await register("Viewer", "task11-viewer@example.com");
    const video = await publishVideo(viewer.user.channel.id, "Player Video");

    const playback = await app.inject({
      method: "GET",
      url: `/public/videos/${video.slug}/playback`,
    });
    expect(playback.statusCode).toBe(200);
    expect(playback.json().video).toMatchObject({
      id: video.id,
      source: { mimeType: "video/mp4" },
    });
    expect(playback.json().playerPolicy.progressSaveIntervalMs).toBeGreaterThan(0);

    const saved = await app.inject({
      method: "PUT",
      url: `/watch/progress/${video.id}`,
      headers: { cookie: viewer.cookie },
      payload: { positionMs: 42_000, durationMs: 100_000 },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ positionMs: 42_000, completed: false });

    const resumed = await app.inject({
      method: "GET",
      url: `/watch/progress/${video.id}`,
      headers: { cookie: viewer.cookie },
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json()).toMatchObject({
      profileId: viewer.user.profile.id,
      positionMs: 42_000,
      completedAt: null,
    });
  });

  it("marks progress completed at the configured threshold and keeps history efficient", async () => {
    const viewer = await register("Completion Viewer", "task11-complete@example.com");
    const video = await publishVideo(viewer.user.channel.id, "Completion Video");

    await prisma.platformSetting.create({
      data: {
        namespace: "DISCOVERY",
        key: "watchCompletionThresholdPercent",
        valueType: "INTEGER",
        value: 80,
      },
    });

    const saved = await app.inject({
      method: "PUT",
      url: `/watch/progress/${video.id}`,
      headers: { cookie: viewer.cookie },
      payload: { positionMs: 80_000, durationMs: 100_000 },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().completed).toBe(true);
    expect(saved.json().completedAt).toBeTruthy();

    await app.inject({
      method: "PUT",
      url: `/watch/progress/${video.id}`,
      headers: { cookie: viewer.cookie },
      payload: { positionMs: 85_000, durationMs: 100_000 },
    });
    expect(
      await prisma.watchHistory.count({
        where: { profileId: viewer.user.profile.id, videoId: video.id },
      }),
    ).toBe(1);
  });

  it("isolates progress by viewer profile and rejects profiles from another account", async () => {
    const owner = await register("Profile Owner", "task11-owner@example.com");
    const stranger = await register("Stranger", "task11-stranger@example.com");
    const video = await publishVideo(owner.user.channel.id, "Isolated Video");
    const secondProfile = await prisma.viewerProfile.create({
      data: {
        accountId: owner.user.account.id,
        name: "Second profile",
        slug: "second-profile",
      },
    });

    const first = await app.inject({
      method: "PUT",
      url: `/watch/progress/${video.id}`,
      headers: { cookie: owner.cookie },
      payload: { profileId: owner.user.profile.id, positionMs: 12_000, durationMs: 100_000 },
    });
    const second = await app.inject({
      method: "PUT",
      url: `/watch/progress/${video.id}`,
      headers: { cookie: owner.cookie },
      payload: { profileId: secondProfile.id, positionMs: 48_000, durationMs: 100_000 },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const firstRead = await app.inject({
      method: "GET",
      url: `/watch/progress/${video.id}?profileId=${owner.user.profile.id}`,
      headers: { cookie: owner.cookie },
    });
    const secondRead = await app.inject({
      method: "GET",
      url: `/watch/progress/${video.id}?profileId=${secondProfile.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(firstRead.json().positionMs).toBe(12_000);
    expect(secondRead.json().positionMs).toBe(48_000);

    const forbidden = await app.inject({
      method: "GET",
      url: `/watch/progress/${video.id}?profileId=${owner.user.profile.id}`,
      headers: { cookie: stranger.cookie },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});
