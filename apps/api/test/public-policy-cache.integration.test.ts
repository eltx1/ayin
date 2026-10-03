import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { applyApiSecurityHeaders } from "../src/security/request-security.js";
import {
  MEDIA_STORAGE_ADAPTER,
  type MediaStorageAdapter,
} from "../src/media/media-storage.adapter.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const edgeToken = "controlled-public-policy-cache-edge-token-more-than32";
const storage: MediaStorageAdapter = {
  kind: "r2",
  available: true,
  createMultipartUpload: vi.fn(async () => ({ uploadId: "controlled-cache-fixture" })),
  authorizeMultipartPart: vi.fn(async () => ({
    url: "https://example.invalid/part",
    expiresAt: new Date(),
  })),
  authorizeSinglePut: vi.fn(async () => ({
    url: "https://example.invalid/put",
    expiresAt: new Date(),
  })),
  listParts: vi.fn(async () => []),
  completeMultipartUpload: vi.fn(async () => ({ etag: "controlled" })),
  abortMultipartUpload: vi.fn(async () => undefined),
  headObject: vi.fn(async () => ({
    sizeBytes: 1024,
    contentType: "video/mp4",
    etag: "controlled",
  })),
  deleteObject: vi.fn(async () => undefined),
  deletePrefix: vi.fn(async () => undefined),
  listMultipartUploads: vi.fn(async () => []),
};
databaseDescribe("Public responses retain trusted territory policy without shared caching", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "public-policy-cache-test-secret-more-than32";
    process.env.DATABASE_URL = databaseUrl;
    process.env.WEB_ORIGIN = "http://localhost:3000";
    process.env.AYIN_INTERNAL_EDGE_TOKEN = edgeToken;
    process.env.AYIN_TRUST_CLOUDFLARE_REGION = "false";
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MEDIA_STORAGE_ADAPTER)
      .useValue(storage)
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
    fastify.addHook("onRequest", async (request, reply) => {
      applyApiSecurityHeaders(reply, request);
    });
    await app.init();
    await fastify.ready();
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account" CASCADE');
    await prisma.adminAuditLog.deleteMany();
    await prisma.homeRowConfig.deleteMany();
    await prisma.homeRowConfig.create({
      data: {
        key: "new-on-ayin",
        title: "Actual eligible latest",
        source: "NEW_ON_AYIN",
        audience: "ALL",
        position: 1,
        maxItems: 4,
      },
    });
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  async function fixture() {
    const registered = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Actual territory publisher",
        email: `policy-cache-${randomUUID()}@example.com`,
        password: "strong-pass-123",
      },
    });
    expect(registered.statusCode).toBe(201);
    const channelId = registered.json().user.channel.id as string;
    const id = randomUUID(),
      slug = "policy-cache-" + id;
    await prisma.video.create({
      data: {
        id,
        channelId,
        slug,
        title: "Actual DE-only eligible video",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt: new Date(),
        durationMs: 100000,
      },
    });
    await prisma.mediaAsset.create({
      data: {
        channelId,
        videoId: id,
        kind: "SOURCE_VIDEO",
        status: "VALIDATED",
        mimeType: "video/mp4",
        r2ObjectKey: `channels/${channelId}/media/${id}/source.mp4`,
        sizeBytes: 1024n,
        durationMs: 100000,
      },
    });
    await prisma.videoPolicy.create({
      data: {
        videoId: id,
        allowedTerritories: ["DE"],
        kidsEligible: true,
        maturityLevel: "GENERAL",
      },
    });
    return { id, slug };
  }
  function read(url: string, country = "DE", token = edgeToken) {
    return app.inject({
      method: "GET",
      url,
      headers: {
        "x-ayin-edge-country": country,
        "x-ayin-edge-token": token,
        "x-ayin-region-personalization": "allow",
      },
    });
  }
  function privateHeaders(response: { headers: Record<string, unknown> }) {
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers.pragma).toBe("no-cache");
    expect(response.headers["cache-control"]).not.toContain("s-maxage");
  }
  const paths = [
    "/public/discovery/home",
    "/public/discovery/kids",
    "/public/discovery/rows/new-on-ayin?limit=2",
    "/public/discovery/kids/rows/new-on-ayin?limit=2",
  ];
  it("returns different real same-URL discovery/Kids/row availability for trusted DE versus US without shared-cache headers or side effects", async () => {
    const f = await fixture();
    const policy = await prisma.videoPolicy.findUniqueOrThrow({ where: { videoId: f.id } });
    for (const path of paths) {
      const allowed = await read(path);
      expect(allowed.statusCode).toBe(200);
      expect(allowed.body).toContain(f.id);
      privateHeaders(allowed);
      const denied = await read(path, "US");
      expect(denied.statusCode).toBe(200);
      expect(denied.body).not.toContain(f.id);
      expect(denied.body).not.toContain("Actual DE-only eligible video");
      privateHeaders(denied);
      const forged = await read(path, "DE", "untrusted-edge-value");
      expect(forged.statusCode).toBe(200);
      expect(forged.body).not.toContain(f.id);
      privateHeaders(forged);
      expect(allowed.body).not.toContain(edgeToken);
    }
    expect(await prisma.videoPolicy.findUniqueOrThrow({ where: { videoId: f.id } })).toEqual(
      policy,
    );
    expect(await prisma.adminAuditLog.count()).toBe(0);
    expect(storage.authorizeSinglePut).not.toHaveBeenCalled();
    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
  });
  it("keeps real allowed playback and territory/missing404 responses private for the same video URL", async () => {
    const f = await fixture();
    const path = `/public/videos/${f.slug}/playback`;
    const allowed = await read(path);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().video.id).toBe(f.id);
    privateHeaders(allowed);
    for (const [country, token] of [
      ["US", edgeToken],
      ["DE", "untrusted-edge-value"],
    ] as const) {
      const denied = await read(path, country, token);
      expect(denied.statusCode).toBe(404);
      expect(denied.body).not.toContain(f.id);
      expect(denied.body).not.toContain("Actual DE-only eligible video");
      privateHeaders(denied);
    }
    const missing = await read("/public/videos/actual-missing-slug/playback");
    expect(missing.statusCode).toBe(404);
    privateHeaders(missing);
    expect(await prisma.adminAuditLog.count()).toBe(0);
  });
  it("rechecks actual rights expiry on a later same-URL read and never advertises stale/shared playback or discovery", async () => {
    const f = await fixture();
    expect((await read(`/public/videos/${f.slug}/playback`)).statusCode).toBe(200);
    expect((await read(paths[0]!)).body).toContain(f.id);
    await prisma.videoPolicy.update({
      where: { videoId: f.id },
      data: { rightsExpiresAt: new Date(Date.now() - 60000) },
    });
    for (const path of paths) {
      const later = await read(path);
      expect(later.statusCode).toBe(200);
      expect(later.body).not.toContain(f.id);
      privateHeaders(later);
    }
    const denied = await read(`/public/videos/${f.slug}/playback`);
    expect(denied.statusCode).toBe(404);
    expect(denied.body).not.toContain(f.id);
    privateHeaders(denied);
    expect(await prisma.adminAuditLog.count()).toBe(0);
  });
});
