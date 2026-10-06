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
  deletePrefix: vi.fn(async () => undefined),
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

  async function checkpoint(
    viewer: RegisteredUser,
    videoId: string,
    positionMs: number,
    expectedRevision?: string | null,
  ) {
    return app.inject({
      method: "PUT",
      url: `/watch/progress/${videoId}`,
      headers: { cookie: viewer.cookie, "x-ayin-expected-account": viewer.user.account.id },
      payload: {
        profileId: viewer.user.profile.id,
        positionMs,
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
      },
    });
  }

  it("atomically admits one conditional creator from two absent-row snapshots", async () => {
    const viewer = await register("Fresh Viewer", "fresh-create@example.test");
    const video = await publishVideo(viewer.user.channel.id, "Create race");
    const initial = await app.inject({
      method: "GET",
      url: `/watch/progress/${video.id}`,
      headers: { cookie: viewer.cookie },
    });
    expect(initial.headers["cache-control"]).toBe("private, no-store");
    expect(initial.json()).toMatchObject({ positionMs: 0, revision: null, lastWatchedAt: null });
    const results = await Promise.all([
      checkpoint(viewer, video.id, 37_000, null),
      checkpoint(viewer, video.id, 53_000, null),
    ]);
    expect(results.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const winner = results.find((response) => response.statusCode === 200)!.json();
    expect(results.find((response) => response.statusCode === 409)!.json().error.code).toBe(
      "WATCH_PROGRESS_CONFLICT",
    );
    const rows = await prisma.watchProgress.findMany({ where: { videoId: video.id } });
    const history = await prisma.watchHistory.findMany({ where: { videoId: video.id } });
    expect(rows).toHaveLength(1);
    expect(history).toHaveLength(1);
    expect(rows[0]!.positionMs).toBe(winner.positionMs);
    expect(rows[0]!.lastWatchedAt.toISOString()).toBe(winner.revision);
    expect(history[0]!.lastWatchedAt.toISOString()).toBe(winner.revision);
    expect(history[0]!.viewCount).toBe(1);
  });

  it("atomically admits one conditional update from the same observed revision", async () => {
    const viewer = await register("Update Viewer", "fresh-update@example.test");
    const video = await publishVideo(viewer.user.channel.id, "Update race");
    const created = await checkpoint(viewer, video.id, 10_000, null);
    const revision = created.json().revision as string;
    const results = await Promise.all([
      checkpoint(viewer, video.id, 37_000, revision),
      checkpoint(viewer, video.id, 53_000, revision),
    ]);
    expect(results.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const winner = results.find((response) => response.statusCode === 200)!.json();
    expect(Date.parse(winner.revision)).toBeGreaterThan(Date.parse(revision));
    const row = await prisma.watchProgress.findUniqueOrThrow({
      where: { profileId_videoId: { profileId: viewer.user.profile.id, videoId: video.id } },
    });
    expect(row.positionMs).toBe(winner.positionMs);
    expect(row.lastWatchedAt.toISOString()).toBe(winner.revision);
  });

  it("rejects a delayed old checkpoint without changing progress, completion or history", async () => {
    const viewer = await register("Delayed Viewer", "fresh-delayed@example.test");
    const video = await publishVideo(viewer.user.channel.id, "Delayed final");
    const saved = await checkpoint(viewer, video.id, 93_000, null);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().completedAt).toBeTruthy();
    const where = { profileId_videoId: { profileId: viewer.user.profile.id, videoId: video.id } };
    const before = {
      progress: await prisma.watchProgress.findUniqueOrThrow({ where }),
      history: await prisma.watchHistory.findUniqueOrThrow({ where }),
    };
    const stale = await checkpoint(viewer, video.id, 37_000, null);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("WATCH_PROGRESS_CONFLICT");
    expect(await prisma.watchProgress.findUniqueOrThrow({ where })).toEqual(before.progress);
    expect(await prisma.watchHistory.findUniqueOrThrow({ where })).toEqual(before.history);
  });

  it("strictly advances millisecond revisions despite an older clock and preserves deliberate rewinds and legacy interference", async () => {
    const viewer = await register("Clock Viewer", "fresh-clock@example.test");
    const video = await publishVideo(viewer.user.channel.id, "Revision clock");
    await checkpoint(viewer, video.id, 93_000, null);
    const where = { profileId_videoId: { profileId: viewer.user.profile.id, videoId: video.id } };
    const future = "2040-01-01T00:00:00.000Z";
    await prisma.watchProgress.update({ where, data: { lastWatchedAt: new Date(future) } });
    const columns = await prisma.$queryRaw<
      Array<{ datetime_precision: number }>
    >`SELECT datetime_precision FROM information_schema.columns WHERE table_name = 'WatchProgress' AND column_name = 'lastWatchedAt'`;
    expect(columns[0]!.datetime_precision).toBe(3);
    const rewind = await checkpoint(viewer, video.id, 12_000, future);
    expect(rewind.statusCode).toBe(200);
    expect(rewind.json()).toMatchObject({
      positionMs: 12_000,
      completedAt: null,
      revision: "2040-01-01T00:00:00.001Z",
    });
    const next = await checkpoint(viewer, video.id, 11_000, rewind.json().revision);
    expect(next.statusCode).toBe(200);
    expect(next.json().revision).toBe("2040-01-01T00:00:00.002Z");
    const legacy = await checkpoint(viewer, video.id, 10_000);
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json().revision).toBe("2040-01-01T00:00:00.003Z");
    const stale = await checkpoint(viewer, video.id, 37_000, next.json().revision);
    expect(stale.statusCode).toBe(409);
    expect((await prisma.watchProgress.findUniqueOrThrow({ where })).positionMs).toBe(10_000);
    const history = await prisma.watchHistory.findUniqueOrThrow({ where });
    expect(history.lastWatchedAt.toISOString()).toBe(legacy.json().revision);
    expect(history.viewCount).toBe(1);
  });

  it("does not recreate a removed row with an old revision and rejects malformed preconditions", async () => {
    const viewer = await register("Removed Viewer", "fresh-removed@example.test");
    const video = await publishVideo(viewer.user.channel.id, "Removed progress");
    const saved = await checkpoint(viewer, video.id, 37_000, null);
    const where = { profileId_videoId: { profileId: viewer.user.profile.id, videoId: video.id } };
    await prisma.watchProgress.delete({ where });
    const history = await prisma.watchHistory.findUniqueOrThrow({ where });
    expect((await checkpoint(viewer, video.id, 53_000, saved.json().revision)).statusCode).toBe(
      409,
    );
    expect(await prisma.watchProgress.findUnique({ where })).toBeNull();
    expect(await prisma.watchHistory.findUniqueOrThrow({ where })).toEqual(history);
    expect((await checkpoint(viewer, video.id, 53_000, "not-a-revision")).statusCode).toBe(400);
    expect((await checkpoint(viewer, video.id, 53_000, null)).statusCode).toBe(200);
  });
});
