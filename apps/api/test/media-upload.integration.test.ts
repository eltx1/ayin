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

  it("rejects invalid type and oversize files with friendly errors", async () => {
    const owner = await register("Validation Owner", "validation-owner@example.com");
    const invalidType = await app.inject({
      method: "POST",
      url: "/media/uploads/sessions",
      headers: { cookie: owner.cookie },
      payload: { channelId: owner.user.channel.id, sizeBytes: 1024, mimeType: "video/quicktime" },
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

  it("marks a multipart MediaAsset uploaded only after complete succeeds", async () => {
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
});
