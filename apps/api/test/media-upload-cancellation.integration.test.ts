import "reflect-metadata";
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
import { assertUploadByteQuota } from "../src/media/media-upload-admission.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const stored = new Map<string, number>();
const storage: MediaStorageAdapter = {
  kind: "r2",
  available: true,
  createMultipartUpload: vi.fn(async () => ({ uploadId: "controlled-cancel-upload" })),
  authorizeMultipartPart: vi.fn(async () => ({
    url: "https://controlled.invalid/part",
    expiresAt: new Date(Date.now() + 60_000),
  })),
  authorizeSinglePut: vi.fn(async () => ({
    url: "https://controlled.invalid/single",
    expiresAt: new Date(Date.now() + 60_000),
  })),
  listParts: vi.fn(async () => []),
  completeMultipartUpload: vi.fn(async () => ({ etag: '"controlled-complete"' })),
  abortMultipartUpload: vi.fn(async () => undefined),
  headObject: vi.fn(async (key) => {
    const sizeBytes = stored.get(key);
    if (sizeBytes === undefined) throw new Error("Controlled absent object");
    return { sizeBytes, contentType: "video/mp4", etag: '"controlled-object"' };
  }),
  deleteObject: vi.fn(async (key) => {
    stored.delete(key);
  }),
  deletePrefix: vi.fn(async () => undefined),
  listMultipartUploads: vi.fn(async () => []),
};

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

databaseDescribe("legacy upload cancellation and retained cleanup custody", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_TOKEN_SECRET = "controlled-cancellation-auth-secret-more-than32";
    process.env.UPLOAD_SESSION_SECRET = "controlled-cancellation-upload-secret-more-than32";
    process.env.WEB_ORIGIN = "http://localhost:3000";
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MEDIA_STORAGE_ADAPTER)
      .useValue(storage)
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    stored.clear();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account", "Channel" CASCADE');
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function fixture(sizeBytes = 1024) {
    const registered = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Controlled cancellation owner",
        email: `cancel-${randomUUID()}@example.com`,
        password: "strong-pass-123",
      },
    });
    expect(registered.statusCode).toBe(201);
    const setCookie = registered.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";", 1)[0];
    if (!cookie) throw new Error("Expected a real test session cookie");
    const user = registered.json().user;
    const created = await app.inject({
      method: "POST",
      url: "/media/uploads/sessions",
      headers: { cookie },
      payload: { channelId: user.channel.id, sizeBytes, mimeType: "video/mp4" },
    });
    expect(created.statusCode).toBe(201);
    const session = created.json();
    const video = await prisma.video.create({
      data: {
        channelId: user.channel.id,
        slug: `controlled-cancel-${session.assetId}`,
        title: "Controlled cancellation source",
        status: "UPLOADING",
      },
    });
    await prisma.mediaAsset.update({ where: { id: session.assetId }, data: { videoId: video.id } });
    stored.set(session.objectKey, sizeBytes);
    return { cookie, session, video, user, sizeBytes };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function send(f: Fixture, path: "abort" | "complete") {
    return app
      .inject({
        method: "POST",
        url: `/media/uploads/sessions/${path}`,
        headers: { cookie: f.cookie },
        payload: {
          sessionToken: f.session.sessionToken,
          ...(path === "complete"
            ? {
                parts: Array.from({ length: f.session.partCount ?? 0 }, (_, index) => ({
                  partNumber: index + 1,
                  etag: `controlled-${index + 1}`,
                })),
              }
            : {}),
        },
      })
      .then((response) => response);
  }
  async function assertRetained(f: Fixture, kinds: string[]) {
    const session = await prisma.mediaUploadSession.findUnique({
      where: { sourceAssetId: f.session.assetId },
    });
    expect(session).toMatchObject({
      sourceProtocolVersion: 1,
      state: "ABORTED",
      contentIdentityDigest: null,
      lastGrantExpiresAt: null,
      objectKey: f.session.objectKey,
      channelId: f.user.channel.id,
    });
    expect(session?.grantsRevokedAt).not.toBeNull();
    expect(session?.cleanupRequestedAt).not.toBeNull();
    const jobs = await prisma.privacyMediaDeletionJob.findMany({
      where: { uploadSessionId: session!.id },
    });
    expect(jobs.map((job) => job.kind).sort()).toEqual(kinds.sort());
    expect(jobs.every((job) => job.cleanupContractVersion === 1 && job.status !== "DONE")).toBe(
      true,
    );
    await expect(
      prisma.$transaction((tx) => assertUploadByteQuota(tx, f.user.channel.id, 1, f.sizeBytes)),
    ).rejects.toMatchObject({ code: "CHANNEL_UPLOAD_QUOTA_REACHED" });
    expect(await prisma.mediaProcessingJob.count({ where: { videoId: f.video.id } })).toBe(0);
  }

  it("fences completion before a dispatched single-object cancellation deletes its source", async () => {
    const f = await fixture();
    const entered = gate();
    const finish = gate();
    vi.mocked(storage.deleteObject).mockImplementationOnce(async (key) => {
      entered.release();
      await finish.promise;
      stored.delete(key);
    });
    const abort = send(f, "abort");
    await entered.promise;
    let completion;
    try {
      completion = await send(f, "complete");
    } finally {
      finish.release();
    }
    const aborted = await abort;
    expect(completion.statusCode).toBe(409);
    expect(aborted.statusCode).toBe(201);
    expect(stored.has(f.session.objectKey)).toBe(false);
    await assertRetained(f, ["OBJECT"]);
  });

  it("retains source and allocation custody when an in-flight multipart Complete writes after Abort", async () => {
    const f = await fixture(70 * 1024 * 1024);
    stored.delete(f.session.objectKey);
    const entered = gate();
    const finish = gate();
    vi.mocked(storage.completeMultipartUpload).mockImplementationOnce(async ({ key }) => {
      entered.release();
      await finish.promise;
      stored.set(key, f.sizeBytes);
      return { etag: '"late-controlled-complete"' };
    });
    const complete = send(f, "complete");
    await entered.promise;
    let aborted;
    try {
      aborted = await send(f, "abort");
    } finally {
      finish.release();
    }
    const completed = await complete;
    expect(aborted.statusCode).toBe(201);
    expect(completed.statusCode).toBe(409);
    expect(stored.has(f.session.objectKey)).toBe(true);
    await assertRetained(f, ["OBJECT", "ALLOCATION", "MULTIPART"]);
  });

  it("keeps failed physical deletion visible and repeated cancellation idempotent", async () => {
    const f = await fixture();
    vi.mocked(storage.deleteObject).mockRejectedValueOnce(new Error("Controlled provider failure"));
    expect((await send(f, "abort")).statusCode).toBe(201);
    expect(stored.has(f.session.objectKey)).toBe(true);
    await assertRetained(f, ["OBJECT"]);
    const before = await prisma.privacyMediaDeletionJob.findMany({
      where: { sourceAssetId: f.session.assetId },
      select: { id: true },
    });
    expect((await send(f, "abort")).statusCode).toBe(201);
    expect(
      await prisma.privacyMediaDeletionJob.findMany({
        where: { sourceAssetId: f.session.assetId },
        select: { id: true },
      }),
    ).toEqual(before);
    await assertRetained(f, ["OBJECT"]);
  });
});
