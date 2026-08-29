import { randomUUID } from "node:crypto";

import { createPrismaClient } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AppModule } from "../src/app.module.js";
import { ChannelService } from "../src/creator/channel.service.js";
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
  createMultipartUpload: vi.fn(async () => ({ uploadId: "channel-test-upload" })),
  authorizeMultipartPart: vi.fn(async () => ({
    url: "https://example.invalid/part",
    expiresAt: new Date(Date.now() + 60_000),
  })),
  authorizeSinglePut: vi.fn(async () => ({
    url: "https://example.invalid/channel-image",
    expiresAt: new Date(Date.now() + 60_000),
  })),
  listParts: vi.fn(async () => []),
  completeMultipartUpload: vi.fn(async () => ({ etag: '"complete"' })),
  abortMultipartUpload: vi.fn(async () => undefined),
  headObject: vi.fn(async () => ({
    sizeBytes: 1024,
    contentType: "image/png",
    etag: '"channel-image"',
  })),
  deleteObject: vi.fn(async () => undefined),
  listMultipartUploads: vi.fn(async () => []),
};

interface RegisteredUser {
  cookie: string;
  user: {
    account: { id: string };
    channel: { id: string; handle: string; name: string };
    creatorTv: { id: string; name: string; slug: string };
  };
}

databaseDescribe("Task 08 public creator channels", () => {
  let app: NestFastifyApplication;
  let moduleReference: TestingModule;
  const prisma = createPrismaClient(testDatabaseUrl);

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "task-08-test-auth-secret-with-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET =
      "task-08-upload-session-secret-with-more-than-32-characters";
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

  it("publishes a clean channel boundary with public videos, playlists and Creator TV only", async () => {
    const owner = await register("Public Creator", "public-channel@example.com");
    const channelId = owner.user.channel.id;
    const publicVideoId = randomUUID();

    await prisma.video.create({
      data: {
        id: publicVideoId,
        channelId,
        slug: `public-${publicVideoId.slice(0, 8)}`,
        title: "Visible Worldwide",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt: new Date(),
      },
    });
    await prisma.video.create({
      data: {
        id: randomUUID(),
        channelId,
        slug: `private-${randomUUID().slice(0, 8)}`,
        title: "Private Draft",
        status: "PUBLISHED",
        visibility: "PRIVATE",
        publishedAt: new Date(),
      },
    });
    await prisma.video.create({
      data: {
        id: randomUUID(),
        channelId,
        slug: `draft-${randomUUID().slice(0, 8)}`,
        title: "Unpublished Draft",
        status: "DRAFT",
        visibility: "PUBLIC",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/public/channels/${owner.user.channel.handle}`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.channel.handle).toBe(owner.user.channel.handle);
    expect(body.videos).toHaveLength(1);
    expect(body.videos[0].title).toBe("Visible Worldwide");
    expect(body.playlists.some((playlist: { name: string }) => playlist.name === "Uploads")).toBe(
      true,
    );
    expect(body.creatorTv.name).toBe(owner.user.creatorTv.name);
    expect(body.subscription).toEqual({ available: true, subscriberCount: 0 });
    expect(body.features).toEqual({ shorts: false, posts: false });
  });

  it("lets the owner edit essentials and keeps old handle links durable", async () => {
    const owner = await register("Handle Owner", "handle-owner@example.com");
    const oldHandle = owner.user.channel.handle;

    const update = await app.inject({
      method: "PATCH",
      url: `/creator/channels/${owner.user.channel.id}`,
      headers: { cookie: owner.cookie },
      payload: {
        name: "New Channel Name",
        handle: "new.creator",
        description: "Stories for everyone.",
        accentColor: "#AABBCC",
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().channel.handle).toBe("new.creator");
    expect(update.json().previousHandle).toBe(oldHandle);
    expect(update.json().appearance.accentColor).toBe("#AABBCC");

    const oldLookup = await app.inject({
      method: "GET",
      url: `/public/channels/${oldHandle}`,
    });
    expect(oldLookup.statusCode).toBe(200);
    expect(oldLookup.json().redirectedFrom).toBe(oldHandle);
    expect(oldLookup.json().canonicalHandle).toBe("new.creator");

    const current = await prisma.channel.findUnique({ where: { id: owner.user.channel.id } });
    expect(current?.name).toBe("New Channel Name");
    expect(current?.description).toBe("Stories for everyone.");
  });

  it("rejects handle collisions and another channel owner editing the draft", async () => {
    const first = await register("First Creator", "first-channel@example.com");
    const second = await register("Second Creator", "second-channel@example.com");

    const collision = await app.inject({
      method: "PATCH",
      url: `/creator/channels/${first.user.channel.id}`,
      headers: { cookie: first.cookie },
      payload: { handle: second.user.channel.handle },
    });
    expect(collision.statusCode).toBe(409);
    expect(collision.json().error.code).toBe("CHANNEL_HANDLE_UNAVAILABLE");

    const forbidden = await app.inject({
      method: "PATCH",
      url: `/creator/channels/${first.user.channel.id}`,
      headers: { cookie: second.cookie },
      payload: { name: "Not Yours" },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe("CHANNEL_OWNER_REQUIRED");
  });

  it("keeps an explicit server-authorized admin override boundary in the channel service", async () => {
    const owner = await register("Admin Editable", "admin-editable@example.com");
    const admin = await register("Platform Admin", "platform-admin-channel@example.com");
    await prisma.adminRoleAssignment.create({
      data: { accountId: admin.user.account.id, role: "ADMIN" },
    });

    const service = moduleReference.get(ChannelService);
    const updated = await service.updateChannel(
      { kind: "admin", accountId: admin.user.account.id },
      owner.user.channel.id,
      { description: "Updated through the shared admin-capable service boundary." },
    );
    expect(updated.channel.description).toContain("admin-capable");

    const nonAdmin = await register("Not Admin", "not-admin-channel@example.com");
    await expect(
      service.updateChannel(
        { kind: "admin", accountId: nonAdmin.user.account.id },
        owner.user.channel.id,
        { name: "Blocked" },
      ),
    ).rejects.toMatchObject({ code: "ADMIN_REQUIRED", statusCode: 403 });
  });

  it("authorizes and selects server-keyed R2 channel artwork", async () => {
    const owner = await register("Artwork Creator", "channel-artwork@example.com");
    const authorization = await app.inject({
      method: "POST",
      url: `/creator/channels/${owner.user.channel.id}/assets/authorize`,
      headers: { cookie: owner.cookie },
      payload: {
        kind: "avatar",
        mimeType: "image/png",
        sizeBytes: 1024,
      },
    });
    expect(authorization.statusCode).toBe(201);
    const authorized = authorization.json();
    expect(authorized.assetId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(authorized.upload.url).toBe("https://example.invalid/channel-image");

    const asset = await prisma.mediaAsset.findUnique({ where: { id: authorized.assetId } });
    expect(asset?.r2ObjectKey).toBe(
      `channels/${owner.user.channel.id}/channel-assets/${authorized.assetId}/avatar.png`,
    );

    const completion = await app.inject({
      method: "POST",
      url: `/creator/channels/${owner.user.channel.id}/assets/complete`,
      headers: { cookie: owner.cookie },
      payload: { assetId: authorized.assetId },
    });
    expect(completion.statusCode).toBe(201);
    expect(completion.json().appearance.avatar.assetId).toBe(authorized.assetId);

    const appearance = await prisma.channelAppearance.findUnique({
      where: { channelId: owner.user.channel.id },
    });
    expect(appearance?.avatarAssetId).toBe(authorized.assetId);
  });
});
