import { randomUUID } from "node:crypto";

import { createPrismaClient, Prisma } from "@ayin/db";
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
  deletePrefix: vi.fn(async () => undefined),
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
    await prisma.mediaAsset.create({
      data: {
        id: randomUUID(),
        channelId,
        videoId: publicVideoId,
        kind: "SOURCE_VIDEO",
        status: "VALIDATED",
        r2ObjectKey: `channels/${channelId}/media/${publicVideoId}/canonical.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 1024n,
      },
    });

    const rawVideoId = randomUUID();
    await prisma.video.create({
      data: {
        id: rawVideoId,
        channelId,
        slug: `raw-${rawVideoId.slice(0, 8)}`,
        title: "Still Processing",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt: new Date(),
      },
    });
    await prisma.mediaAsset.create({
      data: {
        id: randomUUID(),
        channelId,
        videoId: rawVideoId,
        kind: "SOURCE_VIDEO",
        status: "UPLOADED",
        r2ObjectKey: `channels/${channelId}/media/${rawVideoId}/raw.mov`,
        mimeType: "video/quicktime",
        sizeBytes: 1024n,
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
    expect(body.videos.some((video: { title: string }) => video.title === "Still Processing")).toBe(
      false,
    );
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
  async function authorize(owner: RegisteredUser) {
    const response = await app.inject({
      method: "POST",
      url: `/creator/channels/${owner.user.channel.id}/assets/authorize`,
      headers: { cookie: owner.cookie },
      payload: { kind: "avatar", mimeType: "image/png", sizeBytes: 1024 },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { assetId: string };
  }
  async function waitForChannelLocks(minimum = 1) {
    await vi.waitFor(
      async () => {
        const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(
          Prisma.sql`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%Channel%FOR UPDATE%'`,
        );
        expect(Number(rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(minimum);
      },
      { timeout: 3000, interval: 25 },
    );
  }
  async function heldChannel(
    owner: RegisteredUser,
    work: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    let release!: () => void, acquired!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Channel" WHERE "id" = ${owner.user.channel.id}::uuid FOR UPDATE`,
        );
        acquired();
        await gate;
        await work(tx);
      },
      { timeout: 15000 },
    );
    await ready;
    return { release, holder };
  }
  it("serializes handle changes and preserves every committed old-handle redirect", async () => {
    const owner = await register("Handle race", "handle-race@example.com");
    const lock = await heldChannel(owner, async (tx) => {
      await tx.channel.update({
        where: { id: owner.user.channel.id },
        data: { handle: "intermediate-handle" },
      });
      await tx.channelHandleRedirect.create({
        data: { oldHandle: owner.user.channel.handle, channelId: owner.user.channel.id },
      });
    });
    const update = app.inject({
      method: "PATCH",
      url: `/creator/channels/${owner.user.channel.id}`,
      headers: { cookie: owner.cookie },
      payload: { handle: "final-handle", name: "Final name" },
    });
    try {
      await waitForChannelLocks();
    } finally {
      lock.release();
    }
    await lock.holder;
    const response = await update;
    expect(response.statusCode).toBe(200);
    expect(response.json().previousHandle).toBe("intermediate-handle");
    for (const handle of [owner.user.channel.handle, "intermediate-handle"]) {
      const publicRead = await app.inject({ method: "GET", url: `/public/channels/${handle}` });
      expect(publicRead.statusCode).toBe(200);
      expect(publicRead.json().canonicalHandle).toBe("final-handle");
    }
  });
  it("rechecks concurrent channel removal before editing or changing appearance", async () => {
    const owner = await register("Removed channel", "removed-channel-race@example.com"),
      asset = await authorize(owner);
    const lock = await heldChannel(owner, async (tx) => {
      await tx.channel.update({
        where: { id: owner.user.channel.id },
        data: { status: "REMOVED", removedAt: new Date() },
      });
    });
    const update = app.inject({
      method: "PATCH",
      url: `/creator/channels/${owner.user.channel.id}`,
      headers: { cookie: owner.cookie },
      payload: { name: "Must not save", accentColor: "#ABCDEF" },
    });
    const complete = app.inject({
      method: "POST",
      url: `/creator/channels/${owner.user.channel.id}/assets/complete`,
      headers: { cookie: owner.cookie },
      payload: { assetId: asset.assetId },
    });
    try {
      await waitForChannelLocks(2);
    } finally {
      lock.release();
    }
    await lock.holder;
    expect((await update).statusCode).toBe(404);
    expect((await complete).statusCode).toBe(404);
    expect(
      (await prisma.channel.findUniqueOrThrow({ where: { id: owner.user.channel.id } })).name,
    ).toBe(owner.user.channel.name);
    expect(
      (await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.assetId } })).status,
    ).toBe("PENDING");
    expect(
      (await prisma.channelAppearance.findUnique({ where: { channelId: owner.user.channel.id } }))
        ?.avatarAssetId ?? null,
    ).toBeNull();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });
  it("serializes competing image completions and deletes only the superseded asset", async () => {
    const owner = await register("Image race", "image-race@example.com"),
      first = await authorize(owner),
      second = await authorize(owner);
    const lock = await heldChannel(owner, async () => {});
    const completion = (assetId: string) =>
      app.inject({
        method: "POST",
        url: `/creator/channels/${owner.user.channel.id}/assets/complete`,
        headers: { cookie: owner.cookie },
        payload: { assetId },
      });
    const firstRequest = completion(first.assetId),
      secondRequest = completion(second.assetId);
    try {
      await waitForChannelLocks(2);
    } finally {
      lock.release();
    }
    await lock.holder;
    expect((await firstRequest).statusCode).toBe(201);
    expect((await secondRequest).statusCode).toBe(201);
    const appearance = await prisma.channelAppearance.findUniqueOrThrow({
      where: { channelId: owner.user.channel.id },
    });
    const assets = await prisma.mediaAsset.findMany({
      where: { id: { in: [first.assetId, second.assetId] } },
    });
    expect(assets.filter((asset) => asset.status === "UPLOADED")).toHaveLength(1);
    expect(assets.filter((asset) => asset.status === "REMOVED")).toHaveLength(1);
    const selected = assets.find((asset) => asset.id === appearance.avatarAssetId),
      superseded = assets.find((asset) => asset.id !== appearance.avatarAssetId);
    expect(selected?.status).toBe("UPLOADED");
    expect(superseded?.removedAt).not.toBeNull();
    expect(storage.deleteObject).toHaveBeenCalledExactlyOnceWith(superseded?.r2ObjectKey);
    expect(storage.deleteObject).not.toHaveBeenCalledWith(selected?.r2ObjectKey);
  });
  it("rolls back image state and cleanup if the channel pointer write fails", async () => {
    const owner = await register("Image rollback", "image-rollback@example.com"),
      old = await authorize(owner);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/creator/channels/${owner.user.channel.id}/assets/complete`,
          headers: { cookie: owner.cookie },
          payload: { assetId: old.assetId },
        })
      ).statusCode,
    ).toBe(201);
    const next = await authorize(owner);
    await prisma.$executeRawUnsafe(
      "CREATE FUNCTION ayin_test_channel_image_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test channel pointer failure'; END; $$",
    );
    try {
      await prisma.$executeRawUnsafe(
        'CREATE TRIGGER ayin_test_channel_image_failure BEFORE UPDATE ON "ChannelAppearance" FOR EACH ROW EXECUTE FUNCTION ayin_test_channel_image_failure()',
      );
      const response = await app.inject({
        method: "POST",
        url: `/creator/channels/${owner.user.channel.id}/assets/complete`,
        headers: { cookie: owner.cookie },
        payload: { assetId: next.assetId },
      });
      expect(response.statusCode).toBe(500);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS ayin_test_channel_image_failure ON "ChannelAppearance"',
      );
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS ayin_test_channel_image_failure()");
    }
    expect(
      (await prisma.mediaAsset.findUniqueOrThrow({ where: { id: next.assetId } })).status,
    ).toBe("PENDING");
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: old.assetId } })).status).toBe(
      "UPLOADED",
    );
    expect(
      (
        await prisma.channelAppearance.findUniqueOrThrow({
          where: { channelId: owner.user.channel.id },
        })
      ).avatarAssetId,
    ).toBe(old.assetId);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });
  it("rechecks owner membership after waiting for a concurrent revocation", async () => {
    const owner = await register("Revoked owner", "revoked-owner-channel@example.com");
    const lock = await heldChannel(owner, async (tx) => {
      await tx.channelMember.deleteMany({
        where: {
          channelId: owner.user.channel.id,
          accountId: owner.user.account.id,
          role: "OWNER",
        },
      });
    });
    const update = app.inject({
      method: "PATCH",
      url: `/creator/channels/${owner.user.channel.id}`,
      headers: { cookie: owner.cookie },
      payload: { name: "Must not save" },
    });
    try {
      await waitForChannelLocks();
    } finally {
      lock.release();
    }
    await lock.holder;
    expect((await update).statusCode).toBe(403);
    expect(
      (await prisma.channel.findUniqueOrThrow({ where: { id: owner.user.channel.id } })).name,
    ).toBe(owner.user.channel.name);
  });
  it("rejects duplicate concurrent completion after the first commits", async () => {
    const owner = await register("Duplicate image", "duplicate-channel-image@example.com"),
      asset = await authorize(owner);
    const lock = await heldChannel(owner, async () => {});
    const complete = () =>
      app.inject({
        method: "POST",
        url: `/creator/channels/${owner.user.channel.id}/assets/complete`,
        headers: { cookie: owner.cookie },
        payload: { assetId: asset.assetId },
      });
    const first = complete(),
      second = complete();
    try {
      await waitForChannelLocks(2);
    } finally {
      lock.release();
    }
    await lock.holder;
    const statuses = [(await first).statusCode, (await second).statusCode].sort();
    expect(statuses).toEqual([201, 404]);
    expect(
      (await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.assetId } })).status,
    ).toBe("UPLOADED");
    expect(
      (
        await prisma.channelAppearance.findUniqueOrThrow({
          where: { channelId: owner.user.channel.id },
        })
      ).avatarAssetId,
    ).toBe(asset.assetId);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });
});
