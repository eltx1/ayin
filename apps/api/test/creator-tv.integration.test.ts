import { randomUUID } from "node:crypto";

import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AppModule } from "../src/app.module.js";
import { CreatorTvService } from "../src/creator/creator-tv.service.js";
import {
  MEDIA_STORAGE_ADAPTER,
  type MediaStorageAdapter,
} from "../src/media/media-storage.adapter.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = testDatabaseUrl ? describe : describe.skip;

const storage: MediaStorageAdapter = {
  kind: "r2",
  available: true,
  createMultipartUpload: vi.fn(async () => ({ uploadId: "creator-tv-upload" })),
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
  headObject: vi.fn(async () => ({
    sizeBytes: 1024,
    contentType: "video/mp4",
    etag: '"video"',
  })),
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
    channel: { id: string; handle: string; name: string };
    creatorTv: { id: string; name: string; slug: string };
  };
}

databaseDescribe("Task 10 Creator TV V1", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-10-test-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET =
      "task-10-upload-session-secret-with-more-than-32-characters";
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

  async function publishMp4(
    channelId: string,
    title: string,
    durationMs: number | null,
    options: { visibility?: "PUBLIC" | "PRIVATE"; mimeType?: string } = {},
  ) {
    const id = randomUUID();
    const publishedAt = new Date(Date.now() - 60_000);
    await prisma.video.create({
      data: {
        id,
        channelId,
        slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id.slice(0, 8)}`,
        title,
        status: "PUBLISHED",
        visibility: options.visibility ?? "PUBLIC",
        durationMs,
        publishedAt,
      },
    });
    await prisma.mediaAsset.create({
      data: {
        id: randomUUID(),
        channelId,
        videoId: id,
        kind: "SOURCE_VIDEO",
        status: "UPLOADED",
        r2ObjectKey: `channels/${channelId}/media/${id}/source.mp4`,
        mimeType: options.mimeType ?? "video/mp4",
        sizeBytes: 1024n,
        durationMs,
      },
    });
    return { id, publishedAt };
  }

  it("keeps every registered channel TV polished and off-air when its eligible library is empty", async () => {
    const owner = await register("Empty TV", "task10-empty@example.com");
    expect(owner.user.creatorTv.name).toContain("TV");

    const response = await app.inject({
      method: "GET",
      url: `/public/channels/${owner.user.channel.handle}/tv`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().tv).toMatchObject({
      id: owner.user.creatorTv.id,
      state: "OFF_AIR",
      offAirReason: "NO_ELIGIBLE_VIDEOS",
    });
    expect(response.json().schedule.guide).toEqual([]);
  });

  it("automatically rotates newly published eligible MP4 videos and ignores ineligible media", async () => {
    const owner = await register("Automatic TV", "task10-auto@example.com");
    const first = await publishMp4(owner.user.channel.id, "First Program", 90_000);

    const firstResponse = await app.inject({
      method: "GET",
      url: `/public/channels/${owner.user.channel.handle}/tv`,
    });
    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.json().tv.state).toBe("ON_AIR");
    expect(firstResponse.json().schedule.nowPlaying.video.id).toBe(first.id);
    expect(firstResponse.json().schedule.upNext.video.id).toBe(first.id);

    const second = await publishMp4(owner.user.channel.id, "Second Program", 120_000);
    await publishMp4(owner.user.channel.id, "Private Program", 60_000, { visibility: "PRIVATE" });
    await publishMp4(owner.user.channel.id, "Wrong Container", 60_000, {
      mimeType: "video/webm",
    });

    const secondResponse = await app.inject({
      method: "GET",
      url: `/public/channels/${owner.user.channel.handle}/tv`,
    });
    const scheduledIds = new Set(
      secondResponse.json().schedule.guide.map((program: { video: { id: string } }) => program.video.id),
    );
    expect(scheduledIds).toEqual(new Set([first.id, second.id]));
  });

  it("lets the owner exclude a video while denying another channel owner", async () => {
    const owner = await register("Preference TV", "task10-preference@example.com");
    const stranger = await register("Other TV", "task10-other@example.com");
    const first = await publishMp4(owner.user.channel.id, "Keep Me", 90_000);
    const excluded = await publishMp4(owner.user.channel.id, "Exclude Me", 90_000);

    const forbidden = await app.inject({
      method: "PUT",
      url: `/creator/tv/${owner.user.creatorTv.id}/videos/${excluded.id}`,
      headers: { cookie: stranger.cookie },
      payload: { included: false, priority: 0, sortOrder: null },
    });
    expect(forbidden.statusCode).toBe(403);

    const update = await app.inject({
      method: "PUT",
      url: `/creator/tv/${owner.user.creatorTv.id}/videos/${excluded.id}`,
      headers: { cookie: owner.cookie },
      payload: { included: false, priority: 50, sortOrder: 0 },
    });
    expect(update.statusCode).toBe(200);

    const response = await app.inject({
      method: "GET",
      url: `/public/channels/${owner.user.channel.handle}/tv`,
    });
    const ids = new Set(
      response.json().schedule.guide.map((program: { video: { id: string } }) => program.video.id),
    );
    expect(ids).toEqual(new Set([first.id]));
  });

  it("exposes audited admin enable/disable and schedule override hooks", async () => {
    const owner = await register("Admin TV Target", "task10-admin-target@example.com");
    const admin = await register("TV Admin", "task10-admin@example.com");
    const video = await publishMp4(owner.user.channel.id, "Admin Program", 300_000);
    await prisma.adminRoleAssignment.create({
      data: { accountId: admin.user.account.id, role: "ADMIN" },
    });

    const service = moduleReference.get(CreatorTvService);
    const actor = { kind: "admin" as const, accountId: admin.user.account.id };
    await service.setAdminEnabled(actor, owner.user.creatorTv.id, false);
    const disabled = await service.getPublicTv(owner.user.channel.handle, new Date());
    expect(disabled.tv).toMatchObject({ state: "OFF_AIR", offAirReason: "TV_DISABLED" });

    await service.setAdminEnabled(actor, owner.user.creatorTv.id, true);
    const now = new Date();
    await service.createAdminOverride(actor, owner.user.creatorTv.id, {
      videoId: video.id,
      startsAt: new Date(now.getTime() - 30_000),
      endsAt: new Date(now.getTime() + 30_000),
    });
    const overridden = await service.getPublicTv(owner.user.channel.handle, now);
    expect(overridden.schedule.nowPlaying?.source).toBe("ADMIN");
    expect(overridden.schedule.nowPlaying?.video.id).toBe(video.id);

    const auditCount = await prisma.adminAuditLog.count({
      where: { actorAccountId: admin.user.account.id, entityType: "CreatorTvChannel" },
    });
    expect(auditCount).toBeGreaterThanOrEqual(3);
  });
});
