import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient, Prisma } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { PrivacyLifecycleService } from "../src/privacy/privacy-lifecycle.service.js";
import {
  MEDIA_STORAGE_ADAPTER,
  type MediaStorageAdapter,
} from "../src/media/media-storage.adapter.js";
import { enrollTestMfa } from "./mfa-test-helper.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const sizeBytes = 70 * 1024 * 1024;
const paths = ["authorize-part", "resume", "complete", "abort"] as const;
type Path = (typeof paths)[number];
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

databaseDescribe("Upload continuation and actual privacy lifecycle lock order", () => {
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
  ) {
    const actor = await register();
    if (role === "ADMIN") actor.cookie = (await enrollTestMfa(app, actor.cookie)).cookie;
    await prisma.adminRoleAssignment.create({ data: { accountId: actor.accountId, role } });
    const owner = await register();
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
  function send(f: Fixture, path: Path, cookie = f.actor.cookie) {
    return Promise.resolve(
      app.inject({
        method: "POST",
        url: `/media/uploads/sessions/${path}`,
        headers: { cookie },
        payload: {
          sessionToken: f.session.sessionToken,
          ...(path === "authorize-part" ? { partNumber: 1 } : {}),
          ...(path === "complete"
            ? {
                parts: Array.from({ length: f.session.partCount ?? 0 }, (_, i) => ({
                  partNumber: i + 1,
                  etag: `"part-${i + 1}"`,
                })),
              }
            : {}),
        },
      }),
    );
  }
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
  for (const path of paths) {
    it(`denies ${path} after actual owner anonymization wins an observed source lock wait`, async () => {
      const f = await fixture();
      const deletion = await deletionRequest(f);
      const entered = gate(),
        done = gate();
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Video" WHERE id = ${f.videoId}::uuid FOR UPDATE`;
          entered.release();
          await done.promise;
        },
        { timeout: 12000 },
      );
      await entered.promise;
      const privacy = app.get(PrivacyLifecycleService).advanceDue(new Date(), 1);
      let response: ReturnType<typeof send> | undefined;
      try {
        await observedLock('UPDATE "public"."Video"');
        response = send(f, path);
        await observedLock("ayin-upload-source-lock");
      } finally {
        done.release();
      }
      await holder;
      const outcomes = await Promise.allSettled([privacy, response!]);
      expect(outcomes[0]).toEqual({ status: "fulfilled", value: 1 });
      expect(outcomes[1].status).toBe("fulfilled");
      const result = outcomes[1].status === "fulfilled" ? outcomes[1].value : undefined;
      expect(result?.statusCode).toBe(409);
      expect(result?.json().error.code).toBe("UPLOAD_STATE_CHANGED");
      await assertRemoved(f, deletion.id);
      for (const value of Object.values(storage))
        if (typeof value === "function") expect(value).not.toHaveBeenCalled();
    });
  }

  function pauseProvider(path: Path, single = false) {
    const entered = gate(),
      done = gate();
    const pause = async () => {
      entered.release();
      await done.promise;
    };
    if (path === "authorize-part")
      vi.mocked(storage.authorizeMultipartPart).mockImplementationOnce(async () => {
        await pause();
        return { url: "https://example.invalid/part", expiresAt: new Date(Date.now() + 60_000) };
      });
    else if (path === "resume")
      vi.mocked(storage.listParts).mockImplementationOnce(async () => {
        await pause();
        return [];
      });
    else if (path === "complete" && single)
      vi.mocked(storage.headObject).mockImplementationOnce(async () => {
        await pause();
        return { sizeBytes: 1024, contentType: "video/mp4", etag: '"single"' };
      });
    else if (path === "complete")
      vi.mocked(storage.completeMultipartUpload).mockImplementationOnce(async () => {
        await pause();
        return { etag: '"complete"' };
      });
    else if (single) vi.mocked(storage.deleteObject).mockImplementationOnce(pause);
    else vi.mocked(storage.abortMultipartUpload).mockImplementationOnce(pause);
    return { entered: entered.promise, release: done.release };
  }

  for (const path of paths) {
    it(`allows actual multi-asset privacy cleanup to finish after ${path} owns the source first`, async () => {
      const f = await fixture();
      const deletion = await deletionRequest(f);
      const delayed = pauseProvider(path);
      const entered = gate(),
        done = gate();
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Video" WHERE id = ${f.videoId}::uuid FOR UPDATE`;
          entered.release();
          await done.promise;
        },
        { timeout: 12000 },
      );
      await entered.promise;
      const response = send(f, path);
      let privacy: Promise<number> | undefined;
      try {
        await observedLock("ayin-upload-video-lock");
        privacy = app.get(PrivacyLifecycleService).advanceDue(new Date(), 1);
        await observedLock("ayin-privacy-media-asset-lock");
      } finally {
        done.release();
      }
      await holder;
      try {
        await delayed.entered;
        expect(await privacy).toBe(1);
        await assertRemoved(f, deletion.id);
      } finally {
        delayed.release();
      }
      const result = await response;
      expect(result.statusCode).toBe(409);
      expect(result.json().error.code).toBe("UPLOAD_STATE_CHANGED");
      await assertRemoved(f, deletion.id);
    });

    it(`denies ${path} when actual owner anonymization commits during provider I/O`, async () => {
      const f = await fixture();
      const delayed = pauseProvider(path);
      const response = send(f, path);
      await delayed.entered;
      let deletion;
      try {
        deletion = await deletionRequest(f);
        expect(await app.get(PrivacyLifecycleService).advanceDue(new Date(), 1)).toBe(1);
        await assertRemoved(f, deletion.id);
      } finally {
        delayed.release();
      }
      expect((await response).statusCode).toBe(409);
      await assertRemoved(f, deletion!.id);
    });
  }

  for (const path of ["complete", "abort"] as const) {
    it(`denies single-object ${path} after actual privacy deletion during provider I/O`, async () => {
      const f = await fixture("OPERATIONS", 1024);
      const delayed = pauseProvider(path, true);
      const response = send(f, path);
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
    });
  }

  for (const change of ["STATUS", "TOMBSTONE"] as const) {
    it(`rereads channel ${change} after waiting for the final channel lock`, async () => {
      const f = await fixture();
      const entered = gate(),
        done = gate();
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.channel.update({
            where: { id: f.owner.channelId },
            data: change === "STATUS" ? { status: "REMOVED" } : { removedAt: new Date() },
          });
          entered.release();
          await done.promise;
        },
        { timeout: 12000 },
      );
      await entered.promise;
      const response = send(f, "complete");
      try {
        await observedLock("ayin-upload-channel-lock");
      } finally {
        done.release();
      }
      await holder;
      expect((await response).statusCode).toBe(409);
      expect(
        (await prisma.mediaAsset.findUniqueOrThrow({ where: { id: f.session.assetId } })).status,
      ).toBe("PENDING");
      expect(await prisma.mediaProcessingJob.count({ where: { videoId: f.videoId } })).toBe(0);
      for (const value of Object.values(storage))
        if (typeof value === "function") expect(value).not.toHaveBeenCalled();
    });
  }

  it("locks the actual privacy cleanup asset set in UUID order despite reverse physical tuple order", async () => {
    const f = await fixture();
    const high = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const low = "00000000-0000-4000-8000-000000000000";
    for (const id of [high, low])
      await prisma.mediaAsset.create({
        data: {
          id,
          videoId: f.videoId,
          channelId: f.owner.channelId,
          kind: "CAPTION",
          status: "PENDING",
          r2ObjectKey: `privacy/${id}.vtt`,
          mimeType: "text/vtt",
          sizeBytes: 128n,
        },
      });
    const deletion = await deletionRequest(f);
    // Pause the actual bulk UPDATE on its high-ID tuple, not a mocked lifecycle
    // method. A sorted multi-asset editor must queue before holding the low ID.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION test_pause_privacy_asset() RETURNS trigger AS $$ BEGIN
      IF NEW.id = '${high}'::uuid AND NEW.status = 'REMOVED' THEN PERFORM pg_advisory_xact_lock(92382, 1); END IF;
      RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER test_pause_privacy_asset BEFORE UPDATE ON "MediaAsset" FOR EACH ROW EXECUTE FUNCTION test_pause_privacy_asset()`,
    );
    try {
      const entered = gate(),
        done = gate();
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(92382, 1)`;
          entered.release();
          await done.promise;
        },
        { timeout: 12000 },
      );
      await entered.promise;
      const privacy = app.get(PrivacyLifecycleService).advanceDue(new Date(), 1);
      let editor: Promise<Array<{ id: string; status: string }>> | undefined;
      try {
        await observedLock('UPDATE "public"."MediaAsset"');
        editor = prisma.$transaction((tx) =>
          tx.$queryRaw<Array<{ id: string; status: string }>>(
            Prisma.sql`SELECT "id", "status" FROM "MediaAsset" WHERE "id" IN (${low}::uuid, ${high}::uuid)
            ORDER BY "id" FOR UPDATE /* ayin-test-media-editor-lock */`,
          ),
        );
        await observedLock("ayin-test-media-editor-lock");
      } finally {
        done.release();
      }
      await holder;
      const outcomes = await Promise.allSettled([privacy, editor!]);
      expect(outcomes[0]).toEqual({ status: "fulfilled", value: 1 });
      expect(outcomes[1]).toEqual({
        status: "fulfilled",
        value: [
          { id: low, status: "REMOVED" },
          { id: high, status: "REMOVED" },
        ],
      });
      await assertRemoved(f, deletion.id);
      expect(
        await prisma.privacyMediaDeletionJob.count({
          where: {
            requestId: deletion.id,
            target: { in: [`privacy/${low}.vtt`, `privacy/${high}.vtt`] },
          },
        }),
      ).toBe(2);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER test_pause_privacy_asset ON "MediaAsset"');
      await prisma.$executeRawUnsafe("DROP FUNCTION test_pause_privacy_asset()");
    }
  });
});
