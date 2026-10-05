import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient, Prisma } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivacyLifecycleService } from "../src/privacy/privacy-lifecycle.service.js";
import { AppModule } from "../src/app.module.js";
import {
  MEDIA_STORAGE_ADAPTER,
  type MediaStorageAdapter,
} from "../src/media/media-storage.adapter.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const bytes = new TextEncoder().encode("WEBVTT\n\n00:00.000 --> 00:02.000\nHello AYIN\n");
const metadata = { sizeBytes: bytes.byteLength, contentType: "text/vtt", etag: '"caption"' };
const storage: MediaStorageAdapter = {
  kind: "r2",
  available: true,
  createMultipartUpload: vi.fn(async () => ({ uploadId: "caption-test" })),
  authorizeMultipartPart: vi.fn(async () => ({
    url: "https://example.invalid/part",
    expiresAt: new Date(Date.now() + 60_000),
  })),
  authorizeSinglePut: vi.fn(async () => ({
    url: "https://example.invalid/caption.vtt",
    expiresAt: new Date(Date.now() + 60_000),
  })),
  listParts: vi.fn(async () => []),
  completeMultipartUpload: vi.fn(async () => ({ etag: '"complete"' })),
  abortMultipartUpload: vi.fn(async () => undefined),
  headObject: vi.fn(async () => metadata),
  readObject: vi.fn(async () => bytes),
  deleteObject: vi.fn(async () => undefined),
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

databaseDescribe("Creator captions current authority and provider-gap lifecycle", () => {
  const prisma = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "caption-authority-test-secret-longer-than32";
    process.env.UPLOAD_SESSION_SECRET = "caption-upload-test-secret-longer-than32";
    process.env.DATABASE_URL = databaseUrl;
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
    await prisma.accountDeletionRequest.deleteMany();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  let registrationNumber = 0;
  async function fixture() {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      // Independent fixture accounts are independent test clients; keep the
      // real per-IP registration limiter enabled as this suite grows.
      remoteAddress: `192.0.2.${(++registrationNumber % 250) + 1}`,
      payload: {
        name: "Caption owner",
        email: `caption-${randomUUID()}@example.com`,
        password: "strong-pass-123",
      },
    });
    expect(response.statusCode).toBe(201);
    const header = response.headers["set-cookie"];
    const cookie = (Array.isArray(header) ? header[0] : header)?.split(";", 1)[0];
    if (!cookie) throw new Error("Expected session cookie");
    const accountId = response.json().user.account.id as string;
    const channelId = response.json().user.channel.id as string;
    const video = await prisma.video.create({
      data: {
        channelId,
        title: "Caption lifecycle",
        slug: `caption-${randomUUID()}`,
        status: "PUBLISHED",
        visibility: "PUBLIC",
        durationMs: 60_000,
        publishedAt: new Date(),
      },
    });
    return { accountId, channelId, videoId: video.id, cookie };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const upload = { fileName: "track.vtt", sizeBytes: bytes.byteLength, mimeType: "text/vtt" };
  function create(f: Fixture, languageCode = "en", makeDefault = false) {
    return Promise.resolve(
      app.inject({
        method: "POST",
        url: `/creator/studio/videos/${f.videoId}/captions/uploads`,
        headers: { cookie: f.cookie },
        payload: { ...upload, languageCode, default: makeDefault },
      }),
    );
  }
  function replace(f: Fixture, trackId: string) {
    return Promise.resolve(
      app.inject({
        method: "POST",
        url: `/creator/studio/videos/${f.videoId}/captions/${trackId}/uploads`,
        headers: { cookie: f.cookie },
        payload: upload,
      }),
    );
  }
  function finalize(f: Fixture, trackId: string) {
    return Promise.resolve(
      app.inject({
        method: "POST",
        url: `/creator/studio/videos/${f.videoId}/captions/${trackId}/finalize`,
        headers: { cookie: f.cookie },
        payload: {},
      }),
    );
  }
  function remove(f: Fixture, trackId: string) {
    return Promise.resolve(
      app.inject({
        method: "DELETE",
        url: `/creator/studio/videos/${f.videoId}/captions/${trackId}`,
        headers: { cookie: f.cookie },
      }),
    );
  }
  function patch(f: Fixture, trackId: string, payload: Record<string, unknown>) {
    return Promise.resolve(
      app.inject({
        method: "PATCH",
        url: `/creator/studio/videos/${f.videoId}/captions/${trackId}`,
        headers: { cookie: f.cookie },
        payload,
      }),
    );
  }
  async function prepared(f: Fixture, ready = false) {
    const response = await create(f);
    expect(response.statusCode).toBe(201);
    const trackId = response.json().trackId as string;
    if (ready) expect((await finalize(f, trackId)).statusCode).toBe(201);
    return prisma.videoCaptionTrack.findUniqueOrThrow({ where: { id: trackId } });
  }
  async function state(f: Fixture) {
    return {
      tracks: await prisma.videoCaptionTrack.findMany({
        where: { videoId: f.videoId },
        orderBy: { id: "asc" },
      }),
      assets: await prisma.mediaAsset.findMany({
        where: { videoId: f.videoId },
        orderBy: { id: "asc" },
      }),
    };
  }
  function pauseHead() {
    const entered = gate(),
      done = gate();
    vi.mocked(storage.headObject).mockImplementationOnce(async () => {
      entered.release();
      await done.promise;
      return metadata;
    });
    return { entered: entered.promise, release: done.release };
  }
  function pauseAuthorize() {
    const entered = gate(),
      done = gate();
    vi.mocked(storage.authorizeSinglePut).mockImplementationOnce(async () => {
      entered.release();
      await done.promise;
      return {
        url: "https://example.invalid/delayed.vtt",
        expiresAt: new Date(Date.now() + 60_000),
      };
    });
    return { entered: entered.promise, release: done.release };
  }

  for (const stage of ["HEAD", "READ"] as const)
    it(`preserves pending uploads on transient ${stage} failure and permits retry`, async () => {
      const f = await fixture(),
        track = await prepared(f),
        before = await state(f);
      if (stage === "HEAD")
        vi.mocked(storage.headObject).mockRejectedValueOnce(
          new Error("R2 temporarily unavailable"),
        );
      else vi.mocked(storage.readObject!).mockRejectedValueOnce(new Error("R2 read interrupted"));
      const failed = await finalize(f, track.id);
      expect(await state(f)).toEqual(before);
      expect(storage.deleteObject).not.toHaveBeenCalled();
      expect(failed.statusCode).toBe(503);
      expect(failed.json().error.code).toBe("CAPTION_STORAGE_UNAVAILABLE");
      expect((await finalize(f, track.id)).statusCode).toBe(201);
    });

  it("cannot resurrect a superseded pending asset or clear the newer replacement", async () => {
    const f = await fixture(),
      track = await prepared(f),
      delayed = pauseHead();
    const request = finalize(f, track.id);
    await delayed.entered;
    let replacement;
    try {
      replacement = await replace(f, track.id);
    } finally {
      delayed.release();
    }
    expect(replacement.statusCode).toBe(201);
    const afterReplacement = await state(f);
    const response = await request;
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("CAPTION_UPLOAD_STATE_CHANGED");
    expect(await state(f)).toEqual(afterReplacement);
    expect((await finalize(f, track.id)).statusCode).toBe(201);
  });

  it("a losing finalize never rejects or deletes the asset already finalized by a winner", async () => {
    const f = await fixture(),
      track = await prepared(f),
      delayed = pauseHead();
    const request = finalize(f, track.id);
    await delayed.entered;
    let winner;
    try {
      winner = await finalize(f, track.id);
    } finally {
      delayed.release();
    }
    expect(winner.statusCode).toBe(201);
    const before = await state(f);
    expect((await request).statusCode).toBe(409);
    expect(await state(f)).toEqual(before);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it("keeps a remove winner final while finalize is waiting on storage", async () => {
    const f = await fixture(),
      track = await prepared(f),
      delayed = pauseHead();
    const request = finalize(f, track.id);
    await delayed.entered;
    let removed;
    try {
      removed = await remove(f, track.id);
    } finally {
      delayed.release();
    }
    expect(removed.statusCode).toBe(200);
    const before = await state(f);
    expect((await request).statusCode).toBe(404);
    expect(await state(f)).toEqual(before);
    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
  });

  it("an older slow authorization cannot replace a newer pending upload", async () => {
    const f = await fixture(),
      track = await prepared(f, true),
      delayed = pauseAuthorize();
    const request = replace(f, track.id);
    await delayed.entered;
    let replacement;
    try {
      replacement = await replace(f, track.id);
    } finally {
      delayed.release();
    }
    expect(replacement.statusCode).toBe(201);
    const before = await state(f);
    expect((await request).statusCode).toBe(409);
    expect(await state(f)).toEqual(before);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  const changes = [
    "ACCOUNT",
    "AUTHVERSION",
    "SESSION",
    "SESSIONEXPIRY",
    "ROLE",
    "CHANNEL_STATUS",
    "CHANNEL_TOMBSTONE",
    "VIDEO_STATUS",
    "VIDEO_TOMBSTONE",
  ] as const;
  type Change = (typeof changes)[number];
  async function changeAuthority(f: Fixture, change: Change) {
    if (change === "ACCOUNT")
      await prisma.account.update({ where: { id: f.accountId }, data: { status: "SUSPENDED" } });
    if (change === "AUTHVERSION")
      await prisma.account.update({
        where: { id: f.accountId },
        data: { authVersion: { increment: 1 } },
      });
    if (change === "SESSION")
      await prisma.accountSession.updateMany({
        where: { accountId: f.accountId },
        data: { revokedAt: new Date() },
      });
    if (change === "SESSIONEXPIRY")
      await prisma.accountSession.updateMany({
        where: { accountId: f.accountId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
    if (change === "ROLE")
      await prisma.channelMember.deleteMany({
        where: { accountId: f.accountId, channelId: f.channelId },
      });
    if (change === "CHANNEL_STATUS")
      await prisma.channel.update({ where: { id: f.channelId }, data: { status: "REMOVED" } });
    if (change === "CHANNEL_TOMBSTONE")
      await prisma.channel.update({ where: { id: f.channelId }, data: { removedAt: new Date() } });
    if (change === "VIDEO_STATUS")
      await prisma.video.update({ where: { id: f.videoId }, data: { status: "REMOVED" } });
    if (change === "VIDEO_TOMBSTONE")
      await prisma.video.update({ where: { id: f.videoId }, data: { removedAt: new Date() } });
  }
  for (const operation of ["CREATE", "REPLACE", "FINALIZE"] as const)
    for (const change of changes)
      it(`rejects ${change} committed during ${operation} provider I/O without changing caption state`, async () => {
        const f = await fixture();
        const track = operation === "CREATE" ? null : await prepared(f, operation === "REPLACE");
        const before = await state(f);
        const delayed = operation === "FINALIZE" ? pauseHead() : pauseAuthorize();
        const request =
          operation === "CREATE"
            ? create(f)
            : operation === "REPLACE"
              ? replace(f, track!.id)
              : finalize(f, track!.id);
        await delayed.entered;
        try {
          await changeAuthority(f, change);
        } finally {
          delayed.release();
        }
        const response = await request;
        expect(response.statusCode).toBe(
          ["ACCOUNT", "AUTHVERSION", "SESSION", "SESSIONEXPIRY"].includes(change)
            ? 401
            : change === "ROLE"
              ? 403
              : 409,
        );
        expect(await state(f)).toEqual(before);
        expect(storage.deleteObject).not.toHaveBeenCalled();
        if (operation === "FINALIZE") expect(storage.readObject).not.toHaveBeenCalled();
      });

  it("finalize preserves a concurrent enabled/default edit instead of restoring stale flags", async () => {
    const f = await fixture(),
      track = await prepared(f, true);
    expect((await replace(f, track.id)).statusCode).toBe(201);
    const delayed = pauseHead(),
      request = finalize(f, track.id);
    await delayed.entered;
    try {
      expect((await patch(f, track.id, { default: true })).statusCode).toBe(200);
    } finally {
      delayed.release();
    }
    expect((await request).statusCode).toBe(201);
    const current = await prisma.videoCaptionTrack.findUniqueOrThrow({ where: { id: track.id } });
    expect(current.isDefault).toBe(true);
    expect(current.isEnabled).toBe(true);
  });
  async function observedLock(marker: string) {
    await vi.waitFor(
      async () => {
        const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>(
          Prisma.sql`SELECT COUNT(*)::bigint AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE ${"%" + marker + "%"}`,
        );
        expect(Number(row?.count ?? 0)).toBeGreaterThanOrEqual(1);
      },
      { timeout: 4000, interval: 20 },
    );
  }

  for (const operation of ["CREATE", "REPLACE", "FINALIZE", "PATCH", "REMOVE", "LIST"] as const)
    for (const change of [
      "ACCOUNT",
      "AUTHVERSION",
      "SESSION",
      "ROLE",
      "CHANNEL_TOMBSTONE",
      "VIDEO_TOMBSTONE",
      "SESSIONEXPIRY",
    ] as const)
      it(`checks ${change} after an observed PostgreSQL row-lock wait for ${operation}`, async () => {
        const f = await fixture();
        const track = operation === "CREATE" ? null : await prepared(f, operation !== "FINALIZE");
        if (change === "SESSIONEXPIRY")
          await prisma.accountSession.updateMany({
            where: { accountId: f.accountId },
            data: { expiresAt: new Date(Date.now() + 1200) },
          });
        vi.clearAllMocks();
        const before = await state(f),
          entered = gate(),
          done = gate();
        const target =
          change === "ACCOUNT" || change === "AUTHVERSION"
            ? "account"
            : change === "SESSION"
              ? "session"
              : change === "ROLE"
                ? "member"
                : change === "CHANNEL_TOMBSTONE"
                  ? "channel"
                  : "video";
        const holder = prisma.$transaction(
          async (tx) => {
            if (target === "account")
              await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${f.accountId}::uuid FOR UPDATE`;
            if (target === "session")
              await tx.$queryRaw`SELECT id FROM "AccountSession" WHERE "accountId" = ${f.accountId}::uuid FOR UPDATE`;
            if (target === "member")
              await tx.$queryRaw`SELECT id FROM "ChannelMember" WHERE "accountId" = ${f.accountId}::uuid AND "channelId" = ${f.channelId}::uuid FOR UPDATE`;
            if (target === "channel")
              await tx.$queryRaw`SELECT id FROM "Channel" WHERE id = ${f.channelId}::uuid FOR UPDATE`;
            if (target === "video")
              await tx.$queryRaw`SELECT id FROM "Video" WHERE id = ${f.videoId}::uuid FOR UPDATE`;
            entered.release();
            await done.promise;
            if (change === "ACCOUNT")
              await tx.account.update({
                where: { id: f.accountId },
                data: { status: "SUSPENDED" },
              });
            if (change === "AUTHVERSION")
              await tx.account.update({
                where: { id: f.accountId },
                data: { authVersion: { increment: 1 } },
              });
            if (change === "SESSION")
              await tx.accountSession.updateMany({
                where: { accountId: f.accountId },
                data: { revokedAt: new Date() },
              });
            if (change === "ROLE")
              await tx.channelMember.deleteMany({
                where: { accountId: f.accountId, channelId: f.channelId },
              });
            if (change === "CHANNEL_TOMBSTONE")
              await tx.channel.update({
                where: { id: f.channelId },
                data: { removedAt: new Date() },
              });
            if (change === "VIDEO_TOMBSTONE")
              await tx.video.update({ where: { id: f.videoId }, data: { removedAt: new Date() } });
          },
          { timeout: 12000 },
        );
        await entered.promise;
        const request =
          operation === "CREATE"
            ? create(f)
            : operation === "REPLACE"
              ? replace(f, track!.id)
              : operation === "FINALIZE"
                ? finalize(f, track!.id)
                : operation === "PATCH"
                  ? patch(f, track!.id, { label: "Stale edit" })
                  : operation === "REMOVE"
                    ? remove(f, track!.id)
                    : Promise.resolve(
                        app.inject({
                          method: "GET",
                          url: `/creator/studio/videos/${f.videoId}/captions`,
                          headers: { cookie: f.cookie },
                        }),
                      );
        try {
          await observedLock(
            target === "account"
              ? "ayin-media-owner-account-lock"
              : target === "member"
                ? "ayin-media-owner-membership-lock"
                : `ayin-caption-${target}-lock`,
          );
          if (change === "SESSIONEXPIRY")
            await vi.waitFor(
              async () => {
                const [row] = await prisma.$queryRaw<Array<{ expired: boolean }>>(
                  Prisma.sql`SELECT bool_and("expiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC')) AS expired FROM "AccountSession" WHERE "accountId" = ${f.accountId}::uuid`,
                );
                expect(row?.expired).toBe(true);
              },
              { timeout: 3000, interval: 20 },
            );
        } finally {
          done.release();
        }
        await holder;
        const response = await request;
        expect(response.statusCode).toBe(
          change === "ROLE" ? 403 : change.includes("TOMBSTONE") ? 409 : 401,
        );
        expect(await state(f)).toEqual(before);
        for (const value of Object.values(storage))
          if (typeof value === "function") expect(value).not.toHaveBeenCalled();
      });

  it("rechecks authority after a delayed caption body read without rejecting the pending asset", async () => {
    const f = await fixture(),
      track = await prepared(f),
      before = await state(f);
    const entered = gate(),
      done = gate();
    vi.mocked(storage.readObject!).mockImplementationOnce(async () => {
      entered.release();
      await done.promise;
      return bytes;
    });
    const request = finalize(f, track.id);
    await entered.promise;
    try {
      await changeAuthority(f, "SESSION");
    } finally {
      done.release();
    }
    expect((await request).statusCode).toBe(401);
    expect(await state(f)).toEqual(before);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it("does not reject an already validated winner after a delayed invalid body arrives", async () => {
    const f = await fixture(),
      track = await prepared(f),
      entered = gate(),
      done = gate();
    vi.mocked(storage.readObject!).mockImplementationOnce(async () => {
      entered.release();
      await done.promise;
      return new Uint8Array(bytes.byteLength).fill(65);
    });
    const request = finalize(f, track.id);
    await entered.promise;
    try {
      expect((await finalize(f, track.id)).statusCode).toBe(201);
    } finally {
      done.release();
    }
    const before = await state(f);
    expect((await request).statusCode).toBe(409);
    expect(await state(f)).toEqual(before);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it("preserves a pending caption on ambiguous truncated reads", async () => {
    const f = await fixture(),
      track = await prepared(f),
      before = await state(f);
    vi.mocked(storage.readObject!).mockResolvedValueOnce(bytes.slice(0, -1));
    expect((await finalize(f, track.id)).statusCode).toBe(503);
    expect(await state(f)).toEqual(before);
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect((await finalize(f, track.id)).statusCode).toBe(201);
  });

  it("does not resurrect a caption asset tombstoned during validation", async () => {
    const f = await fixture(),
      track = await prepared(f),
      delayed = pauseHead();
    const request = finalize(f, track.id);
    await delayed.entered;
    try {
      await prisma.mediaAsset.update({
        where: { id: track.pendingMediaAssetId! },
        data: { removedAt: new Date() },
      });
    } finally {
      delayed.release();
    }
    const before = await state(f);
    expect((await request).statusCode).toBe(409);
    expect(await state(f)).toEqual(before);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it("validates against the current duration after the provider wait", async () => {
    const f = await fixture(),
      track = await prepared(f),
      delayed = pauseHead();
    const request = finalize(f, track.id);
    await delayed.entered;
    try {
      await prisma.video.update({ where: { id: f.videoId }, data: { durationMs: 500 } });
    } finally {
      delayed.release();
    }
    expect((await request).statusCode).toBe(400);
    expect(await prisma.videoCaptionTrack.findUnique({ where: { id: track.id } })).toBeNull();
    expect(
      (await prisma.mediaAsset.findUniqueOrThrow({ where: { id: track.pendingMediaAssetId! } }))
        .status,
    ).toBe("REJECTED");
  });

  it("turns two concurrent same-identity preparations into one success and one domain conflict", async () => {
    const f = await fixture(),
      delayed = pauseAuthorize();
    const first = create(f);
    await delayed.entered;
    let second;
    try {
      second = await create(f);
    } finally {
      delayed.release();
    }
    expect(second.statusCode).toBe(201);
    const response = await first;
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("CAPTION_TRACK_DUPLICATE");
    const current = await state(f);
    expect(current.tracks).toHaveLength(1);
    expect(current.assets).toHaveLength(1);
  });

  it("serializes simultaneous default finalizations across tracks", async () => {
    const f = await fixture();
    const a = await create(f, "en", true),
      b = await create(f, "ar", true);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    const responses = await Promise.all([
      finalize(f, a.json().trackId),
      finalize(f, b.json().trackId),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([201, 201]);
    const current = await state(f);
    expect(current.tracks.filter((track) => track.isDefault)).toHaveLength(1);
    expect(current.assets.every((asset) => asset.status === "VALIDATED")).toBe(true);
  });

  it("respects a later explicit disable while a default replacement is being validated", async () => {
    const f = await fixture(),
      track = await prepared(f, true);
    expect((await patch(f, track.id, { default: true })).statusCode).toBe(200);
    expect((await replace(f, track.id)).statusCode).toBe(201);
    const delayed = pauseHead(),
      request = finalize(f, track.id);
    await delayed.entered;
    try {
      expect((await patch(f, track.id, { enabled: false })).statusCode).toBe(200);
    } finally {
      delayed.release();
    }
    expect((await request).statusCode).toBe(201);
    const current = await prisma.videoCaptionTrack.findUniqueOrThrow({ where: { id: track.id } });
    expect(current.isDefault).toBe(false);
    expect(current.isEnabled).toBe(false);
  });

  for (const role of ["OWNER", "ADMIN", "EDITOR"] as const)
    it(`keeps ordinary ${role} caption workflows available without admin MFA`, async () => {
      const f = await fixture();
      await prisma.channelMember.updateMany({
        where: { accountId: f.accountId, channelId: f.channelId },
        data: { role },
      });
      const track = await prepared(f, true);
      expect((await patch(f, track.id, { label: "Allowed editor" })).statusCode).toBe(200);
      expect((await replace(f, track.id)).statusCode).toBe(201);
      expect((await finalize(f, track.id)).statusCode).toBe(201);
      expect((await remove(f, track.id)).statusCode).toBe(200);
      expect(await prisma.accountMfaCredential.count({ where: { accountId: f.accountId } })).toBe(
        0,
      );
    });
  it("preserves a recoverable pending asset when PostgreSQL aborts the validation commit", async () => {
    const f = await fixture(),
      track = await prepared(f),
      before = await state(f);
    await prisma.$executeRawUnsafe(`CREATE FUNCTION caption_test_abort() RETURNS trigger AS $$
      BEGIN IF NEW.kind = 'CAPTION' AND NEW.status = 'VALIDATED' THEN RAISE EXCEPTION 'controlled caption commit abort'; END IF; RETURN NEW; END;
      $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER caption_test_abort BEFORE UPDATE ON "MediaAsset" FOR EACH ROW EXECUTE FUNCTION caption_test_abort()`,
    );
    try {
      expect((await finalize(f, track.id)).statusCode).toBe(500);
      expect(await state(f)).toEqual(before);
      expect(storage.deleteObject).not.toHaveBeenCalled();
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER caption_test_abort ON "MediaAsset"');
      await prisma.$executeRawUnsafe("DROP FUNCTION caption_test_abort()");
    }
    expect((await finalize(f, track.id)).statusCode).toBe(201);
  });

  it("does not claim a validated-but-tombstoned caption asset is ready", async () => {
    const f = await fixture(),
      track = await prepared(f, true);
    await prisma.mediaAsset.update({
      where: { id: track.mediaAssetId! },
      data: { removedAt: new Date() },
    });
    const response = await app.inject({
      method: "GET",
      url: `/creator/studio/videos/${f.videoId}/captions`,
      headers: { cookie: f.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().tracks[0].status).toBe("PENDING");
    const before = await state(f);
    expect((await patch(f, track.id, { default: true })).statusCode).toBe(409);
    expect(await state(f)).toEqual(before);
  });
  it("lets real owner anonymization finish while a different channel editor waits on owner authority", async () => {
    const owner = await fixture(),
      track = await prepared(owner, true),
      editor = await fixture();
    await prisma.channelMember.create({
      data: { accountId: editor.accountId, channelId: owner.channelId, role: "EDITOR" },
    });
    await prisma.account.update({
      where: { id: owner.accountId },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    const deletion = await prisma.accountDeletionRequest.create({
      data: {
        accountId: owner.accountId,
        state: "DEACTIVATED",
        deactivatedAt: new Date(Date.now() - 25 * 60 * 60_000),
      },
    });
    const entered = gate(),
      done = gate();
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Video" WHERE id = ${owner.videoId}::uuid FOR UPDATE`;
        entered.release();
        await done.promise;
      },
      { timeout: 12000 },
    );
    await entered.promise;
    const privacy = app.get(PrivacyLifecycleService).advanceDue(new Date(), 1);
    // Observe the real privacy worker after it owns MediaAsset and is queued on Video.
    let response: ReturnType<typeof patch> | undefined;
    try {
      await observedLock('UPDATE "public"."Video"');
      response = patch({ ...owner, accountId: editor.accountId, cookie: editor.cookie }, track.id, {
        label: "Stale editor label",
      });
      await observedLock("ayin-media-owner-account-lock");
    } finally {
      done.release();
    }
    await holder;
    const outcomes = await Promise.allSettled([privacy, response!]);
    expect(outcomes[0].status).toBe("fulfilled");
    expect(outcomes[0].status === "fulfilled" && outcomes[0].value).toBe(1);
    expect(outcomes[1].status).toBe("fulfilled");
    expect(
      outcomes[1].status === "fulfilled" &&
        typeof outcomes[1].value === "object" &&
        outcomes[1].value.statusCode,
    ).toBe(409);
    expect(
      (await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: deletion.id } })).state,
    ).toBe("ANONYMIZED");
    expect(
      (await prisma.videoCaptionTrack.findUniqueOrThrow({ where: { id: track.id } })).label,
    ).toBe(track.label);
    expect(
      (await prisma.mediaAsset.findUniqueOrThrow({ where: { id: track.mediaAssetId! } })).status,
    ).toBe("REMOVED");
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });
  for (const candidate of ["REPLACEMENT", "PENDING_ONLY"] as const)
    for (const selection of ["PATCH", "FINALIZE"] as const)
      it(`keeps the later ${selection} default selection while an older ${candidate} validation finishes`, async () => {
        const f = await fixture();
        let a;
        if (candidate === "REPLACEMENT") {
          a = await prepared(f, true);
          expect((await patch(f, a.id, { default: true })).statusCode).toBe(200);
          expect((await replace(f, a.id)).statusCode).toBe(201);
        } else {
          const created = await create(f, "en", true);
          expect(created.statusCode).toBe(201);
          a = await prisma.videoCaptionTrack.findUniqueOrThrow({
            where: { id: created.json().trackId },
          });
        }
        const b = await create(f, "ar", selection === "FINALIZE");
        expect(b.statusCode).toBe(201);
        const bId = b.json().trackId as string;
        if (selection === "PATCH") expect((await finalize(f, bId)).statusCode).toBe(201);
        const delayed = pauseHead(),
          request = finalize(f, a.id);
        await delayed.entered;
        let remainingIntent;
        try {
          expect(
            (selection === "PATCH"
              ? await patch(f, bId, { default: true })
              : await finalize(f, bId)
            ).statusCode,
          ).toBe(selection === "PATCH" ? 200 : 201);
          remainingIntent = await prisma.videoCaptionTrack.findUniqueOrThrow({
            where: { id: a.id },
          });
        } finally {
          delayed.release();
        }
        expect((await request).statusCode).toBe(201);
        const after = await state(f);
        expect(after.tracks.filter((track) => track.isDefault).map((track) => track.id)).toEqual([
          bId,
        ]);
        expect(remainingIntent.pendingMakeDefault).toBe(false);
        expect(after.tracks.find((track) => track.id === a.id)?.pendingMediaAssetId).toBeNull();
      });

  for (const input of [{ label: "Current default label" }, { enabled: true }])
    it(`does not treat an unrelated ${Object.keys(input)[0]} edit on the current default as a new selection`, async () => {
      const f = await fixture(),
        current = await prepared(f, true);
      expect((await patch(f, current.id, { default: true })).statusCode).toBe(200);
      const pending = await create(f, "ar", true);
      expect(pending.statusCode).toBe(201);
      const pendingId = pending.json().trackId as string;
      const delayed = pauseHead(),
        request = finalize(f, pendingId);
      await delayed.entered;
      let remainingIntent;
      try {
        expect((await patch(f, current.id, input)).statusCode).toBe(200);
        remainingIntent = await prisma.videoCaptionTrack.findUniqueOrThrow({
          where: { id: pendingId },
        });
      } finally {
        delayed.release();
      }
      expect((await request).statusCode).toBe(201);
      expect(remainingIntent.pendingMakeDefault).toBe(true);
      expect(
        (await state(f)).tracks.filter((track) => track.isDefault).map((track) => track.id),
      ).toEqual([pendingId]);
    });
  it("keeps real privacy bulk cleanup compatible with sorted active and pending caption asset locks", async () => {
    const owner = await fixture(),
      editor = await fixture();
    await prisma.channelMember.create({
      data: { accountId: editor.accountId, channelId: owner.channelId, role: "EDITOR" },
    });
    const high = "ffffffff-ffff-4fff-8fff-ffffffffffff",
      low = "00000000-0000-4000-8000-000000000001";
    for (const id of [high, low])
      await prisma.mediaAsset.create({
        data: {
          id,
          videoId: owner.videoId,
          channelId: owner.channelId,
          kind: "CAPTION",
          status: id === high ? "VALIDATED" : "PENDING",
          r2ObjectKey: `review/${id}.vtt`,
          mimeType: "text/vtt",
          sizeBytes: BigInt(bytes.byteLength),
        },
      });
    const track = await prisma.videoCaptionTrack.create({
      data: {
        videoId: owner.videoId,
        mediaAssetId: high,
        pendingMediaAssetId: low,
        languageCode: "en",
        label: "review",
        kind: "SUBTITLES",
        isEnabled: true,
        isDefault: false,
      },
    });
    await prisma.account.update({
      where: { id: owner.accountId },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    const deletion = await prisma.accountDeletionRequest.create({
      data: {
        accountId: owner.accountId,
        state: "DEACTIVATED",
        deactivatedAt: new Date(Date.now() - 25 * 60 * 60_000),
      },
    });
    // Pause the real bulk UPDATE after its first high-ID tuple lock. No product method is stubbed.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION review_pause_asset() RETURNS trigger AS $$ BEGIN
      IF NEW.id = '${high}'::uuid AND NEW.status = 'REMOVED' THEN PERFORM pg_advisory_xact_lock(92381, 1); END IF;
      RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER review_pause_asset BEFORE UPDATE ON "MediaAsset" FOR EACH ROW EXECUTE FUNCTION review_pause_asset()`,
    );
    const entered = gate(),
      done = gate();
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(92381, 1)`;
        entered.release();
        await done.promise;
      },
      { timeout: 12000 },
    );
    await entered.promise;
    const privacy = app.get(PrivacyLifecycleService).advanceDue(new Date(), 1);
    let response: ReturnType<typeof patch> | undefined;
    try {
      await observedLock('UPDATE "public"."MediaAsset"');
      response = patch({ ...owner, accountId: editor.accountId, cookie: editor.cookie }, track.id, {
        label: "Stale editor",
      });
      await observedLock("ayin-media-owner-account-lock");
    } finally {
      done.release();
    }
    await holder;
    const outcomes = await Promise.allSettled([privacy, response!]);
    await prisma.$executeRawUnsafe('DROP TRIGGER review_pause_asset ON "MediaAsset"');
    await prisma.$executeRawUnsafe("DROP FUNCTION review_pause_asset()");
    const after = await prisma.accountDeletionRequest.findUniqueOrThrow({
      where: { id: deletion.id },
    });
    expect(outcomes[0].status).toBe("fulfilled");
    expect(outcomes[0].status === "fulfilled" && outcomes[0].value).toBe(1);
    expect(after.state).toBe("ANONYMIZED");
    expect(
      outcomes[1].status === "fulfilled" &&
        typeof outcomes[1].value === "object" &&
        outcomes[1].value.statusCode,
    ).toBe(409);
  });
  async function differentEditor(order: "before" | "after") {
    const accounts = [await fixture(), await fixture()].sort((a, b) =>
      a.accountId.localeCompare(b.accountId),
    );
    const editor = accounts[order === "before" ? 0 : 1]!,
      owner = accounts[order === "before" ? 1 : 0]!;
    await prisma.channelMember.create({
      data: { accountId: editor.accountId, channelId: owner.channelId, role: "EDITOR" },
    });
    const track = await prepared(owner, true);
    vi.clearAllMocks();
    return {
      owner,
      editor: { ...owner, accountId: editor.accountId, cookie: editor.cookie },
      track,
    };
  }
  async function requestOwnerDeletion(owner: Fixture) {
    await prisma.account.update({
      where: { id: owner.accountId },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    return prisma.accountDeletionRequest.create({
      data: {
        accountId: owner.accountId,
        state: "DEACTIVATED",
        deactivatedAt: new Date(Date.now() - 25 * 60 * 60_000),
      },
    });
  }
  async function assertCompleteCaptionCleanup(
    owner: Fixture,
    requestId: string,
    assetCount: number,
  ) {
    const current = await state(owner);
    expect(current.assets).toHaveLength(assetCount);
    expect(
      current.assets.every((asset) => asset.status === "REMOVED" && asset.removedAt !== null),
    ).toBe(true);
    const jobs = await prisma.privacyMediaDeletionJob.findMany({
      where: { requestId, kind: "OBJECT" },
    });
    expect(jobs.map((job) => job.target).sort()).toEqual(
      current.assets.map((asset) => asset.r2ObjectKey).sort(),
    );
    expect(
      (await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: requestId } })).state,
    ).toBe("ANONYMIZED");
    await app.get(PrivacyLifecycleService).processMediaDeletionBatch(new Date(), 20);
    for (const asset of current.assets)
      expect(storage.deleteObject).toHaveBeenCalledWith(asset.r2ObjectKey);
    expect(
      await prisma.privacyMediaDeletionJob.count({ where: { requestId, status: { not: "DONE" } } }),
    ).toBe(0);
  }

  for (const order of ["before", "after"] as const)
    for (const operation of ["CREATE", "REPLACE"] as const)
      it(`blocks caption ${operation} after the actual privacy snapshot when editor sorts ${order} owner`, async () => {
        const f = await differentEditor(order),
          deletion = await requestOwnerDeletion(f.owner);
        await prisma.$executeRawUnsafe(`CREATE FUNCTION pause_caption_snapshot() RETURNS trigger AS $$ BEGIN
          PERFORM pg_advisory_xact_lock(92387, 1); RETURN NEW; END; $$ LANGUAGE plpgsql`);
        await prisma.$executeRawUnsafe(
          'CREATE TRIGGER pause_caption_snapshot BEFORE INSERT ON "PrivacyMediaDeletionJob" FOR EACH ROW EXECUTE FUNCTION pause_caption_snapshot()',
        );
        try {
          const entered = gate(),
            done = gate();
          const holder = prisma.$transaction(
            async (tx) => {
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(92387, 1)`;
              entered.release();
              await done.promise;
            },
            { timeout: 12000 },
          );
          await entered.promise;
          const privacy = app.get(PrivacyLifecycleService).advanceDue(new Date(), 1);
          let request: ReturnType<typeof create> | undefined,
            queued = false;
          try {
            await observedLock('INSERT INTO "public"."PrivacyMediaDeletionJob"');
            request =
              operation === "CREATE" ? create(f.editor, "ar") : replace(f.editor, f.track.id);
            let settled = false;
            void request.then(() => {
              settled = true;
            });
            await vi.waitFor(
              async () => {
                if (settled) return;
                const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>(
                  Prisma.sql`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%ayin-media-owner-account-lock%'`,
                );
                expect(Number(row?.count)).toBeGreaterThan(0);
                queued = true;
              },
              { timeout: 4000, interval: 20 },
            );
          } finally {
            done.release();
          }
          await holder;
          expect(await privacy).toBe(1);
          const response = await request!;
          expect(response.statusCode).toBe(409);
          expect(response.json().uploadUrl).toBeUndefined();
          expect(queued).toBe(true);
          expect(storage.authorizeSinglePut).not.toHaveBeenCalled();
          await assertCompleteCaptionCleanup(f.owner, deletion.id, 1);
        } finally {
          await prisma.$executeRawUnsafe(
            'DROP TRIGGER pause_caption_snapshot ON "PrivacyMediaDeletionJob"',
          );
          await prisma.$executeRawUnsafe("DROP FUNCTION pause_caption_snapshot()");
        }
      });

  for (const order of ["before", "after"] as const)
    for (const operation of ["CREATE", "REPLACE", "FINALIZE", "READ"] as const)
      it(`keeps owner privacy complete across caption ${operation} provider I/O with editor ${order} owner`, async () => {
        const f = await differentEditor(order);
        if (operation === "FINALIZE" || operation === "READ")
          expect((await replace(f.editor, f.track.id)).statusCode).toBe(201);
        vi.clearAllMocks();
        const delayed =
          operation === "READ"
            ? (() => {
                const entered = gate(),
                  done = gate();
                vi.mocked(storage.readObject!).mockImplementationOnce(async () => {
                  entered.release();
                  await done.promise;
                  return bytes;
                });
                return { entered: entered.promise, release: done.release };
              })()
            : operation === "FINALIZE"
              ? pauseHead()
              : pauseAuthorize();
        const request =
          operation === "CREATE"
            ? create(f.editor, "ar")
            : operation === "REPLACE"
              ? replace(f.editor, f.track.id)
              : finalize(f.editor, f.track.id);
        await delayed.entered;
        let deletion;
        try {
          // Owner and actor Account locks must be released throughout provider I/O.
          await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`;
            await tx.$queryRaw(
              Prisma.sql`SELECT id FROM "Account" WHERE id IN (${f.owner.accountId}::uuid, ${f.editor.accountId}::uuid) ORDER BY id FOR UPDATE`,
            );
          });
          deletion = await requestOwnerDeletion(f.owner);
          expect(await app.get(PrivacyLifecycleService).advanceDue(new Date(), 1)).toBe(1);
        } finally {
          delayed.release();
        }
        const response = await request;
        expect(response.statusCode).toBe(409);
        expect(response.json().uploadUrl).toBeUndefined();
        expect(storage.deleteObject).not.toHaveBeenCalled();
        if (operation === "FINALIZE") expect(storage.readObject).not.toHaveBeenCalled();
        await assertCompleteCaptionCleanup(
          f.owner,
          deletion!.id,
          operation === "FINALIZE" || operation === "READ" ? 2 : 1,
        );
      });

  for (const order of ["before", "after"] as const)
    it(`preserves shared-owner caption creation after one owner is anonymized with editor ${order} owner`, async () => {
      const f = await differentEditor(order),
        remainingOwner = await fixture();
      await prisma.channelMember.create({
        data: { accountId: remainingOwner.accountId, channelId: f.owner.channelId, role: "OWNER" },
      });
      const delayed = pauseAuthorize(),
        request = create(f.editor, "ar");
      await delayed.entered;
      let deletion;
      try {
        deletion = await requestOwnerDeletion(f.owner);
        expect(await app.get(PrivacyLifecycleService).advanceDue(new Date(), 1)).toBe(1);
      } finally {
        delayed.release();
      }
      const response = await request;
      expect(response.statusCode).toBe(201);
      expect(response.json().uploadUrl).toBeDefined();
      expect(
        await prisma.privacyMediaDeletionJob.count({ where: { requestId: deletion!.id } }),
      ).toBe(0);
      expect(
        (await prisma.channel.findUniqueOrThrow({ where: { id: f.owner.channelId } })).status,
      ).toBe("ACTIVE");
      expect((await finalize(f.editor, response.json().trackId)).statusCode).toBe(201);
      expect(
        await prisma.accountMfaCredential.count({ where: { accountId: f.editor.accountId } }),
      ).toBe(0);
    });

  for (const order of ["before", "after"] as const)
    it(`rejects changed channel owners after the canonical account wait with editor ${order} owner`, async () => {
      const f = await differentEditor(order),
        before = await state(f.owner),
        entered = gate(),
        done = gate();
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${f.owner.accountId}::uuid FOR UPDATE`;
          entered.release();
          await done.promise;
          await tx.channelMember.deleteMany({
            where: { accountId: f.owner.accountId, channelId: f.owner.channelId, role: "OWNER" },
          });
        },
        { timeout: 12000 },
      );
      await entered.promise;
      const request = create(f.editor, "ar");
      try {
        await observedLock("ayin-media-owner-account-lock");
      } finally {
        done.release();
      }
      await holder;
      const response = await request;
      expect(response.statusCode).toBe(409);
      expect(response.json().uploadUrl).toBeUndefined();
      expect(await state(f.owner)).toEqual(before);
      expect(storage.authorizeSinglePut).not.toHaveBeenCalled();
    });

  for (const letterCase of ["UPPER", "MIXED"] as const)
    it(`keeps valid ${letterCase} caption route UUIDs canonical through the full lifecycle`, async () => {
      const f = await fixture();
      const transform = (value: string) =>
        letterCase === "UPPER"
          ? value.toUpperCase()
          : [...value].map((char, i) => (i % 2 ? char.toUpperCase() : char)).join("");
      const route = { ...f, videoId: transform(f.videoId) },
        created = await create(route);
      expect(created.statusCode).toBe(201);
      const trackId = created.json().trackId as string,
        routeId = transform(trackId);
      const asset = (await state(f)).assets[0]!;
      expect(asset.r2ObjectKey).toBe(`captions/videos/${f.videoId}/${asset.id}/track.vtt`);
      expect((await finalize(route, routeId)).statusCode).toBe(201);
      expect((await patch(route, routeId, { default: true })).statusCode).toBe(200);
      expect((await replace(route, routeId)).statusCode).toBe(201);
      expect((await finalize(route, routeId)).statusCode).toBe(201);
      const listed = await app.inject({
        method: "GET",
        url: `/creator/studio/videos/${route.videoId}/captions`,
        headers: { cookie: route.cookie },
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().tracks[0].id).toBe(trackId);
      expect((await remove(route, routeId)).statusCode).toBe(200);
    });
});
