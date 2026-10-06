import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { createPrismaClient, Prisma } from "@ayin/db";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { SessionService } from "../src/auth/session.service.js";
import {
  MEDIA_STORAGE_ADAPTER,
  MediaStorageObservationError,
  type MediaStorageAdapter,
} from "../src/media/media-storage.adapter.js";
import { R2HttpError } from "../src/media/r2-sigv4.js";
import { MediaProcessingStorageService } from "../src/media/media-processing-storage.service.js";
import { DatabaseService } from "../src/database/database.service.js";
import { enrollTestMfa } from "./mfa-test-helper.js";

const url = process.env.TEST_DATABASE_URL;
const databaseDescribe = url ? describe : describe.skip;
const partSizeBytes = 5 * 1024 * 1024;
const sizeBytes = 2 * partSizeBytes + 17;
const contentBytes = Buffer.alloc(sizeBytes, 0x42);
const domain = Buffer.from("AYIN:source-file:sha256-chunks:v1\0");
const header = Buffer.alloc(16);
header.writeBigUInt64BE(BigInt(sizeBytes));
header.writeUInt32BE(4194304, 8);
header.writeUInt32BE(Math.ceil(sizeBytes / 4194304), 12);
const leaves: Buffer[] = [];
for (let offset = 0; offset < contentBytes.length; offset += 4194304)
  leaves.push(
    createHash("sha256")
      .update(contentBytes.subarray(offset, offset + 4194304))
      .digest(),
  );
const rootSha256 = createHash("sha256")
  .update(Buffer.concat([domain, header, ...leaves]))
  .digest("hex");
const storage: MediaStorageAdapter = {
  kind: "r2",
  available: true,
  createMultipartUpload: vi.fn(),
  authorizeMultipartPart: vi.fn(),
  authorizeSinglePut: vi.fn(),
  listParts: vi.fn(async () => [
    { partNumber: 1, etag: '"private-provider-etag"', sizeBytes: partSizeBytes },
  ]),
  completeMultipartUpload: vi.fn(),
  abortMultipartUpload: vi.fn(),
  headObject: vi.fn(async () => ({
    sizeBytes,
    contentType: "video/mp4",
    etag: '"private-object-etag"',
  })),
  deleteObject: vi.fn(),
  deletePrefix: vi.fn(),
  listMultipartUploads: vi.fn(),
};

databaseDescribe("Dormant upload session inspection", () => {
  const db = createPrismaClient(url);
  let app: NestFastifyApplication;
  async function openApplication() {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MEDIA_STORAGE_ADAPTER)
      .useValue(storage)
      .overrideProvider(MediaProcessingStorageService)
      .useValue({ headObject: storage.headObject })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.DATABASE_URL = url;
    process.env.AUTH_TOKEN_SECRET = "dormant-upload-auth-secret-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET = "dormant-upload-signing-secret-more-than-32-characters";
    process.env.WEB_ORIGIN = "http://localhost:3000";
    await openApplication();
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(storage.listParts).mockResolvedValue([
      { partNumber: 1, etag: '"private-provider-etag"', sizeBytes: partSizeBytes },
    ]);
    vi.mocked(storage.headObject).mockResolvedValue({
      sizeBytes,
      contentType: "video/mp4",
      etag: '"private-object-etag"',
    });
    await db.$executeRawUnsafe('TRUNCATE TABLE "Account", "Channel", "MediaUploadSession" CASCADE');
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  async function register() {
    const result = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        name: "Recovery fixture",
        email: `recovery-${randomUUID()}@example.com`,
        password: "strong-pass-123",
      },
    });
    expect(result.statusCode).toBe(201);
    const setCookie = result.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";", 1)[0];
    if (!cookie) throw Error("Actual authenticated fixture cookie missing");
    return {
      cookie,
      accountId: result.json().user.account.id as string,
      channelId: result.json().user.channel.id as string,
    };
  }
  async function fixture(admin = false, single = false) {
    const owner = await register(),
      actor = admin ? await register() : owner;
    if (admin)
      await db.adminRoleAssignment.create({
        data: { accountId: actor.accountId, role: "OPERATIONS" },
      });
    const video = await db.video.create({
      data: {
        channelId: owner.channelId,
        title: "Synthetic dormant source",
        slug: `recovery-${randomUUID()}`,
        status: "UPLOADING",
      },
    });
    const assetId = randomUUID();
    const objectKey = `channels/${owner.channelId}/media/${assetId}/source.mp4`;
    await db.mediaAsset.create({
      data: {
        id: assetId,
        channelId: owner.channelId,
        videoId: video.id,
        kind: "SOURCE_VIDEO",
        status: "PENDING",
        r2ObjectKey: objectKey,
        sizeBytes: BigInt(sizeBytes),
        mimeType: "video/mp4",
      },
    });
    const session = await db.mediaUploadSession.create({
      data: {
        sourceAssetId: assetId,
        initiatingAccountId: actor.accountId,
        channelId: owner.channelId,
        videoId: video.id,
        objectKey,
        sizeBytes: BigInt(sizeBytes),
        mimeType: "video/mp4",
        authority: admin ? "ADMIN" : "OWNER",
        mode: single ? "SINGLE" : "MULTIPART",
        providerUploadId: single ? null : "private-persisted-multipart-id",
        partSizeBytes: BigInt(partSizeBytes),
        contentIdentityAlgorithm: "AYIN_SHA256_CHUNKS_V1",
        contentIdentityDigest: rootSha256,
        state: "OPEN",
        hardExpiresAt: new Date(Date.now() + 3600000),
      },
    });
    return { actor, owner, videoId: video.id, assetId, sessionId: session.id, objectKey };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function inspect(f: Fixture, cookie = f.actor.cookie, expectedAccount = f.actor.accountId) {
    return app.inject({
      method: "GET",
      url: `/media/uploads/sessions/${f.sessionId}/inspection`,
      headers: { cookie, "x-ayin-expected-account": expectedAccount },
    });
  }
  async function state(f: Fixture) {
    return {
      asset: await db.mediaAsset.findUnique({ where: { id: f.assetId } }),
      video: await db.video.findUnique({ where: { id: f.videoId } }),
      session: await db.mediaUploadSession.findUnique({ where: { id: f.sessionId } }),
      jobs: await db.mediaProcessingJob.count(),
    };
  }
  function noWrites() {
    for (const call of [
      storage.createMultipartUpload,
      storage.authorizeMultipartPart,
      storage.authorizeSinglePut,
      storage.completeMultipartUpload,
      storage.abortMultipartUpload,
      storage.deleteObject,
      storage.deletePrefix,
    ])
      expect(call).not.toHaveBeenCalled();
  }
  function noProvider() {
    noWrites();
    expect(storage.listParts).not.toHaveBeenCalled();
    expect(storage.headObject).not.toHaveBeenCalled();
  }

  it("reads durable provider identity through a new service instance without changing source/session/job state", async () => {
    const f = await fixture(),
      before = await state(f);
    await app.close();
    await openApplication();
    const result = await inspect(f);
    expect(result.statusCode).toBe(200);
    expect(result.headers["cache-control"]).toBe("private, no-store");
    expect(result.json()).toMatchObject({
      protocolVersion: 1,
      actorAccountId: f.actor.accountId,
      channelId: f.owner.channelId,
      sessionId: f.sessionId,
      assetId: f.assetId,
      videoId: f.videoId,
      state: "OPEN",
      expired: false,
      observation: {
        kind: "PARTS_OBSERVED",
        uploadedBytes: partSizeBytes,
        parts: [{ partNumber: 1, sizeBytes: partSizeBytes }],
      },
    });
    for (const secret of [
      f.objectKey,
      "private-persisted-multipart-id",
      rootSha256,
      "private-provider-etag",
      "sessionToken",
      "uploadUrl",
    ])
      expect(result.body).not.toContain(secret);
    expect(storage.listParts).toHaveBeenCalledWith({
      key: f.objectKey,
      uploadId: "private-persisted-multipart-id",
    });
    expect(await state(f)).toEqual(before);
    noWrites();
  });

  it("does not expose dormant issuance or create a recovery row for a legacy session", async () => {
    const actor = await register();
    vi.mocked(storage.authorizeSinglePut).mockResolvedValueOnce({
      url: "https://storage.example.invalid/synthetic",
      expiresAt: new Date(Date.now() + 60000),
    });
    const created = await app.inject({
      method: "POST",
      url: "/media/uploads/sessions",
      headers: { cookie: actor.cookie },
      payload: { channelId: actor.channelId, sizeBytes: 1024, mimeType: "video/mp4" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().sessionToken).toBeTypeOf("string");
    expect(await db.mediaUploadSession.count()).toBe(0);
    const result = await app.inject({
      method: "POST",
      url: "/media/uploads/sessions/recovery",
      headers: { cookie: actor.cookie },
      payload: { contentIdentityDigest: rootSha256 },
    });
    expect(result.statusCode).toBe(404);
  });

  it("conceals foreign IDs and enforces expected-account binding", async () => {
    const f = await fixture(),
      other = await register();
    expect((await inspect(f, other.cookie, other.accountId)).statusCode).toBe(404);
    expect((await inspect(f, f.actor.cookie, other.accountId)).statusCode).toBe(409);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/media/uploads/sessions/${f.sessionId}/inspection`,
        })
      ).statusCode,
    ).toBe(401);
    noProvider();
  });

  it("returns expired metadata without provider work or a persisted expiry mutation", async () => {
    const f = await fixture();
    await db.mediaUploadSession.update({
      where: { id: f.sessionId },
      data: {
        createdAt: new Date(Date.now() - 7200000),
        hardExpiresAt: new Date(Date.now() - 3600000),
      },
    });
    const before = await state(f),
      result = await inspect(f);
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      expired: true,
      observation: { kind: "NOT_INSPECTED", reason: "EXPIRED" },
    });
    expect(await state(f)).toEqual(before);
    noProvider();
  });

  it.each([
    "owner",
    "account",
    "session",
    "version",
    "channel",
    "video",
    "asset",
    "kind",
    "key",
    "bytes",
    "mime",
    "assetChannel",
    "assetVideo",
    "videoChannel",
    "detached",
  ] as const)("rejects changed %s before provider calls", async (change) => {
    const f = await fixture();
    if (change === "owner")
      await db.channelMember.deleteMany({
        where: { accountId: f.actor.accountId, channelId: f.owner.channelId },
      });
    if (change === "account")
      await db.account.update({ where: { id: f.actor.accountId }, data: { status: "CLOSED" } });
    if (change === "session")
      await db.accountSession.updateMany({
        where: { accountId: f.actor.accountId },
        data: { revokedAt: new Date() },
      });
    if (change === "version")
      await db.account.update({
        where: { id: f.actor.accountId },
        data: { authVersion: { increment: 1 } },
      });
    if (change === "channel")
      await db.channel.update({
        where: { id: f.owner.channelId },
        data: { removedAt: new Date() },
      });
    if (change === "video")
      await db.video.update({ where: { id: f.videoId }, data: { removedAt: new Date() } });
    if (change === "asset")
      await db.mediaAsset.update({ where: { id: f.assetId }, data: { removedAt: new Date() } });
    if (change === "kind")
      await db.mediaAsset.update({ where: { id: f.assetId }, data: { kind: "THUMBNAIL" } });
    if (change === "key")
      await db.mediaAsset.update({
        where: { id: f.assetId },
        data: { r2ObjectKey: "different/source.mp4" },
      });
    if (change === "bytes")
      await db.mediaAsset.update({
        where: { id: f.assetId },
        data: { sizeBytes: BigInt(sizeBytes + 1) },
      });
    if (change === "mime")
      await db.mediaAsset.update({ where: { id: f.assetId }, data: { mimeType: "video/webm" } });
    if (["assetChannel", "videoChannel"].includes(change)) {
      const other = await register();
      if (change === "assetChannel")
        await db.mediaAsset.update({
          where: { id: f.assetId },
          data: { channelId: other.channelId },
        });
      else
        await db.video.update({ where: { id: f.videoId }, data: { channelId: other.channelId } });
    }
    if (change === "assetVideo")
      await db.mediaAsset.update({ where: { id: f.assetId }, data: { videoId: null } });
    if (change === "detached") await db.mediaAsset.delete({ where: { id: f.assetId } });
    expect((await inspect(f)).statusCode).toBeGreaterThanOrEqual(400);
    noProvider();
  });

  it("requires current staff authority and explicit fresh step-up for an admin-origin record", async () => {
    const f = await fixture(true);
    expect((await inspect(f)).statusCode).toBe(200);
    vi.clearAllMocks();
    const actor = await db.account.findUniqueOrThrow({ where: { id: f.actor.accountId } });
    const session = await db.accountSession.findFirstOrThrow({ where: { accountId: actor.id } });
    const expired = await app.get(SessionService).rotate(actor.id, session.id, actor.authVersion, {
      reauthAt: Math.floor(Date.now() / 1000) - 301,
    });
    const oldCookie = `${f.actor.cookie.split("=", 1)[0]}=${expired}`;
    const rejected = await inspect(f, oldCookie);
    expect(rejected.statusCode).toBe(403);
    expect(rejected.body).toContain("STEP_UP_REQUIRED");
    noProvider();
    await db.adminRoleAssignment.deleteMany({ where: { accountId: actor.id } });
    expect((await inspect(f)).statusCode).toBe(403);
    noProvider();
  });

  it.each(["owner", "session", "revision", "asset", "expiry"] as const)(
    "rechecks %s after a provider read without holding authority locks",
    async (change) => {
      const f = await fixture();
      vi.mocked(storage.listParts).mockImplementationOnce(async () => {
        if (change === "owner")
          await db.channelMember.deleteMany({
            where: { accountId: f.actor.accountId, channelId: f.owner.channelId },
          });
        if (change === "session")
          await db.accountSession.updateMany({
            where: { accountId: f.actor.accountId },
            data: { revokedAt: new Date() },
          });
        if (change === "revision")
          await db.mediaUploadSession.update({
            where: { id: f.sessionId },
            data: { revision: { increment: 1 } },
          });
        if (change === "asset")
          await db.mediaAsset.update({ where: { id: f.assetId }, data: { removedAt: new Date() } });
        if (change === "expiry")
          await db.mediaUploadSession.update({
            where: { id: f.sessionId },
            data: {
              createdAt: new Date(Date.now() - 7200000),
              hardExpiresAt: new Date(Date.now() - 1000),
            },
          });
        return [{ partNumber: 1, etag: '"part"', sizeBytes: partSizeBytes }];
      });
      expect((await inspect(f)).statusCode).toBeGreaterThanOrEqual(400);
      noWrites();
    },
  );

  it.each([
    { parts: [{ partNumber: 1, etag: '"a"', sizeBytes: partSizeBytes - 1 }] },
    {
      parts: [
        { partNumber: 1, etag: '"a"', sizeBytes: partSizeBytes },
        { partNumber: 1, etag: '"b"', sizeBytes: partSizeBytes },
      ],
    },
    { parts: [{ partNumber: 4, etag: '"a"', sizeBytes: 17 }] },
  ])(
    "rejects a provider part list that disagrees with the immutable segmentation",
    async ({ parts }) => {
      const f = await fixture();
      vi.mocked(storage.listParts).mockResolvedValueOnce(parts);
      const result = await inspect(f);
      expect(result.statusCode).toBe(200);
      expect(result.json().observation).toEqual({
        kind: "UNAVAILABLE",
        reason: "INVALID_RESPONSE",
      });
      noWrites();
    },
  );

  it("keeps missing multipart and observed final metadata distinct from content verification", async () => {
    const f = await fixture();
    vi.mocked(storage.listParts).mockRejectedValueOnce(
      new MediaStorageObservationError("NO_SUCH_UPLOAD", "listParts", 404),
    );
    const before = await state(f),
      result = await inspect(f);
    expect(result.statusCode).toBe(200);
    expect(result.json().observation).toEqual({
      kind: "STORED_UNVERIFIED",
      sizeBytes,
      contentType: "video/mp4",
      multipartMissing: true,
    });
    expect(result.body).not.toContain("private-object-etag");
    expect(await state(f)).toEqual(before);
    noWrites();
  });

  it("does not translate a failed multipart read into HEAD absence or an empty successful list", async () => {
    const f = await fixture();
    vi.mocked(storage.listParts).mockRejectedValueOnce(
      new MediaStorageObservationError("PROVIDER_ERROR", "listParts", 503),
    );
    const result = await inspect(f);
    expect(result.statusCode).toBe(200);
    expect(result.json().observation).toEqual({ kind: "UNAVAILABLE", reason: "PROVIDER_ERROR" });
    expect(storage.headObject).not.toHaveBeenCalled();
    noWrites();
  });

  it.each([404, 503])(
    "reports single-object HEAD %i as unavailable, never ready or missing bytes",
    async (status) => {
      const f = await fixture(false, true);
      vi.mocked(storage.headObject).mockRejectedValueOnce(
        new R2HttpError(status, "HEAD", "private provider detail"),
      );
      const result = await inspect(f);
      expect(result.statusCode).toBe(200);
      expect(result.json().observation.kind).toBe("UNAVAILABLE");
      expect(result.body).not.toContain("private provider detail");
      noWrites();
    },
  );

  it("excludes operational snapshots and digests from the existing privacy export", async () => {
    const f = await fixture();
    const result = await app.inject({
      method: "GET",
      url: "/privacy/export",
      headers: { cookie: f.actor.cookie },
    });
    expect(result.statusCode).toBe(200);
    for (const privateValue of [f.objectKey, rootSha256, "private-persisted-multipart-id"])
      expect(result.body).not.toContain(privateValue);
    noProvider();
  });

  it("validates UUID and rejects unknown query keys without provider calls", async () => {
    const f = await fixture();
    for (const suffix of [`${f.sessionId}/inspection?renew=true`, "not-a-uuid/inspection"])
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/media/uploads/sessions/${suffix}`,
            headers: { cookie: f.actor.cookie },
          })
        ).statusCode,
      ).toBe(400);
    noProvider();
  });

  it("preserves real zero progress and exact final-part segmentation", async () => {
    const f = await fixture();
    vi.mocked(storage.listParts)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ partNumber: 3, etag: '"final-part"', sizeBytes: 17 }]);
    expect((await inspect(f)).json().observation).toEqual({
      kind: "PARTS_OBSERVED",
      uploadedBytes: 0,
      parts: [],
    });
    expect((await inspect(f)).json().observation).toEqual({
      kind: "PARTS_OBSERVED",
      uploadedBytes: 17,
      parts: [{ partNumber: 3, sizeBytes: 17 }],
    });
    noWrites();
  });

  it.each(["OBSERVATION_TIMEOUT", "OBSERVATION_LIMIT_EXCEEDED", "INVALID_RESPONSE"] as const)(
    "preserves provider uncertainty %s without a fallback mutation",
    async (code) => {
      const f = await fixture();
      vi.mocked(storage.listParts).mockRejectedValueOnce(
        new MediaStorageObservationError(code, "listParts"),
      );
      expect((await inspect(f)).json().observation).toEqual({ kind: "UNAVAILABLE", reason: code });
      expect(storage.headObject).not.toHaveBeenCalled();
      noWrites();
    },
  );

  it("requires current authority even when the provider read fails", async () => {
    const f = await fixture();
    vi.mocked(storage.listParts).mockImplementationOnce(async () => {
      await db.channelMember.deleteMany({
        where: { accountId: f.actor.accountId, channelId: f.owner.channelId },
      });
      throw new MediaStorageObservationError("PROVIDER_ERROR", "listParts", 503);
    });
    expect((await inspect(f)).statusCode).toBe(403);
    noWrites();
  });

  it("requires fresh valid login rather than any persisted original bearer", async () => {
    const f = await fixture();
    await db.accountSession.updateMany({
      where: { accountId: f.actor.accountId },
      data: { revokedAt: new Date() },
    });
    const account = await db.account.findUniqueOrThrow({ where: { id: f.actor.accountId } });
    const token = await app.get(SessionService).create(account.id, account.authVersion, {}, {});
    const cookie = `${f.actor.cookie.split("=", 1)[0]}=${token}`;
    expect((await inspect(f, cookie)).statusCode).toBe(200);
    noWrites();
  });

  async function waitForSourceLock() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) AS count FROM pg_stat_activity WHERE datname=current_database() AND pid <> pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%ayin-upload-recovery-source-lock%'`,
      );
      if (Number(rows[0]?.count) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw Error("Recovery source lock wait was not observed");
  }

  it.each(["source", "revision", "hardExpiry", "authExpiry", "stepUpExpiry"] as const)(
    "rechecks %s after an actual observed source lock wait",
    async (change) => {
      const f = await fixture(change === "stepUpExpiry");
      if (change === "hardExpiry")
        await db.mediaUploadSession.update({
          where: { id: f.sessionId },
          data: { hardExpiresAt: new Date(Date.now() + 1500) },
        });
      if (change === "authExpiry")
        await db.accountSession.updateMany({
          where: { accountId: f.actor.accountId },
          data: { expiresAt: new Date(Date.now() + 1500) },
        });
      let cookie = f.actor.cookie;
      if (change === "stepUpExpiry") {
        const account = await db.account.findUniqueOrThrow({ where: { id: f.actor.accountId } });
        const session = await db.accountSession.findFirstOrThrow({
          where: { accountId: account.id },
        });
        const token = await app
          .get(SessionService)
          .rotate(account.id, session.id, account.authVersion, {
            reauthAt: Math.floor(Date.now() / 1000) - 299,
          });
        cookie = `${cookie.split("=", 1)[0]}=${token}`;
      }
      let locked!: () => void, release!: () => void;
      const entered = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const blocker = db.$transaction(
        async (tx) => {
          await tx.$queryRawUnsafe(
            'SELECT "id" FROM "MediaAsset" WHERE "id"=$1::uuid FOR UPDATE',
            f.assetId,
          );
          locked();
          await hold;
          if (change === "source")
            await tx.mediaAsset.update({
              where: { id: f.assetId },
              data: { removedAt: new Date() },
            });
          if (change === "revision")
            await tx.mediaUploadSession.update({
              where: { id: f.sessionId },
              data: { revision: { increment: 1 } },
            });
        },
        { timeout: 10000 },
      );
      await entered;
      const request = Promise.resolve(inspect(f, cookie));
      try {
        await waitForSourceLock();
        if (!["source", "revision"].includes(change))
          await new Promise((resolve) => setTimeout(resolve, 2200));
      } finally {
        release();
        await blocker;
      }
      const result = await request;
      expect(result.statusCode).toBe(
        ["source", "revision"].includes(change)
          ? 409
          : change === "hardExpiry"
            ? 200
            : change === "authExpiry"
              ? 401
              : 403,
      );
      if (change === "hardExpiry")
        expect(result.json()).toMatchObject({
          expired: true,
          observation: { kind: "NOT_INSPECTED", reason: "EXPIRED" },
        });
      noProvider();
    },
  );

  it("preserves the cleanup address but denies a detached initiating account", async () => {
    const f = await fixture(true),
      other = await register();
    await db.adminRoleAssignment.deleteMany({ where: { accountId: f.actor.accountId } });
    await db.account.delete({ where: { id: f.actor.accountId } });
    const record = await db.mediaUploadSession.findUniqueOrThrow({ where: { id: f.sessionId } });
    expect(record.initiatingAccountId).toBeNull();
    expect(record.objectKey).toBe(f.objectKey);
    expect(record.providerUploadId).toBe("private-persisted-multipart-id");
    expect((await inspect(f, other.cookie, other.accountId)).statusCode).toBe(404);
    noProvider();
  });

  it.each([
    { admin: false, phase: "before provider" },
    { admin: true, phase: "before provider" },
    { admin: false, phase: "after provider" },
    { admin: true, phase: "after provider" },
  ])(
    "bounds source contention and releases authority locks: $phase, admin=$admin",
    async ({ admin, phase }) => {
      const f = await fixture(admin);
      const before = await state(f);
      const authBefore = await db.accountSession.findMany({
        where: { accountId: f.actor.accountId },
        orderBy: { id: "asc" },
      });
      const settingsBefore = await app
        .get(DatabaseService)
        .client.$queryRawUnsafe<Array<{ lock_timeout: string }>>("SHOW lock_timeout");
      let entered!: () => void, release!: () => void;
      const locked = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      let blocker: Promise<void> | undefined;
      let blockerFinished = false;
      const startBlocker = () => {
        blocker = db
          .$transaction(
            async (tx) => {
              await tx.$queryRawUnsafe(
                'SELECT "id" FROM "MediaAsset" WHERE "id"=$1::uuid FOR UPDATE',
                f.assetId,
              );
              entered();
              await hold;
            },
            { timeout: 15000 },
          )
          .finally(() => {
            blockerFinished = true;
          });
      };
      if (phase === "before provider") {
        startBlocker();
        await locked;
      } else {
        vi.mocked(storage.listParts).mockImplementationOnce(async () => {
          startBlocker();
          await locked;
          return [{ partNumber: 1, etag: '"read-only-part"', sizeBytes: partSizeBytes }];
        });
      }
      const request = Promise.resolve(inspect(f));
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await locked;
        await waitForSourceLock();
        // The blocked inspection really holds authority locks before timing out.
        await expect(
          db.$transaction(async (tx) => {
            await tx.$queryRawUnsafe(
              'SELECT "id" FROM "Account" WHERE "id"=$1::uuid FOR UPDATE NOWAIT',
              f.actor.accountId,
            );
          }),
        ).rejects.toThrow();
        const response = await Promise.race([
          request,
          new Promise<null>((resolve) => {
            deadline = setTimeout(() => resolve(null), 5500);
          }),
        ]);
        expect(
          response,
          "inspection must settle while the source blocker remains held",
        ).not.toBeNull();
        expect(response!.statusCode).toBe(503);
        expect(response!.json()).toEqual({
          error: {
            code: "UPLOAD_RECOVERY_BUSY",
            message: "This upload is busy. Check it again shortly.",
          },
        });
        expect(blockerFinished).toBe(false);
        for (const privateValue of [
          f.objectKey,
          "private-persisted-multipart-id",
          "55P03",
          "P2010",
          "SELECT",
          "lock timeout",
        ])
          expect(response!.body).not.toContain(privateValue);

        // NOWAIT proves earlier row locks are released without releasing the source.
        await db.$transaction(async (tx) => {
          if (admin) {
            const [staff] = await tx.$queryRawUnsafe<Array<{ locked: boolean }>>(
              "SELECT pg_try_advisory_xact_lock(1096379721, 1398034002) AS locked",
            );
            expect(staff?.locked).toBe(true);
          }
          await tx.$queryRawUnsafe(
            'SELECT "id" FROM "Account" WHERE "id"=$1::uuid FOR UPDATE NOWAIT',
            f.actor.accountId,
          );
          await tx.$queryRawUnsafe(
            'SELECT "id" FROM "AccountSession" WHERE "accountId"=$1::uuid FOR UPDATE NOWAIT',
            f.actor.accountId,
          );
          if (!admin)
            await tx.$queryRawUnsafe(
              'SELECT "id" FROM "ChannelMember" WHERE "accountId"=$1::uuid AND "channelId"=$2::uuid FOR UPDATE NOWAIT',
              f.actor.accountId,
              f.owner.channelId,
            );
        });
        expect(blockerFinished).toBe(false);
        expect(await state(f)).toEqual(before);
        expect(
          await db.accountSession.findMany({
            where: { accountId: f.actor.accountId },
            orderBy: { id: "asc" },
          }),
        ).toEqual(authBefore);
        expect(await app.get(DatabaseService).client.$queryRawUnsafe("SHOW lock_timeout")).toEqual(
          settingsBefore,
        );
        expect(storage.listParts).toHaveBeenCalledTimes(phase === "before provider" ? 0 : 1);
        expect(storage.headObject).not.toHaveBeenCalled();
        noWrites();
      } finally {
        clearTimeout(deadline);
        release();
        await blocker;
        await request;
      }
      // Recovery is an explicit new read, not an automatic replay of the failed one.
      expect((await inspect(f)).statusCode).toBe(200);
      expect(await state(f)).toEqual(before);
      noWrites();
    },
  );

  it.each([
    { sizeBytes: 0n },
    { sizeBytes: 53687091201n },
    { sizeBytes: 53687091200n, partSizeBytes: 5242880n },
    { partSizeBytes: 0n },
    { mode: "SINGLE" as const },
    { providerUploadId: null },
    { contentIdentityAlgorithm: "SHA256_FILE" },
    { contentIdentityDigest: "a".repeat(63) },
    { contentIdentityDigest: null },
    { revision: 0 },
    { hardExpiresAt: new Date(Date.now() + 86400000 * 2) },
  ])("enforces database recovery contract constraints", async (data) => {
    const f = await fixture(),
      before = await state(f);
    await expect(
      db.mediaUploadSession.update({ where: { id: f.sessionId }, data }),
    ).rejects.toThrow();
    expect(await state(f)).toEqual(before);
    noProvider();
  });

  it("preserves known missing multipart state when final-object metadata remains unavailable", async () => {
    const f = await fixture();
    vi.mocked(storage.listParts).mockRejectedValueOnce(
      new MediaStorageObservationError("NO_SUCH_UPLOAD", "listParts", 404),
    );
    vi.mocked(storage.headObject).mockRejectedValueOnce(new R2HttpError(503, "HEAD"));
    const result = await inspect(f);
    expect(result.statusCode).toBe(200);
    expect(result.json().observation).toEqual({
      kind: "UNAVAILABLE",
      reason: "PROVIDER_ERROR",
      multipartMissing: true,
    });
    noWrites();
  });

  it("rejects unverified missing-upload error provenance", async () => {
    const f = await fixture();
    vi.mocked(storage.listParts).mockRejectedValueOnce(
      new MediaStorageObservationError("NO_SUCH_UPLOAD", "listMultipartUploads", 404),
    );
    expect((await inspect(f)).json().observation).toEqual({
      kind: "UNAVAILABLE",
      reason: "INVALID_RESPONSE",
    });
    expect(storage.headObject).not.toHaveBeenCalled();
    noWrites();
  });

  it("rechecks privileged MFA version when a provider read finishes", async () => {
    const f = await fixture(true);
    f.actor.cookie = (await enrollTestMfa(app, f.actor.cookie)).cookie;
    await db.adminRoleAssignment.updateMany({
      where: { accountId: f.actor.accountId },
      data: { role: "ADMIN" },
    });
    expect((await inspect(f)).statusCode).toBe(200);
    vi.mocked(storage.listParts).mockImplementationOnce(async () => {
      await db.accountMfaCredential.update({
        where: { accountId: f.actor.accountId },
        data: { version: { increment: 1 } },
      });
      return [];
    });
    expect((await inspect(f)).statusCode).toBe(401);
    noWrites();
  });

  it.each(["UTC", "Africa/Cairo", "America/Los_Angeles"])(
    "uses current UTC session expiry under PostgreSQL timezone %s",
    async (zone) => {
      const f = await fixture();
      const original = await db.mediaUploadSession.findUniqueOrThrow({
        where: { id: f.sessionId },
      });
      const { id: oldId, createdAt: oldCreated, updatedAt: oldUpdated, ...data } = original;
      expect(oldId).toBe(f.sessionId);
      expect(oldCreated).toBeInstanceOf(Date);
      expect(oldUpdated).toBeInstanceOf(Date);
      await db.mediaUploadSession.delete({ where: { id: oldId } });
      const recreated = await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${zone}'`);
        const id = randomUUID();
        // Exercise the migration's database default, not Prisma's client clock.
        await tx.$executeRaw(Prisma.sql`INSERT INTO "MediaUploadSession"
          ("id", "sourceAssetId", "initiatingAccountId", "channelId", "videoId", "authority", "mode", "objectKey", "providerUploadId", "sizeBytes", "mimeType", "partSizeBytes", "contentIdentityAlgorithm", "contentIdentityDigest", "state", "updatedAt", "hardExpiresAt")
          VALUES (${id}::uuid, ${data.sourceAssetId}::uuid, ${data.initiatingAccountId}::uuid, ${data.channelId}::uuid, ${data.videoId}::uuid,
            ${data.authority}::"MediaUploadSessionAuthority", ${data.mode}::"MediaUploadSessionMode", ${data.objectKey}, ${data.providerUploadId}, ${data.sizeBytes}, ${data.mimeType}, ${data.partSizeBytes}, ${data.contentIdentityAlgorithm}, ${data.contentIdentityDigest}, ${data.state}::"MediaUploadSessionState", ${new Date()}, ${data.hardExpiresAt})`);
        return tx.mediaUploadSession.findUniqueOrThrow({ where: { id } });
      });
      expect(Math.abs(recreated.createdAt.getTime() - Date.now())).toBeLessThan(5000);
      f.sessionId = recreated.id;
      const connection = new URL(url!);
      connection.searchParams.set("options", `-c timezone=${zone}`);
      await app.close();
      process.env.DATABASE_URL = connection.toString();
      await openApplication();
      try {
        const rows = await app
          .get(DatabaseService)
          .client.$queryRawUnsafe<Array<{ zone: string }>>(
            `SELECT current_setting('TimeZone') AS zone`,
          );
        expect(rows[0]?.zone).toBe(zone);
        expect((await inspect(f)).statusCode).toBe(200);
      } finally {
        await app.close();
        process.env.DATABASE_URL = url;
        await openApplication();
      }
      noWrites();
    },
  );
});
