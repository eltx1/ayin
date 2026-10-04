import "reflect-metadata";

import { createPrismaClient, Prisma } from "@ayin/db";
import { VideoMetadataService } from "../src/creator/video-metadata.service.js";
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

  async function createDraft(
    cookie: string,
    channelId: string,
    title: string,
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

  async function completeAndMarkReady(cookie: string, draft: DraftPayload) {
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

    const [video, metadata, policy, rights] = await Promise.all([
      prisma.video.findUniqueOrThrow({ where: { id: draft.video.id } }),
      prisma.videoCreatorMetadata.findUnique({ where: { videoId: draft.video.id } }),
      prisma.videoPolicy.findUnique({ where: { videoId: draft.video.id } }),
      prisma.contentRightsDeclaration.findFirstOrThrow({ where: { videoId: draft.video.id } }),
    ]);
    expect(video.contentType).toBe("CREATOR_VIDEO");
    expect(metadata).toBeNull();
    expect(policy).toBeNull();
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

    const [video, metadata, policy] = await Promise.all([
      prisma.video.findUniqueOrThrow({ where: { id: draft.video.id } }),
      prisma.videoCreatorMetadata.findUniqueOrThrow({ where: { videoId: draft.video.id } }),
      prisma.videoPolicy.findUniqueOrThrow({ where: { videoId: draft.video.id } }),
    ]);
    expect(video.contentType).toBe("DOCUMENTARY");
    expect(metadata.tags).toEqual(["cairo", "documentary"]);
    expect(metadata.primaryLanguage).toBe("ar-EG");
    expect(metadata.geoAvailabilityMode).toBeNull();
    expect(metadata.geoCountries).toEqual([]);
    expect(metadata.adBreakOffsetsSeconds).toEqual([90]);
    expect(policy.maturityLevel).toBe("GENERAL");
    expect(policy.ageRestriction).toBe("NONE");
    expect(policy.allowedTerritories).toEqual([]);
    expect(policy.blockedTerritories).toEqual(["US", "GB"]);

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
    expect(rights.statement).toContain("I confirm that I own or have the rights");
    expect(rights.statement).toContain("Creator note: Licensed for AYIN distribution.");
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

  it("rolls back basic details when duration-bound metadata is rejected", async () => {
    const owner = await register("Atomic details", "atomic-details@example.com");
    const draft = await createDraft(owner.cookie, owner.user.channel.id, "Original title");
    const response = await app.inject({
      method: "PATCH",
      url: `/creator/videos/${draft.video.id}`,
      headers: { cookie: owner.cookie },
      payload: {
        title: "Must roll back",
        visibility: "PRIVATE",
        chapters: [{ title: "Outside", startSeconds: 120 }],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("CHAPTER_OUTSIDE_VIDEO");
    const video = await prisma.video.findUniqueOrThrow({ where: { id: draft.video.id } });
    expect(video.title).toBe("Original title");
    expect(video.visibility).toBe("PUBLIC");
    expect(
      await prisma.videoCreatorMetadata.findUnique({ where: { videoId: video.id } }),
    ).toBeNull();
  });

  it("does not commit advanced policy changes when publication lacks rights confirmation", async () => {
    const owner = await register("Atomic rights", "atomic-rights@example.com");
    const draft = await createDraft(owner.cookie, owner.user.channel.id, "Original rights");
    const response = await app.inject({
      method: "POST",
      url: `/creator/videos/${draft.video.id}/publish`,
      headers: { cookie: owner.cookie },
      payload: {
        rightsConfirmed: false,
        tags: ["must-roll-back"],
        maturityLevel: "MATURE",
        contentType: "MOVIE",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("RIGHTS_CONFIRMATION_REQUIRED");
    const video = await prisma.video.findUniqueOrThrow({ where: { id: draft.video.id } });
    expect(video.contentType).toBe("CREATOR_VIDEO");
    expect(video.status).toBe("UPLOADING");
    expect(
      await prisma.videoCreatorMetadata.findUnique({ where: { videoId: video.id } }),
    ).toBeNull();
    expect(await prisma.videoPolicy.findUnique({ where: { videoId: video.id } })).toBeNull();
    expect(await prisma.contentRightsDeclaration.count({ where: { videoId: video.id } })).toBe(0);
  });

  it("rolls back publication, rights and playlist association after a late rights-write failure", async () => {
    const owner = await register("Atomic publish", "atomic-publish@example.com");
    const draft = await createDraft(owner.cookie, owner.user.channel.id, "Original publish");
    await completeAndMarkReady(owner.cookie, draft);
    const spy = vi
      .spyOn(moduleReference.get(VideoMetadataService), "updateRightsForOwner")
      .mockRejectedValueOnce(new Error("Injected late rights-write failure"));
    try {
      const response = await app.inject({
        method: "POST",
        url: `/creator/videos/${draft.video.id}/publish`,
        headers: { cookie: owner.cookie },
        payload: {
          rightsConfirmed: true,
          title: "Must roll back",
          tags: ["must-roll-back"],
          rightsBasis: "LICENSED",
        },
      });
      expect(response.statusCode).toBe(500);
    } finally {
      spy.mockRestore();
    }
    const video = await prisma.video.findUniqueOrThrow({ where: { id: draft.video.id } });
    expect(video.status).toBe("DRAFT");
    expect(video.title).toBe("Original publish");
    expect(video.publishedAt).toBeNull();
    expect(
      await prisma.videoCreatorMetadata.findUnique({ where: { videoId: video.id } }),
    ).toBeNull();
    expect(await prisma.contentRightsDeclaration.count({ where: { videoId: video.id } })).toBe(0);
    expect(await prisma.playlistItem.count({ where: { videoId: video.id } })).toBe(0);
  });

  it("explicitly clears a saved schedule when publishing immediately", async () => {
    const owner = await register("Clear schedule", "clear-schedule@example.com");
    const draft = await createDraft(owner.cookie, owner.user.channel.id, "Clear schedule");
    await completeAndMarkReady(owner.cookie, draft);
    const saved = await app.inject({
      method: "PATCH",
      url: `/creator/videos/${draft.video.id}`,
      headers: { cookie: owner.cookie },
      payload: { scheduledPublishAt: new Date(Date.now() + 86400000).toISOString() },
    });
    expect(saved.statusCode).toBe(200);
    const response = await app.inject({
      method: "POST",
      url: `/creator/videos/${draft.video.id}/publish`,
      headers: { cookie: owner.cookie },
      payload: { rightsConfirmed: true, scheduledPublishAt: null },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().video.status).toBe("PUBLISHED");
    const video = await prisma.video.findUniqueOrThrow({ where: { id: draft.video.id } });
    expect(video.scheduledPublishAt).toBeNull();
    expect(video.publishedAt).not.toBeNull();
  });

  it("waits for a concurrent removal and never revives the removed video", async () => {
    const owner = await register("Concurrent removal", "concurrent-removal@example.com");
    const draft = await createDraft(owner.cookie, owner.user.channel.id, "Removed during publish");
    await completeAndMarkReady(owner.cookie, draft);
    let acquired = () => {},
      release = () => {};
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const removal = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Video" WHERE "id" = ${draft.video.id}::uuid FOR UPDATE`,
        );
        acquired();
        await gate;
        await tx.video.update({ where: { id: draft.video.id }, data: { status: "REMOVED" } });
      },
      { timeout: 15000 },
    );
    await locked;
    const publication = app.inject({
      method: "POST",
      url: `/creator/videos/${draft.video.id}/publish`,
      headers: { cookie: owner.cookie },
      payload: { rightsConfirmed: true, tags: ["must-not-write"] },
    });
    try {
      await vi.waitFor(
        async () => {
          const waiting = await prisma.$queryRaw<Array<{ count: bigint }>>(
            Prisma.sql`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%' AND datname = current_database()`,
          );
          expect(Number(waiting[0]?.count ?? 0)).toBeGreaterThan(0);
        },
        { timeout: 3000 },
      );
    } finally {
      release();
    }
    await removal;
    const response = await publication;
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("VIDEO_REMOVED");
    expect((await prisma.video.findUniqueOrThrow({ where: { id: draft.video.id } })).status).toBe(
      "REMOVED",
    );
    expect(
      await prisma.videoCreatorMetadata.findUnique({ where: { videoId: draft.video.id } }),
    ).toBeNull();
    expect(
      await prisma.contentRightsDeclaration.count({ where: { videoId: draft.video.id } }),
    ).toBe(0);
  });
});
