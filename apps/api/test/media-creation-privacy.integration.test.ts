import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient, Prisma } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { UploadSessionTokenService } from "../src/media/upload-session-token.service.js";
import { PrivacyLifecycleService } from "../src/privacy/privacy-lifecycle.service.js";
import {
  MEDIA_STORAGE_ADAPTER,
  type MediaStorageAdapter,
} from "../src/media/media-storage.adapter.js";
import { enrollTestMfa } from "./mfa-test-helper.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const sizeBytes = 70 * 1024 * 1024;
const storage: MediaStorageAdapter = {
  kind: "r2",
  available: true,
  createMultipartUpload: vi.fn(async () => ({ uploadId: "actual-authority-upload" })),
  authorizeMultipartPart: vi.fn(async () => ({
    url: "https://example.invalid/part",
    expiresAt: new Date(Date.now() + 60000),
  })),
  authorizeSinglePut: vi.fn(async () => ({
    url: "https://example.invalid/single",
    expiresAt: new Date(Date.now() + 60000),
  })),
  listParts: vi.fn(async () => []),
  completeMultipartUpload: vi.fn(async () => ({ etag: '"complete"' })),
  abortMultipartUpload: vi.fn(async () => undefined),
  headObject: vi.fn(async () => ({ sizeBytes, contentType: "video/mp4", etag: '"complete"' })),
  deleteObject: vi.fn(async () => undefined),
  deletePrefix: vi.fn(async () => undefined),
  listMultipartUploads: vi.fn(async () => []),
};
function cookiePair(value: string | string[] | undefined) {
  const result = (Array.isArray(value) ? value[0] : value)?.split(";", 1)[0];
  if (!result) throw Error("Expected actual session cookie");
  return result;
}

databaseDescribe("Media creation current authority and privacy snapshot fence", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_TOKEN_SECRET = "actual-upload-authority-auth-secret-more-than32";
    process.env.UPLOAD_SESSION_SECRET = "actual-upload-authority-session-secret-more-than32";
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
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Account", "Channel" CASCADE');
    await prisma.adminAuditLog.deleteMany();
    await prisma.accountDeletionRequest.deleteMany();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function register() {
    const email = `upload-authority-${randomUUID()}@example.com`;
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name: "Actual upload actor", email, password: "strong-pass-123" },
    });
    expect(response.statusCode).toBe(201);
    return {
      cookie: cookiePair(response.headers["set-cookie"]),
      email,
      accountId: response.json().user.account.id as string,
      channelId: response.json().user.channel.id as string,
    };
  }
  async function fixture(
    role: "OPERATIONS" | "CONTENT_MODERATOR" | "ADMIN" = "OPERATIONS",
    bytes = sizeBytes,
    actorOrder: "before" | "after" = "before",
  ) {
    const accounts = [await register(), await register()].sort((left, right) =>
      left.accountId.localeCompare(right.accountId),
    );
    const actor = accounts[actorOrder === "before" ? 0 : 1]!;
    const owner = accounts[actorOrder === "before" ? 1 : 0]!;
    if (role === "ADMIN") actor.cookie = (await enrollTestMfa(app, actor.cookie)).cookie;
    await prisma.adminRoleAssignment.create({ data: { accountId: actor.accountId, role } });
    await prisma.channel.update({
      where: { id: owner.channelId },
      data: { isPlatformOwned: true },
    });
    const batch = await app.inject({
      method: "POST",
      url: "/admin/content-seeding/batches",
      headers: { cookie: actor.cookie },
      payload: {
        channelId: owner.channelId,
        sourceLabel: "Actual reviewed catalog",
        items: [
          {
            title: "Authority fixture",
            contentType: "DOCUMENTARY",
            rightsBasis: "OWNED",
            sourceNotes: "Owned isolated integration source",
          },
        ],
      },
    });
    expect(batch.statusCode).toBe(201);
    const item = batch.json().items[0];
    // The earlier tuple and lower UUID force privacy to take a different asset
    // before the upload source, for both physical and sorted locking plans.
    const siblingVideo = await prisma.video.create({
      data: {
        channelId: owner.channelId,
        title: "Other privacy media",
        slug: `other-${randomUUID()}`,
      },
    });
    await prisma.mediaAsset.create({
      data: {
        id: "00000000-0000-4000-8000-000000000001",
        channelId: owner.channelId,
        videoId: siblingVideo.id,
        kind: "SOURCE_VIDEO",
        status: "VALIDATED",
        r2ObjectKey: `privacy/sibling-${randomUUID()}.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 1024n,
      },
    });
    const created = await app.inject({
      method: "POST",
      url: `/admin/content-seeding/items/${item.id}/upload-session`,
      headers: { cookie: actor.cookie },
      payload: { sizeBytes: bytes, mimeType: "video/mp4" },
    });
    expect(created.statusCode).toBe(201);
    vi.clearAllMocks();
    return {
      actor,
      owner,
      videoId: item.video.id as string,
      session: created.json() as {
        sessionToken: string;
        assetId: string;
        partCount?: number;
        objectKey: string;
      },
    };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function gate() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }
  async function observedLock(query: string) {
    await vi.waitFor(
      async () => {
        const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>(
          Prisma.sql`SELECT count(*)::bigint AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE ${`%${query}%`}`,
        );
        expect(Number(row?.count)).toBeGreaterThan(0);
      },
      { timeout: 4000, interval: 10 },
    );
  }
  async function deletionRequest(f: Fixture) {
    await prisma.account.update({
      where: { id: f.owner.accountId },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    return prisma.accountDeletionRequest.create({
      data: {
        accountId: f.owner.accountId,
        state: "DEACTIVATED",
        deactivatedAt: new Date(Date.now() - 25 * 60 * 60_000),
      },
    });
  }
  async function assertRemoved(f: Fixture, requestId: string) {
    expect(
      (await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: requestId } })).state,
    ).toBe("ANONYMIZED");
    expect(
      (await prisma.channel.findUniqueOrThrow({ where: { id: f.owner.channelId } })).status,
    ).toBe("REMOVED");
    expect((await prisma.video.findUniqueOrThrow({ where: { id: f.videoId } })).status).toBe(
      "REMOVED",
    );
    const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: f.session.assetId } });
    expect(asset.status).toBe("REMOVED");
    expect(asset.removedAt).not.toBeNull();
    expect(
      await prisma.mediaAsset.count({
        where: { channelId: f.owner.channelId, status: { not: "REMOVED" } },
      }),
    ).toBe(0);
    expect(
      await prisma.video.count({
        where: { channelId: f.owner.channelId, status: { not: "REMOVED" } },
      }),
    ).toBe(0);
    expect(
      await prisma.mediaProcessingJob.count({
        where: { videoId: f.videoId, status: { not: "CANCELLED" } },
      }),
    ).toBe(0);
    expect(
      await prisma.privacyMediaDeletionJob.count({
        where: { requestId, target: f.session.objectKey },
      }),
    ).toBe(1);
  }

  async function createAnother(f: Fixture, bytes = sizeBytes) {
    const item = await prisma.contentSeedItem.findFirstOrThrow({ where: { videoId: f.videoId } });
    return app.inject({
      method: "POST",
      url: `/admin/content-seeding/items/${item.id}/upload-session`,
      headers: { cookie: f.actor.cookie },
      payload: { sizeBytes: bytes, mimeType: "video/mp4" },
    });
  }
  function pauseCreate(single = false) {
    const entered = gate(),
      done = gate();
    if (single)
      vi.mocked(storage.authorizeSinglePut).mockImplementationOnce(async () => {
        entered.release();
        await done.promise;
        return { url: "https://example.invalid/delayed", expiresAt: new Date(Date.now() + 60000) };
      });
    else
      vi.mocked(storage.createMultipartUpload).mockImplementationOnce(async () => {
        entered.release();
        await done.promise;
        return { uploadId: "new-uncommitted-upload" };
      });
    return { entered: entered.promise, release: done.release };
  }
  for (const actorOrder of ["before", "after"] as const) {
    it(`blocks admin creation after the actual privacy snapshot when actor sorts ${actorOrder} owner`, async () => {
      const f = await fixture("OPERATIONS", sizeBytes, actorOrder);
      const deletion = await deletionRequest(f);
      await prisma.$executeRawUnsafe(`CREATE FUNCTION pause_creation_snapshot() RETURNS trigger AS $$ BEGIN
        PERFORM pg_advisory_xact_lock(92385, 1); RETURN NEW; END; $$ LANGUAGE plpgsql`);
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER pause_creation_snapshot BEFORE INSERT ON "PrivacyMediaDeletionJob" FOR EACH ROW EXECUTE FUNCTION pause_creation_snapshot()`,
      );
      try {
        const entered = gate(),
          done = gate();
        const holder = prisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(92385, 1)`;
            entered.release();
            await done.promise;
          },
          { timeout: 12000 },
        );
        await entered.promise;
        const lifecycle = app.get(PrivacyLifecycleService);
        const privacy = lifecycle.advanceDue(new Date(), 1);
        let response: ReturnType<typeof createAnother> | undefined;
        try {
          await observedLock('INSERT INTO "public"."PrivacyMediaDeletionJob"');
          response = createAnother(f);
          await observedLock("ayin-admin-account-write-lock");
        } finally {
          done.release();
        }
        await holder;
        expect(await privacy).toBe(1);
        expect((await response!).statusCode).toBe(409);
        await assertRemoved(f, deletion.id);
        expect(storage.createMultipartUpload).not.toHaveBeenCalled();
        await lifecycle.processMediaDeletionBatch(new Date(), 20);
        expect(
          await prisma.mediaAsset.count({
            where: { channelId: f.owner.channelId, removedAt: null },
          }),
        ).toBe(0);
      } finally {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER pause_creation_snapshot ON "PrivacyMediaDeletionJob"',
        );
        await prisma.$executeRawUnsafe("DROP FUNCTION pause_creation_snapshot()");
      }
    });
  }
  for (const single of [false, true]) {
    it(`denies ${single ? "single" : "multipart"} creation and compensates allocation when privacy wins provider gap`, async () => {
      const f = await fixture();
      const delayed = pauseCreate(single);
      const response = createAnother(f, single ? 1024 : sizeBytes);
      await delayed.entered;
      let deletion;
      try {
        deletion = await deletionRequest(f);
        expect(await app.get(PrivacyLifecycleService).advanceDue(new Date(), 1)).toBe(1);
      } finally {
        delayed.release();
      }
      expect((await response).statusCode).toBe(409);
      await assertRemoved(f, deletion!.id);
      expect(await prisma.mediaAsset.count({ where: { channelId: f.owner.channelId } })).toBe(2);
      if (single) expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
      else
        expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
          expect.objectContaining({ uploadId: "new-uncommitted-upload" }),
        );
    });
  }

  for (const change of [
    "ROLE",
    "SESSION",
    "ACCOUNT",
    "AUTH_VERSION",
    "STEP_UP",
    "CHANNEL_TOMBSTONE",
    "VIDEO_TOMBSTONE",
  ] as const) {
    it(`rechecks current ${change} after multipart allocation without leaking a source or locks`, async () => {
      const f = await fixture();
      const delayed = pauseCreate();
      const response = createAnother(f);
      await delayed.entered;
      try {
        // This would time out if an authority transaction spanned provider I/O.
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`;
          await tx.$executeRawUnsafe(
            "DO $$ BEGIN PERFORM pg_advisory_xact_lock(1096379721, 1398034002); END $$;",
          );
          await tx.account.update({
            where: { id: f.owner.accountId },
            data: { displayName: "Owner changed during provider I/O" },
          });
        });
        if (change === "ROLE")
          await prisma.adminRoleAssignment.deleteMany({ where: { accountId: f.actor.accountId } });
        if (change === "SESSION")
          await prisma.accountSession.updateMany({
            where: { accountId: f.actor.accountId },
            data: { revokedAt: new Date() },
          });
        if (change === "ACCOUNT")
          await prisma.account.update({
            where: { id: f.actor.accountId },
            data: { status: "CLOSED" },
          });
        if (change === "AUTH_VERSION")
          await prisma.account.update({
            where: { id: f.actor.accountId },
            data: { authVersion: { increment: 1 } },
          });
        if (change === "STEP_UP") vi.spyOn(Date, "now").mockReturnValue(Date.now() + 301000);
        if (change === "CHANNEL_TOMBSTONE")
          await prisma.channel.update({
            where: { id: f.owner.channelId },
            data: { removedAt: new Date() },
          });
        if (change === "VIDEO_TOMBSTONE")
          await prisma.video.update({ where: { id: f.videoId }, data: { removedAt: new Date() } });
      } finally {
        delayed.release();
      }
      const expected = ["ROLE", "STEP_UP"].includes(change)
        ? 403
        : change.endsWith("TOMBSTONE")
          ? 409
          : 401;
      expect((await response).statusCode).toBe(expected);
      expect(await prisma.mediaAsset.count({ where: { channelId: f.owner.channelId } })).toBe(2);
      expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
        expect.objectContaining({ uploadId: "new-uncommitted-upload" }),
      );
    });
  }
  it("rechecks current privileged MFA version after multipart allocation", async () => {
    const f = await fixture("ADMIN");
    const delayed = pauseCreate();
    const response = createAnother(f);
    await delayed.entered;
    try {
      await prisma.accountMfaCredential.update({
        where: { accountId: f.actor.accountId },
        data: { version: { increment: 1 } },
      });
    } finally {
      delayed.release();
    }
    expect((await response).statusCode).toBe(401);
    expect(await prisma.mediaAsset.count({ where: { channelId: f.owner.channelId } })).toBe(2);
    expect(storage.abortMultipartUpload).toHaveBeenCalledOnce();
  });

  for (const change of ["ADDED", "REMOVED"] as const) {
    it(`rejects an OWNER set ${change} while waiting on the canonically ordered accounts`, async () => {
      const f = await fixture();
      const newOwner = await register();
      const entered = gate(),
        done = gate();
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${f.owner.accountId}::uuid FOR UPDATE`;
          entered.release();
          await done.promise;
        },
        { timeout: 12000 },
      );
      await entered.promise;
      const response = createAnother(f);
      try {
        await observedLock("ayin-admin-account-write-lock");
        if (change === "ADDED")
          await prisma.channelMember.create({
            data: { channelId: f.owner.channelId, accountId: newOwner.accountId, role: "OWNER" },
          });
        else
          await prisma.channelMember.deleteMany({
            where: { channelId: f.owner.channelId, accountId: f.owner.accountId, role: "OWNER" },
          });
      } finally {
        done.release();
      }
      await holder;
      expect((await response).statusCode).toBe(409);
      expect(storage.createMultipartUpload).not.toHaveBeenCalled();
      expect(await prisma.mediaAsset.count({ where: { channelId: f.owner.channelId } })).toBe(2);
    });
  }

  it("preserves creation on a shared-owner channel after one owner is anonymized during provider I/O", async () => {
    const f = await fixture();
    const coOwner = await register();
    await prisma.channelMember.create({
      data: { channelId: f.owner.channelId, accountId: coOwner.accountId, role: "OWNER" },
    });
    const delayed = pauseCreate();
    const response = createAnother(f);
    await delayed.entered;
    let deletion;
    try {
      deletion = await deletionRequest(f);
      expect(await app.get(PrivacyLifecycleService).advanceDue(new Date(), 1)).toBe(1);
    } finally {
      delayed.release();
    }
    const result = await response;
    expect(result.statusCode).toBe(201);
    const asset = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: result.json().assetId },
    });
    expect(asset.videoId).toBe(f.videoId);
    expect(asset.status).toBe("PENDING");
    expect(asset.removedAt).toBeNull();
    expect(
      await prisma.privacyMediaDeletionJob.count({
        where: { requestId: deletion!.id, target: asset.r2ObjectKey },
      }),
    ).toBe(0);
    expect(
      (await prisma.channel.findUniqueOrThrow({ where: { id: f.owner.channelId } })).status,
    ).not.toBe("REMOVED");
    expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
  });

  it("rolls back source insertion and video attachment when seed commit fails, then aborts allocated multipart", async () => {
    const f = await fixture();
    const before = await prisma.video.findUniqueOrThrow({ where: { id: f.videoId } });
    await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_seed_commit() RETURNS trigger AS $$ BEGIN
      RAISE EXCEPTION 'isolated seed commit failure'; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER reject_seed_commit BEFORE UPDATE ON "ContentSeedItem" FOR EACH ROW EXECUTE FUNCTION reject_seed_commit()`,
    );
    try {
      expect((await createAnother(f)).statusCode).toBe(500);
      expect(await prisma.mediaAsset.count({ where: { channelId: f.owner.channelId } })).toBe(2);
      expect(await prisma.video.findUniqueOrThrow({ where: { id: f.videoId } })).toEqual(before);
      expect(storage.abortMultipartUpload).toHaveBeenCalledOnce();
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER reject_seed_commit ON "ContentSeedItem"');
      await prisma.$executeRawUnsafe("DROP FUNCTION reject_seed_commit()");
    }
  });

  for (const path of ["GENERIC", "QUICK_UPLOAD"] as const) {
    it(`preserves the creator ${path} privacy fence during multipart allocation`, async () => {
      const f = await fixture();
      const delayed = pauseCreate();
      const response = Promise.resolve(
        app.inject({
          method: "POST",
          url: path === "GENERIC" ? "/media/uploads/sessions" : "/creator/videos/drafts",
          headers: { cookie: f.owner.cookie },
          payload: {
            channelId: f.owner.channelId,
            sizeBytes,
            mimeType: "video/mp4",
            ...(path === "QUICK_UPLOAD" ? { title: "Creation privacy race" } : {}),
          },
        }),
      );
      await delayed.entered;
      let deletion;
      try {
        deletion = await deletionRequest(f);
        expect(await app.get(PrivacyLifecycleService).advanceDue(new Date(), 1)).toBe(1);
      } finally {
        delayed.release();
      }
      expect((await response).statusCode).toBe(401);
      await assertRemoved(f, deletion!.id);
      expect(await prisma.mediaAsset.count({ where: { channelId: f.owner.channelId } })).toBe(2);
      expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
        expect.objectContaining({ uploadId: "new-uncommitted-upload" }),
      );
    });
  }

  it("preserves authority denial when compensating multipart abort is unavailable", async () => {
    const f = await fixture();
    const delayed = pauseCreate();
    vi.mocked(storage.abortMultipartUpload).mockRejectedValueOnce(
      new Error("isolated R2 abort unavailable"),
    );
    const response = createAnother(f);
    await delayed.entered;
    try {
      await prisma.adminRoleAssignment.deleteMany({ where: { accountId: f.actor.accountId } });
    } finally {
      delayed.release();
    }
    const result = await response;
    expect(result.statusCode).toBe(403);
    expect(result.json().sessionToken).toBeUndefined();
    expect(await prisma.mediaAsset.count({ where: { channelId: f.owner.channelId } })).toBe(2);
    expect(storage.abortMultipartUpload).toHaveBeenCalledOnce();
  });

  it("rejects creator ownership removal during multipart allocation", async () => {
    const f = await fixture();
    const delayed = pauseCreate();
    const response = Promise.resolve(
      app.inject({
        method: "POST",
        url: "/media/uploads/sessions",
        headers: { cookie: f.owner.cookie },
        payload: { channelId: f.owner.channelId, sizeBytes, mimeType: "video/mp4" },
      }),
    );
    await delayed.entered;
    try {
      await prisma.channelMember.deleteMany({
        where: { channelId: f.owner.channelId, accountId: f.owner.accountId },
      });
    } finally {
      delayed.release();
    }
    expect((await response).statusCode).toBe(403);
    expect(await prisma.mediaAsset.count({ where: { channelId: f.owner.channelId } })).toBe(2);
    expect(storage.abortMultipartUpload).toHaveBeenCalledOnce();
  });

  function representedUuid(id: string, style: "UPPER" | "MIXED") {
    return style === "UPPER"
      ? id.toUpperCase()
      : [...id]
          .map((char, index) => (index % 2 ? char.toUpperCase() : char.toLowerCase()))
          .join("");
  }
  for (const style of ["UPPER", "MIXED"] as const) {
    for (const path of ["GENERIC", "QUICK_UPLOAD", "ADMIN_SEED"] as const) {
      for (const multipart of [false, true]) {
        it(`canonicalizes ${style} UUID input for ${path} ${multipart ? "multipart" : "single"} creation and continuation`, async () => {
          const f = await fixture();
          const channelId = representedUuid(f.owner.channelId, style);
          const bytes = multipart ? sizeBytes : 1024;
          let response;
          if (path === "ADMIN_SEED") {
            const batch = await app.inject({
              method: "POST",
              url: "/admin/content-seeding/batches",
              headers: { cookie: f.actor.cookie },
              payload: {
                channelId,
                sourceLabel: "Case-compatible catalog",
                items: [
                  {
                    title: "UUID representation",
                    contentType: "DOCUMENTARY",
                    rightsBasis: "OWNED",
                    sourceNotes: "Synthetic owned media",
                  },
                ],
              },
            });
            expect(batch.statusCode).toBe(201);
            const itemId = representedUuid(batch.json().items[0].id, style);
            response = await app.inject({
              method: "POST",
              url: `/admin/content-seeding/items/${itemId}/upload-session`,
              headers: { cookie: f.actor.cookie },
              payload: { sizeBytes: bytes, mimeType: "video/mp4" },
            });
          } else {
            response = await app.inject({
              method: "POST",
              url: path === "GENERIC" ? "/media/uploads/sessions" : "/creator/videos/drafts",
              headers: { cookie: f.owner.cookie },
              payload: {
                channelId,
                sizeBytes: bytes,
                mimeType: "video/mp4",
                ...(path === "QUICK_UPLOAD" ? { title: "UUID representation" } : {}),
              },
            });
          }
          expect(response.statusCode).toBe(201);
          const session = path === "QUICK_UPLOAD" ? response.json().uploadSession : response.json();
          const payload = app.get(UploadSessionTokenService).verify(session.sessionToken);
          expect(payload.channelId).toBe(f.owner.channelId);
          expect(payload.objectKey).toBe(
            `channels/${f.owner.channelId}/media/${payload.assetId}/source.mp4`,
          );
          const asset = await prisma.mediaAsset.findUniqueOrThrow({
            where: { id: payload.assetId },
          });
          expect(asset.channelId).toBe(f.owner.channelId);
          expect(asset.r2ObjectKey).toBe(payload.objectKey);
          const cookie = path === "ADMIN_SEED" ? f.actor.cookie : f.owner.cookie;
          if (multipart) {
            expect(
              (
                await app.inject({
                  method: "POST",
                  url: "/media/uploads/sessions/authorize-part",
                  headers: { cookie },
                  payload: { sessionToken: session.sessionToken, partNumber: 1 },
                })
              ).statusCode,
            ).toBe(201);
            expect(storage.authorizeMultipartPart).toHaveBeenLastCalledWith(
              expect.objectContaining({ key: payload.objectKey, uploadId: payload.uploadId }),
            );
          }
          expect(
            (
              await app.inject({
                method: "POST",
                url: "/media/uploads/sessions/resume",
                headers: { cookie },
                payload: { sessionToken: session.sessionToken },
              })
            ).statusCode,
          ).toBe(201);
          vi.mocked(storage.headObject).mockResolvedValueOnce({
            sizeBytes: bytes,
            contentType: "video/mp4",
            etag: '"verified-case-source"',
          });
          expect(
            (
              await app.inject({
                method: "POST",
                url: "/media/uploads/sessions/complete",
                headers: { cookie },
                payload: {
                  sessionToken: session.sessionToken,
                  parts: Array.from({ length: session.partCount ?? 0 }, (_, index) => ({
                    partNumber: index + 1,
                    etag: `part-${index + 1}`,
                  })),
                },
              })
            ).statusCode,
          ).toBe(201);
        });
      }
    }
    it(`preserves legacy signed ${style} UUID identities and exact case-sensitive provider keys`, async () => {
      const f = await fixture();
      const tokens = app.get(UploadSessionTokenService);
      const original = tokens.verify(f.session.sessionToken);
      const objectKey = `channels/${f.owner.channelId.toUpperCase()}/media/${f.session.assetId}/Legacy.Source.MP4`;
      await prisma.mediaAsset.update({
        where: { id: f.session.assetId },
        data: { r2ObjectKey: objectKey },
      });
      const sessionToken = tokens.sign({
        ...original,
        accountId: representedUuid(original.accountId, style),
        channelId: representedUuid(original.channelId, style),
        assetId: representedUuid(original.assetId, style),
        objectKey,
        uploadId: "Legacy/CaseSensitive+UploadID==",
      });
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/media/uploads/sessions/authorize-part",
            headers: { cookie: f.actor.cookie },
            payload: { sessionToken, partNumber: 1 },
          })
        ).statusCode,
      ).toBe(201);
      expect(storage.authorizeMultipartPart).toHaveBeenLastCalledWith(
        expect.objectContaining({ key: objectKey, uploadId: "Legacy/CaseSensitive+UploadID==" }),
      );
      expect(tokens.verify(sessionToken).objectKey).toBe(objectKey);
      expect(tokens.verify(sessionToken).channelId).toBe(
        representedUuid(original.channelId, style),
      );
    });
  }
  for (const mismatch of ["CHANNEL", "KEY_CASE"] as const) {
    it(`still rejects a genuinely mismatched legacy ${mismatch} after UUID canonicalization`, async () => {
      const f = await fixture();
      const tokens = app.get(UploadSessionTokenService);
      const original = tokens.verify(f.session.sessionToken);
      const objectKey = `${original.objectKey}.CaseSensitive`;
      await prisma.mediaAsset.update({
        where: { id: original.assetId },
        data: { r2ObjectKey: objectKey },
      });
      const sessionToken = tokens.sign({
        ...original,
        accountId: original.accountId.toUpperCase(),
        channelId: (mismatch === "CHANNEL" ? f.actor.channelId : original.channelId).toUpperCase(),
        objectKey: mismatch === "KEY_CASE" ? objectKey.toLowerCase() : objectKey,
      });
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/media/uploads/sessions/authorize-part",
            headers: { cookie: f.actor.cookie },
            payload: { sessionToken, partNumber: 1 },
          })
        ).statusCode,
      ).toBe(409);
      expect(storage.authorizeMultipartPart).not.toHaveBeenCalled();
    });
  }
});
