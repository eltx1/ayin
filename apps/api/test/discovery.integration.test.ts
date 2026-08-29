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

const storage: MediaStorageAdapter = {
  kind: "r2",
  available: true,
  createMultipartUpload: vi.fn(async () => ({ uploadId: "discovery-upload" })),
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
  headObject: vi.fn(async () => ({ sizeBytes: 1024, contentType: "video/mp4", etag: '"video"' })),
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
    profile: { id: string };
    channel: { id: string };
  };
}

databaseDescribe("Task 12 discovery and My AYIN", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-12-test-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET = "task-12-upload-secret-with-more-than-32-characters";
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
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "PlatformSetting" CASCADE');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "HomeRowConfig" CASCADE');
    await prisma.homeRowConfig.createMany({
      data: [
        {
          key: "continue-watching",
          title: "Continue Watching",
          source: "CONTINUE_WATCHING",
          audience: "AUTHENTICATED",
          position: 10,
          maxItems: 4,
        },
        {
          key: "new-on-ayin",
          title: "New on AYIN",
          source: "NEW_ON_AYIN",
          audience: "ALL",
          position: 20,
          maxItems: 4,
        },
        {
          key: "creator-tv",
          title: "Creator TV",
          source: "CREATOR_TV",
          audience: "ALL",
          position: 30,
          maxItems: 4,
        },
        {
          key: "popular-region",
          title: "Popular Near You",
          source: "POPULAR_REGION",
          audience: "ALL",
          enabled: true,
          position: 40,
          maxItems: 4,
          regionPersonalizationRequired: true,
        },
      ],
    });
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

  async function publishVideo(channelId: string, title: string, publishedAt = new Date()) {
    const id = randomUUID();
    const slug = `task12-${id.slice(0, 8)}`;
    await prisma.video.create({
      data: {
        id,
        channelId,
        slug,
        title,
        status: "PUBLISHED",
        visibility: "PUBLIC",
        durationMs: 100_000,
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
        mimeType: "video/mp4",
        sizeBytes: 1024n,
        durationMs: 100_000,
      },
    });
    return { id, slug };
  }

  it("renders configured rows in database order using only real eligible data", async () => {
    const viewer = await register("Discovery Viewer", "task12-viewer@example.com");
    const video = await publishVideo(viewer.user.channel.id, "Real discovery video");
    await app.inject({
      method: "PUT",
      url: `/watch/progress/${video.id}`,
      headers: { cookie: viewer.cookie },
      payload: { positionMs: 25_000, durationMs: 100_000 },
    });

    const authenticated = await app.inject({
      method: "GET",
      url: "/discovery/home",
      headers: { cookie: viewer.cookie },
    });
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.json().rows.map((row: { key: string }) => row.key)).toEqual([
      "continue-watching",
      "new-on-ayin",
      "creator-tv",
    ]);
    expect(authenticated.json().rows[0].items[0]).toMatchObject({
      type: "VIDEO",
      title: "Real discovery video",
      progress: { positionMs: 25_000 },
    });

    const publicHome = await app.inject({ method: "GET", url: "/public/discovery/home" });
    expect(publicHome.statusCode).toBe(200);
    expect(publicHome.json().rows.map((row: { key: string }) => row.key)).toEqual([
      "new-on-ayin",
      "creator-tv",
    ]);
  });

  it("paginates large rows without per-item queries or fake catalog entries", async () => {
    const viewer = await register("Paging Viewer", "task12-paging@example.com");
    await publishVideo(viewer.user.channel.id, "Newest", new Date("2026-08-29T01:00:00Z"));
    await publishVideo(viewer.user.channel.id, "Middle", new Date("2026-08-28T01:00:00Z"));
    await publishVideo(viewer.user.channel.id, "Oldest", new Date("2026-08-27T01:00:00Z"));

    const first = await app.inject({
      method: "GET",
      url: "/public/discovery/rows/new-on-ayin?limit=1",
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(1);
    expect(first.json().items[0].title).toBe("Newest");
    expect(first.json().nextCursor).toBeTruthy();

    const second = await app.inject({
      method: "GET",
      url: `/public/discovery/rows/new-on-ayin?limit=1&cursor=${encodeURIComponent(first.json().nextCursor as string)}`,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().items).toHaveLength(1);
    expect(second.json().items[0].title).toBe("Middle");
  });

  it("builds My AYIN from the selected profile and rejects cross-account profile access", async () => {
    const owner = await register("Library Owner", "task12-owner@example.com");
    const stranger = await register("Other Viewer", "task12-other@example.com");
    const video = await publishVideo(owner.user.channel.id, "Profile-owned activity");
    const secondProfile = await prisma.viewerProfile.create({
      data: {
        accountId: owner.user.account.id,
        name: "Second profile",
        slug: "second-profile",
      },
    });
    await prisma.watchLaterItem.create({
      data: { profileId: secondProfile.id, videoId: video.id },
    });
    await prisma.reaction.create({
      data: { profileId: secondProfile.id, videoId: video.id, type: "LIKE" },
    });

    const library = await app.inject({
      method: "GET",
      url: `/discovery/my-ayin?profileId=${secondProfile.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(library.statusCode).toBe(200);
    const sections = Object.fromEntries(
      library.json().sections.map((section: { key: string; items: unknown[] }) => [section.key, section]),
    ) as Record<string, { items: Array<{ title: string }>; availability: string }>;
    expect(sections["watch-later"]?.items[0]?.title).toBe("Profile-owned activity");
    expect(sections.liked?.items[0]?.title).toBe("Profile-owned activity");
    expect(sections["my-list"]?.availability).toBe("UNAVAILABLE");

    const forbidden = await app.inject({
      method: "GET",
      url: `/discovery/my-ayin?profileId=${secondProfile.id}`,
      headers: { cookie: stranger.cookie },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("suppresses regional discovery unless both a signal and privacy permission are present", async () => {
    const withoutSignal = await app.inject({ method: "GET", url: "/public/discovery/home" });
    expect(withoutSignal.json().rows.some((row: { key: string }) => row.key === "popular-region")).toBe(false);

    const withSignal = await app.inject({
      method: "GET",
      url: "/public/discovery/home",
      headers: {
        "x-ayin-region": "EU-WEST",
        "x-ayin-region-personalization": "allow",
      },
    });
    const regional = withSignal.json().rows.find(
      (row: { key: string }) => row.key === "popular-region",
    ) as { availability: string; items: unknown[] } | undefined;
    expect(regional).toMatchObject({ availability: "UNAVAILABLE", items: [] });
  });
});
