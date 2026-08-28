import "reflect-metadata";

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

function cookiePair(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) throw new Error("Expected a session cookie.");
  return value.split(";", 1)[0] ?? value;
}

const uploadSize = 70 * 1024 * 1024;
const storage: MediaStorageAdapter = {
  kind: "r2",
  available: true,
  createMultipartUpload: vi.fn(async () => ({ uploadId: "quick-upload-id" })),
  authorizeMultipartPart: vi.fn(async () => ({
    url: "https://example.invalid/part",
    expiresAt: new Date(Date.now() + 60_000),
  })),
  authorizeSinglePut: vi.fn(async () => ({
    url: "https://example.invalid/object",
    expiresAt: new Date(Date.now() + 60_000),
  })),
  listParts: vi.fn(async () => []),
  completeMultipartUpload: vi.fn(async () => ({ etag: '"complete"' })),
  abortMultipartUpload: vi.fn(async () => undefined),
  headObject: vi.fn(async () => ({ sizeBytes: 1024, contentType: "image/jpeg", etag: '"x"' })),
  deleteObject: vi.fn(async () => undefined),
  listMultipartUploads: vi.fn(async () => []),
};

databaseDescribe("creator quick upload and publish", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-07-test-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET =
      "task-07-upload-session-secret-with-more-than-32-characters";
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
    return { cookie: cookiePair(response.headers["set-cookie"]), user: response.json().user };
  }

  async function createDraft(cookie: string, channelId: string, title = "Quick Upload") {
    const response = await app.inject({
      method: "POST",
      url: "/creator/videos/drafts",
      headers: { cookie },
      payload: {
        channelId,
        title,
        sizeBytes: uploadSize,
        mimeType: "video/mp4",
        durationMs: 120_000,
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json();
  }

  async function completeUpload(cookie: string, draft: any) {
    const parts = Array.from({ length: draft.uploadSession.partCount as number }, (_, index) => ({
      partNumber: index + 1,
      etag: `etag-${index + 1}`,
    }));
    const completed = await app.inject({
      method: "POST",
      url: "/media/uploads/sessions/complete",
      headers: { cookie },
      payload: { sessionToken: draft.uploadSession.sessionToken, parts },
    });
    expect(completed.statusCode).toBe(201);
  }

  it("publishes the happy path with a durable rights declaration", async () => {
    const owner = await register("Quick Owner", "quick-owner@example.com");
    const draft = await createDraft(owner.cookie, owner.user.channel.id, "My First Upload");
    await completeUpload(owner.cookie, draft);

    const publish = await app.inject({
      method: "POST",
      url: `/creator/videos/${draft.video.id}/publish`,
      headers: { cookie: owner.cookie },
      payload: { rightsConfirmed: true, title: "My First Upload" },
    });
    expect(publish.statusCode).toBe(201);
    expect(publish.json().video.status).toBe("PUBLISHED");

    const video = await prisma.video.findUnique({ where: { id: draft.video.id } });
    expect(video?.status).toBe("PUBLISHED");
    expect(video?.publishedAt).toBeTruthy();
    const rights = await prisma.contentRightsDeclaration.findMany({
      where: { videoId: draft.video.id },
    });
    expect(rights).toHaveLength(1);
    expect(rights[0]?.version).toBe(1);
    expect(rights[0]?.declaredAt).toBeTruthy();
  });

  it("cannot publish before the direct R2 upload completes", async () => {
    const owner = await register("Incomplete Owner", "incomplete-owner@example.com");
    const draft = await createDraft(owner.cookie, owner.user.channel.id);
    const publish = await app.inject({
      method: "POST",
      url: `/creator/videos/${draft.video.id}/publish`,
      headers: { cookie: owner.cookie },
      payload: { rightsConfirmed: true },
    });
    expect(publish.statusCode).toBe(409);
    expect(publish.json().error.code).toBe("UPLOAD_NOT_COMPLETE");
  });

  it("requires explicit rights confirmation", async () => {
    const owner = await register("Rights Owner", "rights-owner@example.com");
    const draft = await createDraft(owner.cookie, owner.user.channel.id);
    await completeUpload(owner.cookie, draft);
    const publish = await app.inject({
      method: "POST",
      url: `/creator/videos/${draft.video.id}/publish`,
      headers: { cookie: owner.cookie },
      payload: { rightsConfirmed: false },
    });
    expect(publish.statusCode).toBe(400);
    expect(publish.json().error.code).toBe("RIGHTS_CONFIRMATION_REQUIRED");
  });

  it("prevents a creator from publishing another channel's draft", async () => {
    const owner = await register("Draft Owner", "draft-owner@example.com");
    const other = await register("Other Creator", "other-creator@example.com");
    const draft = await createDraft(owner.cookie, owner.user.channel.id);
    await completeUpload(owner.cookie, draft);
    const publish = await app.inject({
      method: "POST",
      url: `/creator/videos/${draft.video.id}/publish`,
      headers: { cookie: other.cookie },
      payload: { rightsConfirmed: true },
    });
    expect(publish.statusCode).toBe(403);
    expect(publish.json().error.code).toBe("VIDEO_OWNER_REQUIRED");
  });

  it("associates Uploads and Creator TV exactly once across repeated publish requests", async () => {
    const owner = await register("Association Owner", "association-owner@example.com");
    const draft = await createDraft(owner.cookie, owner.user.channel.id);
    await completeUpload(owner.cookie, draft);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const publish = await app.inject({
        method: "POST",
        url: `/creator/videos/${draft.video.id}/publish`,
        headers: { cookie: owner.cookie },
        payload: { rightsConfirmed: true },
      });
      expect(publish.statusCode).toBe(201);
      expect(publish.json().creatorTvAssociated).toBe(true);
    }

    const uploads = await prisma.playlist.findUnique({
      where: { channelId_systemKey: { channelId: owner.user.channel.id, systemKey: "UPLOADS" } },
    });
    expect(uploads).toBeTruthy();
    const items = await prisma.playlistItem.findMany({
      where: { playlistId: uploads!.id, videoId: draft.video.id },
    });
    expect(items).toHaveLength(1);
    const tv = await prisma.creatorTvChannel.findUnique({ where: { id: owner.user.creatorTv.id } });
    expect(tv?.sourcePlaylistId).toBe(uploads!.id);
    const rights = await prisma.contentRightsDeclaration.findMany({
      where: { videoId: draft.video.id },
    });
    expect(rights).toHaveLength(1);
  });
});
