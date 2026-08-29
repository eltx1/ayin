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
  createMultipartUpload: vi.fn(async () => ({ uploadId: "task13-upload" })),
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

interface RegisteredUser {
  user: {
    account: { id: string };
    profile: { id: string };
    channel: { id: string; handle: string };
    creatorTv: { id: string };
  };
}

databaseDescribe("Task 13 search and unified content detail", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-13-test-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET = "task-13-upload-secret-with-more-than-32-characters";
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
    return { user: response.json().user as RegisteredUser["user"] };
  }

  async function createVideo(
    channelId: string,
    title: string,
    visibility: "PUBLIC" | "PRIVATE" = "PUBLIC",
  ) {
    const id = randomUUID();
    const slug = `task13-${id.slice(0, 8)}`;
    await prisma.video.create({
      data: {
        id,
        channelId,
        slug,
        title,
        description: `${title} description`,
        status: "PUBLISHED",
        visibility,
        commentsEnabled: true,
        durationMs: 120_000,
        publishedAt: new Date(),
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
        durationMs: 120_000,
      },
    });
    return { id, slug };
  }

  it("searches real eligible videos, channels, public playlists and Creator TV only", async () => {
    const creator = await register("Nova Creator", "task13-nova@example.com");
    const visible = await createVideo(creator.user.channel.id, "Nova Signal");
    const hidden = await createVideo(creator.user.channel.id, "Nova Hidden", "PRIVATE");
    const playlist = await prisma.playlist.create({
      data: {
        channelId: creator.user.channel.id,
        slug: `nova-picks-${randomUUID().slice(0, 8)}`,
        name: "Nova Picks",
        visibility: "PUBLIC",
        isPublic: true,
      },
    });

    const response = await app.inject({ method: "GET", url: "/public/search?q=Nova&limit=24" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: visible.id, type: "VIDEO" }),
        expect.objectContaining({ id: creator.user.channel.id, type: "CHANNEL" }),
        expect.objectContaining({ id: playlist.id, type: "PLAYLIST" }),
        expect.objectContaining({ id: creator.user.creatorTv.id, type: "CREATOR_TV" }),
      ]),
    );
    expect(body.results.some((item: { id: string }) => item.id === hidden.id)).toBe(false);
    expect(new Set(body.results.map((item: { type: string }) => item.type))).toEqual(
      new Set(["VIDEO", "CHANNEL", "PLAYLIST", "CREATOR_TV"]),
    );
  });

  it("provides deterministic pagination and mixed autocomplete suggestions", async () => {
    const creator = await register("Atlas Search", "task13-atlas@example.com");
    for (let index = 0; index < 9; index += 1) {
      await createVideo(creator.user.channel.id, `Atlas Episode ${String(index).padStart(2, "0")}`);
    }

    const first = await app.inject({
      method: "GET",
      url: "/public/search?q=Atlas&types=VIDEO&limit=4",
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().results).toHaveLength(4);
    expect(first.json().nextCursor).toBeTruthy();

    const second = await app.inject({
      method: "GET",
      url: `/public/search?q=Atlas&types=VIDEO&limit=4&cursor=${encodeURIComponent(first.json().nextCursor)}`,
    });
    expect(second.statusCode).toBe(200);
    const firstIds = new Set(first.json().results.map((item: { id: string }) => item.id));
    expect(second.json().results.every((item: { id: string }) => !firstIds.has(item.id))).toBe(
      true,
    );

    const suggestions = await app.inject({
      method: "GET",
      url: "/public/search/suggestions?q=Atlas",
    });
    expect(suggestions.statusCode).toBe(200);
    expect(suggestions.json().suggestions.length).toBeGreaterThan(0);
    expect(
      suggestions
        .json()
        .suggestions.every((item: { type: string }) =>
          ["VIDEO", "CHANNEL", "PLAYLIST", "CREATOR_TV"].includes(item.type),
        ),
    ).toBe(true);
  });

  it("returns the playback contract plus honest related/action/comment/ad hooks", async () => {
    const creator = await register("Detail Creator", "task13-detail@example.com");
    const primary = await createVideo(creator.user.channel.id, "Detail Primary");
    const related = await createVideo(creator.user.channel.id, "Detail Related");

    const response = await app.inject({
      method: "GET",
      url: `/public/content/videos/${primary.slug}`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      kind: "VIDEO",
      content: { id: primary.id, title: "Detail Primary" },
      playback: { video: { id: primary.id, source: { mimeType: "video/mp4" } } },
      actionHooks: { save: { status: "RESERVED", targetTask: "TASK_14" } },
      slots: { comments: { status: "RESERVED_TASK_15", enabled: true } },
    });
    expect(body.related).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: related.id, type: "VIDEO" })]),
    );
    expect(body.slots.externalAds.map((slot: { key: string }) => slot.key)).toEqual([
      "watch_below_player",
      "content_detail",
    ]);

    const hidden = await createVideo(creator.user.channel.id, "Private Detail", "PRIVATE");
    const hiddenResponse = await app.inject({
      method: "GET",
      url: `/public/content/videos/${hidden.slug}`,
    });
    expect(hiddenResponse.statusCode).toBe(404);
  });

  it("rejects short and malformed search requests safely", async () => {
    const short = await app.inject({ method: "GET", url: "/public/search?q=x" });
    expect(short.statusCode).toBe(400);
    expect(short.json().error.code).toBe("SEARCH_QUERY_TOO_SHORT");

    const invalidType = await app.inject({
      method: "GET",
      url: "/public/search?q=valid&types=MOVIE",
    });
    expect(invalidType.statusCode).toBe(400);
    expect(invalidType.json().error.code).toBe("INVALID_SEARCH_TYPES");
  });
});
