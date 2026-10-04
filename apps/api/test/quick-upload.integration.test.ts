import "reflect-metadata";
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

interface DraftPayload {
  video: { id: string };
  uploadSession: { partCount: number; sessionToken: string };
}

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
  deletePrefix: vi.fn(async () => undefined),
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

  async function createDraft(
    cookie: string,
    channelId: string,
    title = "Quick Upload",
  ): Promise<DraftPayload> {
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
    return response.json() as DraftPayload;
  }

  async function completeUpload(cookie: string, draft: DraftPayload) {
    const parts = Array.from({ length: draft.uploadSession.partCount }, (_, index) => ({
      partNumber: index + 1,
      etag: `etag-${index + 1}`,
    }));
    vi.mocked(storage.headObject).mockResolvedValueOnce({
      sizeBytes: uploadSize,
      contentType: "video/mp4",
      etag: '"actual-completed-source"',
    });
    const completed = await app.inject({
      method: "POST",
      url: "/media/uploads/sessions/complete",
      headers: { cookie },
      payload: { sessionToken: draft.uploadSession.sessionToken, parts },
    });
    expect(completed.statusCode).toBe(201);
  }

  async function markReady(videoId: string) {
    const job = await prisma.mediaProcessingJob.findFirstOrThrow({
      where: { videoId },
      orderBy: { generation: "desc" },
    });
    const source = await prisma.mediaAsset.findFirstOrThrow({
      where: { videoId, kind: "SOURCE_VIDEO", status: "UPLOADED", removedAt: null },
    });
    const canonical = await prisma.mediaAsset.create({
      data: {
        videoId,
        channelId: source.channelId,
        kind: "SOURCE_VIDEO",
        status: "VALIDATED",
        r2ObjectKey: job.outputR2ObjectKey,
        mimeType: "video/mp4",
        sizeBytes: 2048n,
        durationMs: 120_000,
        width: 1280,
        height: 720,
      },
    });
    await prisma.$transaction([
      prisma.mediaAsset.update({
        where: { id: source.id },
        data: { status: "REMOVED", removedAt: new Date() },
      }),
      prisma.mediaProcessingJob.update({
        where: { id: job.id },
        data: {
          finalAssetId: canonical.id,
          status: "READY",
          stage: "READY",
          progressPercent: 100,
          outputSizeBytes: 2048n,
          completedAt: new Date(),
        },
      }),
      prisma.video.update({
        where: { id: videoId },
        data: { status: "DRAFT", durationMs: 120_000 },
      }),
    ]);
  }

  it("publishes the happy path with a durable rights declaration", async () => {
    const owner = await register("Quick Owner", "quick-owner@example.com");
    const draft = await createDraft(owner.cookie, owner.user.channel.id, "My First Upload");
    await completeUpload(owner.cookie, draft);
    await markReady(draft.video.id);

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

  it("blocks publishing while canonical processing is still queued", async () => {
    const owner = await register("Processing Owner", "processing-owner@example.com");
    const draft = await createDraft(owner.cookie, owner.user.channel.id);
    await completeUpload(owner.cookie, draft);

    const status = await app.inject({
      method: "GET",
      url: `/creator/videos/${draft.video.id}/processing`,
      headers: { cookie: owner.cookie },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      ready: false,
      videoStatus: "VALIDATING",
      processing: { status: "QUEUED" },
    });

    const publish = await app.inject({
      method: "POST",
      url: `/creator/videos/${draft.video.id}/publish`,
      headers: { cookie: owner.cookie },
      payload: { rightsConfirmed: true },
    });
    expect(publish.statusCode).toBe(409);
    expect(publish.json().error.code).toBe("VIDEO_PROCESSING");
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
    await markReady(draft.video.id);

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
  it("reads all actual owned source uploads with DB pages, filters and private safe latest processing", async () => {
    const creator = await register("History Owner", "history-owner@example.com");
    const foreign = await register("Foreign History", "history-foreign@example.com");
    const channelId = creator.user.channel.id;
    const videos = Array.from({ length: 28 }, (_, i) => ({
      id: randomUUID(),
      channelId,
      slug: `history-${randomUUID()}`,
      title: `Saved source ${i}`,
      status: i === 27 ? ("DRAFT" as const) : ("UPLOADING" as const),
      createdAt: new Date("2026-10-03T12:00:00Z"),
    }));
    await prisma.video.createMany({ data: videos });
    await prisma.mediaAsset.createMany({
      data: videos.map((v) => ({
        videoId: v.id,
        channelId,
        kind: "SOURCE_VIDEO" as const,
        status: "PENDING" as const,
        r2ObjectKey: `private/history/${v.id}`,
        mimeType: "video/mp4",
        sizeBytes: 42n,
      })),
    });
    const outside = await prisma.video.create({
      data: {
        channelId: foreign.user.channel.id,
        slug: `outside-${randomUUID()}`,
        title: "PRIVATE FOREIGN UPLOAD",
        mediaAssets: {
          create: {
            channelId: foreign.user.channel.id,
            kind: "SOURCE_VIDEO",
            r2ObjectKey: `outside/${randomUUID()}`,
            mimeType: "video/mp4",
            sizeBytes: 42n,
          },
        },
      },
    });
    const latest = videos[0]!;
    await prisma.mediaProcessingJob.createMany({
      data: [1, 2].map((generation) => ({
        videoId: latest.id,
        generation,
        sourceMimeType: "video/mp4",
        sourceSizeBytes: 42n,
        stagingKey: `PRIVATE-STAGING-${randomUUID()}`,
        outputR2ObjectKey: `PRIVATE-OUTPUT-${randomUUID()}`,
        status: "FAILED" as const,
        progressPercent: 0,
        errorCode: "SOURCE_REJECTED",
        errorMessage: "PRIVATE PROVIDER DETAILS",
      })),
    });
    const get = (suffix = "") =>
      app.inject({
        method: "GET",
        url: `/creator/videos/uploads?channelId=${channelId}${suffix}`,
        headers: { cookie: creator.cookie },
      });
    const first = await get();
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("private, no-store");
    expect(first.json()).toMatchObject({
      actorAccountId: creator.user.account.id,
      channelId,
      pagination: { page: 1, take: 25, total: 28, pages: 2 },
    });
    expect(first.json().items).toHaveLength(25);
    const second = await get("&page=2");
    expect(second.statusCode).toBe(200);
    expect(second.json().items).toHaveLength(3);
    const rows = [...first.json().items, ...second.json().items];
    expect(new Set(rows.map((v: { id: string }) => v.id)).size).toBe(28);
    expect(rows.some((v: { id: string }) => v.id === outside.id)).toBe(false);
    expect(rows.find((v: { id: string }) => v.id === latest.id).processing).toEqual({
      generation: 2,
      status: "FAILED",
      progressPercent: 0,
      errorCode: "SOURCE_REJECTED",
    });
    const raw = first.body + second.body;
    for (const forbidden of [
      "r2ObjectKey",
      "sessionToken",
      "stagingKey",
      "outputR2ObjectKey",
      "PRIVATE PROVIDER",
      "PRIVATE FOREIGN",
    ])
      expect(raw).not.toContain(forbidden);
    const filtered = await get("&status=DRAFT");
    expect(filtered.json().items).toHaveLength(1);
    expect(filtered.json().pagination.total).toBe(1);
    for (const suffix of [
      "&page=0",
      "&page=1001",
      "&status=BAD",
      "&actorAccountId=" + foreign.user.account.id,
    ])
      expect((await get(suffix)).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/creator/videos/uploads?channelId=${foreign.user.channel.id}`,
          headers: { cookie: creator.cookie },
        })
      ).statusCode,
    ).toBe(403);
    await prisma.channelMember.updateMany({
      where: { accountId: creator.user.account.id, channelId },
      data: { role: "EDITOR" },
    });
    expect((await get()).statusCode).toBe(403);
    expect(
      (await app.inject({ method: "GET", url: `/creator/videos/uploads?channelId=${channelId}` }))
        .statusCode,
    ).toBe(401);
    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
    expect(storage.listParts).not.toHaveBeenCalled();
    expect(await prisma.video.count({ where: { id: { in: videos.map((v) => v.id) } } })).toBe(28);
  });
});
