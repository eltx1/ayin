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
const uploadSize = 70 * 1024 * 1024;

interface DraftPayload {
  video: { id: string };
  uploadSession: { partCount: number; sessionToken: string };
}

function cookiePair(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) throw new Error("Expected a session cookie.");
  return value.split(";", 1)[0] ?? value;
}

const storage: MediaStorageAdapter = {
  kind: "r2",
  available: true,
  createMultipartUpload: vi.fn(async () => ({ uploadId: "metadata-upload-id" })),
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

databaseDescribe("video metadata v2", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-51-test-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET =
      "task-51-upload-session-secret-with-more-than-32-characters";
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
    expect(response.statusCode).toBe(201);
    return { cookie: cookiePair(response.headers["set-cookie"]), user: response.json().user };
  }

  async function createDraft(cookie: string, channelId: string, title: string): Promise<DraftPayload> {
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

  async function completeAndMarkReady(cookie: string, draft: DraftPayload) {
    const parts = Array.from({ length: draft.uploadSession.partCount }, (_, index) => ({
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

    const job = await prisma.mediaProcessingJob.findFirstOrThrow({
      where: { videoId: draft.video.id },
      orderBy: { generation: "desc" },
    });
    const source = await prisma.mediaAsset.findFirstOrThrow({
      where: { videoId: draft.video.id, kind: "SOURCE_VIDEO", status: "UPLOADED", removedAt: null },
    });
    const canonical = await prisma.mediaAsset.create({
      data: {
        videoId: draft.video.id,
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
        where: { id: draft.video.id },
        data: { status: "DRAFT", durationMs: 120_000 },
      }),
    ]);
  }

  it("publishes with zero advanced fields and creates no metadata companion row", async () => {
    const owner = await register("Zero Metadata", "zero-metadata@example.com");
    const draft = await createDraft(owner.cookie, owner.user.channel.id, "Simple Upload");
    await completeAndMarkReady(owner.cookie, draft);

    const publish = await app.inject({
      method: "POST",
      url: `/creator/videos/${draft.video.id}/publish`,
      headers: { cookie: owner.cookie },
      payload: { rightsConfirmed: true, title: "Simple Upload" },
    });
    expect(publish.statusCode).toBe(201);
    expect(publish.json().video.status).toBe("PUBLISHED");

    const [video, metadata, rights] = await Promise.all([
      prisma.video.findUniqueOrThrow({ where: { id: draft.video.id } }),
      prisma.videoCreatorMetadata.findUnique({ where: { videoId: draft.video.id } }),
      prisma.contentRightsDeclaration.findFirstOrThrow({ where: { videoId: draft.video.id } }),
    ]);
    expect(video.contentType).toBe("CREATOR_VIDEO");
    expect(metadata).toBeNull();
    expect(rights.basis).toBe("AUTHORIZED");
  });

  it("stores normalized advanced metadata and rights in their owning domains", async () => {
    const owner = await register("Metadata Owner", "metadata-owner@example.com");
    const draft = await createDraft(owner.cookie, owner.user.channel.id, "Advanced Upload");

    const patch = await app.inject({
      method: "PATCH",
      url: `/creator/videos/${draft.video.id}`,
      headers: { cookie: owner.cookie },
      payload: {
        tags: [" Cairo ", "CAIRO", "documentary"],
        category: "EDUCATION",
        primaryLanguage: "ar-eg",
        recordingDate: "2026-09-01",
        contentType: "DOCUMENTARY",
        seriesTitle: "Cairo Stories",
        seasonNumber: 1,
        episodeNumber: 2,
        maturityLevel: "GENERAL",
        geoAvailabilityMode: "EXCLUDE",
        geoCountries: ["us", "GB"],
        chapters: [
          { title: "Intro", startSeconds: 0 },
          { title: "Old Cairo", startSeconds: 30 },
        ],
        adBreakPreference: "CUSTOM",
        adBreakOffsetsSeconds: [90],
      },
    });
    expect(patch.statusCode).toBe(200);

    const [video, metadata] = await Promise.all([
      prisma.video.findUniqueOrThrow({ where: { id: draft.video.id } }),
      prisma.videoCreatorMetadata.findUniqueOrThrow({ where: { videoId: draft.video.id } }),
    ]);
    expect(video.contentType).toBe("DOCUMENTARY");
    expect(metadata.tags).toEqual(["cairo", "documentary"]);
    expect(metadata.primaryLanguage).toBe("ar-EG");
    expect(metadata.geoCountries).toEqual(["US", "GB"]);
    expect(metadata.adBreakOffsetsSeconds).toEqual([90]);

    await completeAndMarkReady(owner.cookie, draft);
    const publish = await app.inject({
      method: "POST",
      url: `/creator/videos/${draft.video.id}/publish`,
      headers: { cookie: owner.cookie },
      payload: {
        rightsConfirmed: true,
        rightsBasis: "LICENSED",
        rightsNote: "Licensed for AYIN distribution.",
      },
    });
    expect(publish.statusCode).toBe(201);
    const rights = await prisma.contentRightsDeclaration.findFirstOrThrow({
      where: { videoId: draft.video.id },
      orderBy: { version: "desc" },
    });
    expect(rights.basis).toBe("LICENSED");
    expect(rights.statement).toBe("Licensed for AYIN distribution.");
  });

  it("rejects invalid chapter timing and cross-account edits", async () => {
    const owner = await register("Chapter Owner", "chapter-owner@example.com");
    const other = await register("Other Owner", "metadata-other@example.com");
    const draft = await createDraft(owner.cookie, owner.user.channel.id, "Timing Test");

    const invalid = await app.inject({
      method: "PATCH",
      url: `/creator/videos/${draft.video.id}`,
      headers: { cookie: owner.cookie },
      payload: { chapters: [{ title: "Too late", startSeconds: 120 }] },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("CHAPTER_OUTSIDE_VIDEO");

    const forbidden = await app.inject({
      method: "PATCH",
      url: `/creator/videos/${draft.video.id}`,
      headers: { cookie: other.cookie },
      payload: { tags: ["not-mine"] },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});
