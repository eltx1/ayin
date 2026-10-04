import "reflect-metadata";
import { createHmac } from "node:crypto";

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

const storage: MediaStorageAdapter = {
  kind: "r2",
  available: true,
  createMultipartUpload: vi.fn(async () => ({ uploadId: "mock-upload-id" })),
  authorizeMultipartPart: vi.fn(async () => ({
    url: "https://example.invalid/part",
    expiresAt: new Date(Date.now() + 60_000),
  })),
  authorizeSinglePut: vi.fn(async () => ({
    url: "https://example.invalid/single",
    expiresAt: new Date(Date.now() + 60_000),
  })),
  listParts: vi.fn(async () => []),
  completeMultipartUpload: vi.fn(async () => ({ etag: '"complete"' })),
  abortMultipartUpload: vi.fn(async () => undefined),
  headObject: vi.fn(async () => ({
    sizeBytes: 1024,
    contentType: "video/mp4",
    etag: '"single"',
  })),
  deleteObject: vi.fn(async () => undefined),
  deletePrefix: vi.fn(async () => undefined),
  listMultipartUploads: vi.fn(async () => []),
};

databaseDescribe("direct creator media upload", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-06-test-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET =
      "task-06-upload-session-secret-with-more-than-32-characters";
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

  it("requires authentication and channel ownership", async () => {
    const owner = await register("Owner", "owner-upload@example.com");
    const other = await register("Other", "other-upload@example.com");
    const payload = {
      channelId: other.user.channel.id,
      sizeBytes: 70 * 1024 * 1024,
      mimeType: "video/mp4",
    };

    const unauthenticated = await app.inject({
      method: "POST",
      url: "/media/uploads/sessions",
      payload,
    });
    expect(unauthenticated.statusCode).toBe(401);

    const wrongOwner = await app.inject({
      method: "POST",
      url: "/media/uploads/sessions",
      headers: { cookie: owner.cookie },
      payload,
    });
    expect(wrongOwner.statusCode).toBe(403);
    expect(wrongOwner.json().error.code).toBe("CHANNEL_OWNER_REQUIRED");
  });

  it("uses a stable server-generated asset id in an owner-scoped R2 key", async () => {
    const owner = await register("Key Owner", "key-owner@example.com");
    const response = await app.inject({
      method: "POST",
      url: "/media/uploads/sessions",
      headers: { cookie: owner.cookie },
      payload: {
        channelId: owner.user.channel.id,
        sizeBytes: 70 * 1024 * 1024,
        mimeType: "video/mp4",
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.objectKey).toBe(
      `channels/${owner.user.channel.id}/media/${body.assetId}/source.mp4`,
    );
    expect(body.objectKey).not.toContain("../");
    expect(body.mode).toBe("multipart");
  });

  it("accepts common processing source formats and preserves their source extension", async () => {
    const owner = await register("Format Owner", "format-owner@example.com");
    const formats = [
      ["video/quicktime", "mov"],
      ["video/x-matroska", "mkv"],
      ["video/webm", "webm"],
      ["video/x-msvideo", "avi"],
      ["video/mpeg", "mpeg"],
      ["video/mp2t", "m2ts"],
      ["video/3gpp", "3gp"],
      ["video/x-m4v", "m4v"],
      ["video/x-ms-wmv", "wmv"],
      ["video/x-flv", "flv"],
      ["video/ogg", "ogv"],
      ["application/mxf", "mxf"],
    ] as const;

    for (const [mimeType, extension] of formats) {
      const response = await app.inject({
        method: "POST",
        url: "/media/uploads/sessions",
        headers: { cookie: owner.cookie },
        payload: { channelId: owner.user.channel.id, sizeBytes: 1024, mimeType },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().objectKey).toMatch(new RegExp(`source\\.${extension}$`, "u"));
    }
  });

  it("rejects invalid type and oversize files with friendly errors", async () => {
    const owner = await register("Validation Owner", "validation-owner@example.com");
    const invalidType = await app.inject({
      method: "POST",
      url: "/media/uploads/sessions",
      headers: { cookie: owner.cookie },
      payload: {
        channelId: owner.user.channel.id,
        sizeBytes: 1024,
        mimeType: "application/octet-stream",
      },
    });
    expect(invalidType.statusCode).toBe(400);
    expect(invalidType.json().error.code).toBe("UNSUPPORTED_VIDEO_TYPE");

    const tooLarge = await app.inject({
      method: "POST",
      url: "/media/uploads/sessions",
      headers: { cookie: owner.cookie },
      payload: {
        channelId: owner.user.channel.id,
        sizeBytes: 6 * 1024 * 1024 * 1024,
        mimeType: "video/mp4",
      },
    });
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json().error.code).toBe("VIDEO_TOO_LARGE");
  });

  it("marks a multipart MediaAsset uploaded only after completion and matching object metadata", async () => {
    const owner = await register("Multipart Owner", "multipart-owner@example.com");
    const created = await app.inject({
      method: "POST",
      url: "/media/uploads/sessions",
      headers: { cookie: owner.cookie },
      payload: {
        channelId: owner.user.channel.id,
        sizeBytes: 70 * 1024 * 1024,
        mimeType: "video/mp4",
      },
    });
    const session = created.json();
    const before = await prisma.mediaAsset.findUnique({ where: { id: session.assetId } });
    expect(before?.status).toBe("PENDING");

    const parts = Array.from({ length: session.partCount as number }, (_, index) => ({
      partNumber: index + 1,
      etag: `etag-${index + 1}`,
    }));
    vi.mocked(storage.headObject).mockResolvedValueOnce({
      sizeBytes: 70 * 1024 * 1024,
      contentType: "video/mp4",
      etag: '"verified"',
    });
    const completed = await app.inject({
      method: "POST",
      url: "/media/uploads/sessions/complete",
      headers: { cookie: owner.cookie },
      payload: { sessionToken: session.sessionToken, parts },
    });
    expect(completed.statusCode).toBe(201);
    expect(completed.json()).toEqual({ assetId: session.assetId, status: "UPLOADED" });
    expect(storage.completeMultipartUpload).toHaveBeenCalledOnce();
    const after = await prisma.mediaAsset.findUnique({ where: { id: session.assetId } });
    expect(after?.status).toBe("UPLOADED");
  });
  async function tokenFixture() {
    const owner = await register("Token boundary owner", "token-boundary@example.com");
    const created = await app.inject({
      method: "POST",
      url: "/media/uploads/sessions",
      headers: { cookie: owner.cookie },
      payload: {
        channelId: owner.user.channel.id,
        sizeBytes: 70 * 1024 * 1024,
        mimeType: "video/mp4",
      },
    });
    expect(created.statusCode).toBe(201);
    const session = created.json();
    const video = await prisma.video.create({
      data: {
        channelId: owner.user.channel.id,
        slug: "token-boundary-" + session.assetId,
        title: "Actual pending source fixture",
        status: "UPLOADING",
      },
    });
    await prisma.mediaAsset.update({ where: { id: session.assetId }, data: { videoId: video.id } });
    vi.clearAllMocks();
    return { owner, session, videoId: video.id };
  }
  for (const invalid of ["TRAILING", "OVERSIZED", "SIGNED_UNSAFE"] as const)
    it(
      "rejects actual upload token " +
        invalid +
        " across all continuation endpoints before provider/database effects",
      async () => {
        const { owner, session } = await tokenFixture();
        let token: string = session.sessionToken;
        if (invalid === "TRAILING") token += ".ignored";
        if (invalid === "OVERSIZED") token = "x".repeat(16 * 1024 + 1);
        if (invalid === "SIGNED_UNSAFE") {
          const payload = JSON.parse(
            Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"),
          );
          payload.sizeBytes = Number.MAX_SAFE_INTEGER + 1;
          const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
          token =
            encoded +
            "." +
            createHmac("sha256", "task-06-upload-session-secret-with-more-than-32-characters")
              .update(encoded)
              .digest("base64url");
        }
        const before = await prisma.mediaAsset.findMany({ orderBy: { id: "asc" } });
        for (const path of ["authorize-part", "resume", "complete", "abort"]) {
          const response = await app.inject({
            method: "POST",
            url: "/media/uploads/sessions/" + path,
            headers: { cookie: owner.cookie },
            payload: {
              sessionToken: token,
              ...(path === "authorize-part" ? { partNumber: 1 } : {}),
              ...(path === "complete"
                ? { parts: [{ partNumber: 1, etag: "actual-fixture-etag" }] }
                : {}),
            },
          });
          expect(response.statusCode).toBe(invalid === "OVERSIZED" ? 400 : 401);
        }
        expect(await prisma.mediaAsset.findMany({ orderBy: { id: "asc" } })).toEqual(before);
        for (const method of [
          storage.authorizeMultipartPart,
          storage.listParts,
          storage.completeMultipartUpload,
          storage.abortMultipartUpload,
          storage.headObject,
          storage.deleteObject,
        ])
          expect(method).not.toHaveBeenCalled();
      },
    );
  it("preserves an actual valid V1 multipart token for explicit part authorization and resume", async () => {
    const { owner, session } = await tokenFixture();
    const before = await prisma.mediaAsset.findMany({ orderBy: { id: "asc" } });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/media/uploads/sessions/authorize-part",
          headers: { cookie: owner.cookie },
          payload: { sessionToken: session.sessionToken, partNumber: 1 },
        })
      ).statusCode,
    ).toBe(201);
    const resume = await app.inject({
      method: "POST",
      url: "/media/uploads/sessions/resume",
      headers: { cookie: owner.cookie },
      payload: { sessionToken: session.sessionToken },
    });
    expect(resume.statusCode).toBe(201);
    expect(resume.json()).toEqual({ parts: [] });
    expect(storage.authorizeMultipartPart).toHaveBeenCalledOnce();
    expect(storage.listParts).toHaveBeenCalledOnce();
    expect(await prisma.mediaAsset.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });
  for (const mismatch of ["SIZE", "TYPE", "MISSING"] as const)
    it(
      "actual multipart completion with " +
        mismatch +
        " metadata never marks uploaded or enqueues processing",
      async () => {
        const { owner, session } = await tokenFixture();
        const before = await prisma.mediaAsset.findMany({ orderBy: { id: "asc" } });
        const jobs = await prisma.mediaProcessingJob.findMany({ orderBy: { id: "asc" } });
        if (mismatch === "MISSING")
          vi.mocked(storage.headObject).mockRejectedValueOnce(
            new Error("Controlled absent final object"),
          );
        else
          vi.mocked(storage.headObject).mockResolvedValueOnce({
            sizeBytes: mismatch === "SIZE" ? 1024 : 70 * 1024 * 1024,
            contentType: mismatch === "TYPE" ? "text/html" : "video/mp4",
            etag: '"controlled"',
          });
        const response = await app.inject({
          method: "POST",
          url: "/media/uploads/sessions/complete",
          headers: { cookie: owner.cookie },
          payload: {
            sessionToken: session.sessionToken,
            parts: Array.from({ length: session.partCount }, (_, i) => ({
              partNumber: i + 1,
              etag: "actual-" + i,
            })),
          },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe("UPLOAD_SIZE_OR_TYPE_MISMATCH");
        expect(storage.completeMultipartUpload).toHaveBeenCalledOnce();
        expect(storage.headObject).toHaveBeenCalledOnce();
        expect(await prisma.mediaAsset.findMany({ orderBy: { id: "asc" } })).toEqual(before);
        expect(await prisma.mediaProcessingJob.findMany({ orderBy: { id: "asc" } })).toEqual(jobs);
      },
    );
  it("uncertain actual multipart completion recovers only from matching final metadata and repeats no processing job", async () => {
    const { owner, session } = await tokenFixture();
    vi.mocked(storage.completeMultipartUpload).mockRejectedValueOnce(
      new Error("Controlled lost provider completion response"),
    );
    vi.mocked(storage.headObject).mockResolvedValueOnce({
      sizeBytes: 70 * 1024 * 1024,
      contentType: "video/mp4",
      etag: '"actual-final"',
    });
    const payload = {
      sessionToken: session.sessionToken,
      parts: Array.from({ length: session.partCount }, (_, i) => ({
        partNumber: i + 1,
        etag: "actual-" + i,
      })),
    };
    const first = await app.inject({
      method: "POST",
      url: "/media/uploads/sessions/complete",
      headers: { cookie: owner.cookie },
      payload,
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().status).toBe("UPLOADED");
    const jobs = await prisma.mediaProcessingJob.findMany({
      where: { inputR2ObjectKey: session.objectKey },
      orderBy: { id: "asc" },
    });
    expect(jobs).toHaveLength(1);
    const retry = await app.inject({
      method: "POST",
      url: "/media/uploads/sessions/complete",
      headers: { cookie: owner.cookie },
      payload,
    });
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect(storage.completeMultipartUpload).toHaveBeenCalledOnce();
    expect(storage.headObject).toHaveBeenCalledOnce();
    expect(
      await prisma.mediaProcessingJob.findMany({
        where: { inputR2ObjectKey: session.objectKey },
        orderBy: { id: "asc" },
      }),
    ).toEqual(jobs);
  });
});
