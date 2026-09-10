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
const validVtt = () =>
  new TextEncoder().encode(
    "WEBVTT\n\n00:00.000 --> 00:02.000\nHello AYIN\n\n00:03.000 --> 00:05.000\nSecond cue\n",
  );
let captionBytes = validVtt();
let captionMime = "text/vtt";

function cookiePair(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) throw new Error("Expected a session cookie.");
  return value.split(";", 1)[0] ?? value;
}

const storage: MediaStorageAdapter = {
  kind: "r2",
  available: true,
  createMultipartUpload: vi.fn(async () => ({ uploadId: "caption-test-upload" })),
  authorizeMultipartPart: vi.fn(async () => ({
    url: "https://example.invalid/part",
    expiresAt: new Date(Date.now() + 60_000),
  })),
  authorizeSinglePut: vi.fn(async () => ({
    url: "https://example.invalid/caption.vtt",
    expiresAt: new Date(Date.now() + 60_000),
  })),
  listParts: vi.fn(async () => []),
  completeMultipartUpload: vi.fn(async () => ({ etag: '"complete"' })),
  abortMultipartUpload: vi.fn(async () => undefined),
  headObject: vi.fn(async () => ({
    sizeBytes: captionBytes.byteLength,
    contentType: captionMime,
    etag: '"caption-etag"',
  })),
  readObject: vi.fn(async () => captionBytes),
  deleteObject: vi.fn(async () => undefined),
  deletePrefix: vi.fn(async () => undefined),
  listMultipartUploads: vi.fn(async () => []),
};

databaseDescribe("captions and chapter playback", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-52-test-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET =
      "task-52-upload-session-secret-with-more-than-32-characters";
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
    captionBytes = validVtt();
    captionMime = "text/vtt";
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

  async function createPlayableVideo(channelId: string, suffix: string) {
    const video = await prisma.video.create({
      data: {
        channelId,
        slug: `caption-${suffix}`,
        title: `Caption ${suffix}`,
        status: "PUBLISHED",
        visibility: "PUBLIC",
        durationMs: 60_000,
        publishedAt: new Date(),
      },
    });
    await prisma.mediaAsset.create({
      data: {
        videoId: video.id,
        channelId,
        kind: "SOURCE_VIDEO",
        status: "VALIDATED",
        r2ObjectKey: `videos/${video.id}/canonical.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 4096n,
        durationMs: 60_000,
      },
    });
    return video;
  }

  it("uploads a default WebVTT track and exposes validated captions plus chapters in playback", async () => {
    const owner = await register("Caption Owner", "caption-owner@example.com");
    const video = await createPlayableVideo(owner.user.channel.id, "public");
    const chapters = [
      { title: "Opening", startSeconds: 0 },
      { title: "Main story", startSeconds: 20 },
      { title: "Ending", startSeconds: 50 },
    ];
    const metadata = await app.inject({
      method: "PATCH",
      url: `/creator/studio/videos/${video.id}`,
      headers: { cookie: owner.cookie },
      payload: { chapters },
    });
    expect(metadata.statusCode).toBe(200);

    const prepared = await app.inject({
      method: "POST",
      url: `/creator/studio/videos/${video.id}/captions/uploads`,
      headers: { cookie: owner.cookie },
      payload: {
        fileName: "english.vtt",
        sizeBytes: captionBytes.byteLength,
        mimeType: "text/vtt",
        languageCode: "en-US",
        label: "English CC",
        kind: "CAPTIONS",
        default: true,
      },
    });
    expect(prepared.statusCode).toBe(201);
    expect(prepared.json().uploadUrl).toContain("caption.vtt");

    const finalized = await app.inject({
      method: "POST",
      url: `/creator/studio/videos/${video.id}/captions/${prepared.json().trackId}/finalize`,
      headers: { cookie: owner.cookie },
      payload: {},
    });
    expect(finalized.statusCode).toBe(201);
    expect(finalized.json()).toMatchObject({ status: "READY", cueCount: 2 });

    const playback = await app.inject({
      method: "GET",
      url: `/public/videos/${video.slug}/playback`,
    });
    expect(playback.statusCode).toBe(200);
    expect(playback.json().video.captions).toHaveLength(1);
    expect(playback.json().video.captions[0]).toMatchObject({
      label: "English CC",
      language: "en-US",
      kind: "CAPTIONS",
      default: true,
    });
    expect(playback.json().video.chapters).toEqual([
      { id: "chapter-0-0", title: "Opening", startMs: 0 },
      { id: "chapter-1-20000", title: "Main story", startMs: 20_000 },
      { id: "chapter-2-50000", title: "Ending", startMs: 50_000 },
    ]);
  });

  it("rejects invalid WebVTT without replacing an existing valid track", async () => {
    const owner = await register("Replace Owner", "caption-replace@example.com");
    const video = await createPlayableVideo(owner.user.channel.id, "replace");
    const prepared = await app.inject({
      method: "POST",
      url: `/creator/studio/videos/${video.id}/captions/uploads`,
      headers: { cookie: owner.cookie },
      payload: {
        fileName: "track.vtt",
        sizeBytes: captionBytes.byteLength,
        mimeType: "text/vtt",
        languageCode: "en",
        label: "English",
        kind: "SUBTITLES",
        default: false,
      },
    });
    await app.inject({
      method: "POST",
      url: `/creator/studio/videos/${video.id}/captions/${prepared.json().trackId}/finalize`,
      headers: { cookie: owner.cookie },
      payload: {},
    });
    const before = await prisma.videoCaptionTrack.findUniqueOrThrow({
      where: { id: prepared.json().trackId },
    });

    captionBytes = new TextEncoder().encode("not webvtt");
    const replacement = await app.inject({
      method: "POST",
      url: `/creator/studio/videos/${video.id}/captions/${before.id}/uploads`,
      headers: { cookie: owner.cookie },
      payload: {
        fileName: "bad.vtt",
        sizeBytes: captionBytes.byteLength,
        mimeType: "text/vtt",
      },
    });
    expect(replacement.statusCode).toBe(201);
    const invalid = await app.inject({
      method: "POST",
      url: `/creator/studio/videos/${video.id}/captions/${before.id}/finalize`,
      headers: { cookie: owner.cookie },
      payload: {},
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("CAPTION_WEBVTT_INVALID");
    const after = await prisma.videoCaptionTrack.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.mediaAssetId).toBe(before.mediaAssetId);
    expect(after.pendingMediaAssetId).toBeNull();
  });

  it("enforces ownership and enable/default/remove lifecycle", async () => {
    const owner = await register("Track Owner", "track-owner@example.com");
    const other = await register("Track Other", "track-other@example.com");
    const video = await createPlayableVideo(owner.user.channel.id, "ownership");

    const forbidden = await app.inject({
      method: "POST",
      url: `/creator/studio/videos/${video.id}/captions/uploads`,
      headers: { cookie: other.cookie },
      payload: {
        fileName: "english.vtt",
        sizeBytes: captionBytes.byteLength,
        mimeType: "text/vtt",
        languageCode: "en",
        label: "English",
        kind: "SUBTITLES",
        default: true,
      },
    });
    expect(forbidden.statusCode).toBe(403);

    const prepared = await app.inject({
      method: "POST",
      url: `/creator/studio/videos/${video.id}/captions/uploads`,
      headers: { cookie: owner.cookie },
      payload: {
        fileName: "english.vtt",
        sizeBytes: captionBytes.byteLength,
        mimeType: "text/vtt",
        languageCode: "en",
        label: "English",
        kind: "SUBTITLES",
        default: true,
      },
    });
    const trackId = prepared.json().trackId as string;
    await app.inject({
      method: "POST",
      url: `/creator/studio/videos/${video.id}/captions/${trackId}/finalize`,
      headers: { cookie: owner.cookie },
      payload: {},
    });
    const disabled = await app.inject({
      method: "PATCH",
      url: `/creator/studio/videos/${video.id}/captions/${trackId}`,
      headers: { cookie: owner.cookie },
      payload: { enabled: false },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toMatchObject({ enabled: false, default: false });

    const hiddenPlayback = await app.inject({
      method: "GET",
      url: `/public/videos/${video.slug}/playback`,
    });
    expect(hiddenPlayback.json().video.captions).toHaveLength(0);

    const removed = await app.inject({
      method: "DELETE",
      url: `/creator/studio/videos/${video.id}/captions/${trackId}`,
      headers: { cookie: owner.cookie },
    });
    expect(removed.statusCode).toBe(200);
    expect(await prisma.videoCaptionTrack.findUnique({ where: { id: trackId } })).toBeNull();
  });
});
