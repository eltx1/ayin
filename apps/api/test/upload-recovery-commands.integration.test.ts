import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient, Prisma } from "@ayin/db";
import type {
  CreateRecoverableDraftRequest,
  RecoverableUploadSession,
  UploadFileIdentity,
  UploadRecoveryCommandResponse,
} from "@ayin/types";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { SessionService } from "../src/auth/session.service.js";
import {
  DURABLE_UPLOAD_SETTLEMENT,
  UnsupportedDurableUploadSettlement,
  type DurableUploadSettlementEvidence,
} from "../src/media/durable-upload-settlement.js";
import { MediaProcessingLifecycleService } from "../src/media/media-processing-lifecycle.service.js";
import { MediaProcessingStorageService } from "../src/media/media-processing-storage.service.js";
import {
  MEDIA_STORAGE_ADAPTER,
  MEDIA_STORAGE_CONFIG,
  MediaStorageObservationError,
  type ExistingUploadPart,
  type MediaStorageAdapter,
  type StoredObjectMetadata,
  type UploadObjectBinding,
} from "../src/media/media-storage.adapter.js";
import { loadMediaStorageConfig } from "../src/media/media-storage.config.js";
import { MediaUploadService } from "../src/media/media-upload.service.js";
import { UploadSessionTokenService } from "../src/media/upload-session-token.service.js";
import { PlatformSettingsService } from "../src/platform-config/platform-settings.service.js";
import { PrivacyLifecycleService } from "../src/privacy/privacy-lifecycle.service.js";
import { minimizeCompletedUploadCleanup } from "../src/privacy/privacy-media-cleanup.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const partSizeBytes = 5 * 1024 * 1024;
const multipartBytes = 2 * partSizeBytes + 17;
const signedUrl = "https://synthetic.invalid/private-signed-upload";
const providerId = "synthetic-private-provider-id";
const privateEtag = '"synthetic-private-etag"';

// These declarations and provider inventories are entirely synthetic. No media
// file, real provider, real credentials, or environment admission bypass is used.
function identity(sizeBytes: number): UploadFileIdentity {
  return {
    algorithm: "AYIN_SHA256_CHUNKS_V1",
    version: 1,
    sizeBytes,
    chunkSizeBytes: 4 * 1024 * 1024,
    leafCount: Math.ceil(sizeBytes / (4 * 1024 * 1024)),
    rootSha256: "a".repeat(64),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function within<T>(promise: PromiseLike<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 4500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

databaseDescribe("Creator recoverable upload commands", () => {
  const db = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  let evidence: DurableUploadSettlementEvidence | null;
  let probe: ((operation: string, key: string) => Promise<void>) | undefined;
  const allocations = new Map<
    string,
    {
      key: string;
      contentType: string;
      uploadBinding?: UploadObjectBinding;
      parts: ExistingUploadPart[];
    }
  >();
  const objects = new Map<string, StoredObjectMetadata>();
  const trustedSettlement = { admissionEvidence: vi.fn(() => evidence) };
  const storage: MediaStorageAdapter = {
    kind: "r2",
    available: true,
    verifyUploadCleanupSettlement: vi.fn(async () => null),
    createMultipartUpload: vi.fn(),
    authorizeMultipartPart: vi.fn(),
    authorizeSinglePut: vi.fn(),
    listParts: vi.fn(),
    completeMultipartUpload: vi.fn(),
    abortMultipartUpload: vi.fn(),
    headObject: vi.fn(),
    deleteObject: vi.fn(),
    deletePrefix: vi.fn(),
    listMultipartUploads: vi.fn(),
  };

  async function openApplication(withEvidence = true) {
    const builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MEDIA_STORAGE_ADAPTER)
      .useValue(storage)
      .overrideProvider(MEDIA_STORAGE_CONFIG)
      .useValue({
        ...loadMediaStorageConfig({ APP_ENV: "test" }),
        multipartThresholdBytes: partSizeBytes,
        partSizeBytes,
      })
      .overrideProvider(MediaProcessingStorageService)
      .useValue({ headObject: storage.headObject });
    if (withEvidence)
      builder.overrideProvider(DURABLE_UPLOAD_SETTLEMENT).useValue(trustedSettlement);
    const module = await builder.compile();
    const instance = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await instance.init();
    await instance.getHttpAdapter().getInstance().ready();
    return instance;
  }

  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_TOKEN_SECRET = "recovery-commands-test-auth-secret-more-than32";
    process.env.UPLOAD_SESSION_SECRET = "recovery-commands-test-upload-secret-more-than32";
    process.env.WEB_ORIGIN = "http://localhost:3000";
    app = await openApplication();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    for (const operation of Object.values(storage))
      if (vi.isMockFunction(operation)) operation.mockReset();
    delete storage.observeUploadCompletion;
    probe = undefined;
    allocations.clear();
    objects.clear();
    evidence = {
      provider: "r2",
      version: "AYIN_DURABLE_UPLOAD_ADMISSION_V1",
      browserGrantSettlement: {
        conclusion: "NO_LATE_PUT_PART_COMPLETE_OR_ALLOCATION",
        proofReference: "synthetic:test-browser-settlement-v1",
      },
      serverWriteSettlement: {
        conclusion: "NO_LATE_SOURCE_OR_OUTPUT_WRITE",
        proofReference: "synthetic:test-server-settlement-v1",
      },
      verifiedAt: new Date(Date.now() - 1000),
      validUntil: new Date(Date.now() + 3600000),
    };
    vi.mocked(storage.verifyUploadCleanupSettlement!).mockResolvedValue(null);
    vi.mocked(storage.createMultipartUpload).mockImplementation(
      async ({ key, contentType, uploadBinding }) => {
        await probe?.("create", key);
        const uploadId = `${providerId}-${randomUUID()}`;
        allocations.set(uploadId, {
          key,
          contentType,
          ...(uploadBinding ? { uploadBinding } : {}),
          parts: [],
        });
        return { uploadId };
      },
    );
    vi.mocked(storage.authorizeMultipartPart).mockImplementation(
      async ({ key, uploadId, now, expiresInSeconds }) => {
        await probe?.("authorizeMultipart", key);
        expect(allocations.get(uploadId)?.key).toBe(key);
        return {
          url: signedUrl,
          expiresAt: new Date((now?.getTime() ?? Date.now()) + expiresInSeconds * 1000),
        };
      },
    );
    vi.mocked(storage.authorizeSinglePut).mockImplementation(
      async ({ key, now, expiresInSeconds }) => {
        await probe?.("authorizeSingle", key);
        return {
          url: signedUrl,
          expiresAt: new Date((now?.getTime() ?? Date.now()) + expiresInSeconds * 1000),
        };
      },
    );
    vi.mocked(storage.listParts).mockImplementation(async ({ key, uploadId }) => {
      await probe?.("listParts", key);
      const allocation = allocations.get(uploadId);
      if (!allocation || allocation.key !== key)
        throw new MediaStorageObservationError("NO_SUCH_UPLOAD", "listParts", 404);
      return allocation.parts.map((part) => ({ ...part }));
    });
    vi.mocked(storage.completeMultipartUpload).mockImplementation(
      async ({ key, uploadId, parts }) => {
        await probe?.("complete", key);
        const allocation = allocations.get(uploadId);
        if (!allocation || allocation.key !== key) throw Error("Synthetic allocation missing");
        expect(parts).toEqual(
          [...allocation.parts]
            .sort((left, right) => left.partNumber - right.partNumber)
            .map(({ partNumber, etag }) => ({ partNumber, etag })),
        );
        objects.set(key, {
          sizeBytes: allocation.parts.reduce((sum, part) => sum + part.sizeBytes, 0),
          contentType: allocation.contentType,
          ...(allocation.uploadBinding ? { uploadBinding: allocation.uploadBinding } : {}),
          etag: privateEtag,
        });
        allocations.delete(uploadId);
        return { etag: privateEtag };
      },
    );
    vi.mocked(storage.headObject).mockImplementation(async (key) => {
      await probe?.("head", key);
      const object = objects.get(key);
      if (!object) throw Error("Synthetic object missing");
      return object;
    });
    vi.mocked(storage.abortMultipartUpload).mockResolvedValue(undefined);
    vi.mocked(storage.deleteObject).mockResolvedValue(undefined);
    vi.mocked(storage.deletePrefix).mockResolvedValue(undefined);
    vi.mocked(storage.listMultipartUploads).mockResolvedValue([]);
    await db.$executeRawUnsafe(
      'TRUNCATE TABLE "Account", "Channel", "MediaUploadSession", "AccountDeletionRequest", "PrivacyMediaDeletionJob", "MediaProcessingOutputAttempt" CASCADE',
    );
    await db.platformSetting.deleteMany();
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  let registrationAddress = 0;
  async function register() {
    // Independent synthetic creators do not share one burst-limited IP. Keep
    // the real production limiter enabled while the expanded suite grows.
    registrationAddress++;
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      remoteAddress: `198.18.${Math.floor(registrationAddress / 250)}.${(registrationAddress % 250) + 1}`,
      payload: {
        name: "Synthetic recovery creator",
        email: `recovery-command-${randomUUID()}@example.com`,
        password: "strong-pass-123",
      },
    });
    expect(response.statusCode).toBe(201);
    const raw = response.headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(";", 1)[0];
    if (!cookie) throw Error("Actual authenticated fixture cookie missing");
    return {
      cookie,
      accountId: response.json().user.account.id as string,
      channelId: response.json().user.channel.id as string,
    };
  }
  type Actor = Awaited<ReturnType<typeof register>>;
  function draft(actor: Actor, bytes = multipartBytes): CreateRecoverableDraftRequest {
    return {
      requestId: randomUUID(),
      channelId: actor.channelId,
      title: "Synthetic recoverable draft",
      sizeBytes: bytes,
      mimeType: "video/mp4",
      videoForm: "LONG_FORM",
      fileIdentity: identity(bytes),
    };
  }
  function create(actor: Actor, body: unknown = draft(actor), instance = app) {
    return instance.inject({
      method: "POST",
      url: "/creator/videos/recoverable-drafts",
      headers: { cookie: actor.cookie, "x-ayin-expected-account": actor.accountId },
      payload: body as Record<string, unknown>,
    });
  }
  function command(
    actor: Actor,
    sessionId: string,
    name: "resume" | "authorize" | "complete" | "cancel",
    body: unknown,
    instance = app,
  ) {
    return instance.inject({
      method: "POST",
      url: `/media/uploads/sessions/${sessionId}/${name}`,
      headers: { cookie: actor.cookie, "x-ayin-expected-account": actor.accountId },
      payload: body as Record<string, unknown>,
    });
  }
  function success(response: {
    statusCode: number;
    body: string;
    json(): unknown;
  }): UploadRecoveryCommandResponse {
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as UploadRecoveryCommandResponse;
  }
  async function fixture(bytes = multipartBytes) {
    const actor = await register();
    const request = draft(actor, bytes);
    const response = success(await create(actor, request));
    expect(response.session.state).toBe("OPEN");
    return { actor, request, session: response.session };
  }
  async function source(session: RecoverableUploadSession) {
    return db.mediaUploadSession.findUniqueOrThrow({ where: { id: session.sessionId } });
  }
  async function storeParts(session: RecoverableUploadSession) {
    const saved = await source(session);
    const allocation = allocations.get(saved.providerUploadId!);
    if (!allocation) throw Error("Expected synthetic multipart allocation");
    allocation.parts = Array.from({ length: session.partCount }, (_, index) => ({
      partNumber: index + 1,
      etag: `${privateEtag}-${index + 1}`,
      sizeBytes: Math.min(session.partSizeBytes, session.sizeBytes - index * session.partSizeBytes),
    }));
    return saved;
  }
  function request(session: RecoverableUploadSession) {
    return { requestId: randomUUID(), expectedRevision: session.revision };
  }
  async function counts() {
    return {
      videos: await db.video.count(),
      assets: await db.mediaAsset.count(),
      sessions: await db.mediaUploadSession.count(),
      operations: await db.mediaUploadOperation.count(),
      jobs: await db.mediaProcessingJob.count(),
      cleanup: await db.privacyMediaDeletionJob.count(),
    };
  }
  function noProvider() {
    for (const operation of Object.values(storage))
      if (typeof operation === "function") expect(operation).not.toHaveBeenCalled();
  }
  function noProviderMutation() {
    for (const operation of [
      storage.createMultipartUpload,
      storage.authorizeSinglePut,
      storage.authorizeMultipartPart,
      storage.completeMultipartUpload,
      storage.abortMultipartUpload,
      storage.deleteObject,
      storage.deletePrefix,
    ])
      expect(operation).not.toHaveBeenCalled();
  }
  function noPrivateState(body: string, objectKey?: string) {
    for (const value of [
      providerId,
      privateEtag,
      identity(1).rootSha256,
      "sessionToken",
      "creationRequestDigest",
      "grantlessReservationId",
      ...(objectKey ? [objectKey] : []),
    ])
      expect(body).not.toContain(value);
  }
  async function assertNoHeldLocks(actor: Actor, key: string) {
    const session = await db.mediaUploadSession.findFirstOrThrow({ where: { objectKey: key } });
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${actor.accountId}::uuid FOR UPDATE NOWAIT`;
      await tx.$queryRaw`SELECT id FROM "AccountSession" WHERE "accountId"=${actor.accountId}::uuid FOR UPDATE NOWAIT`;
      await tx.$queryRaw`SELECT id FROM "ChannelMember" WHERE "channelId"=${actor.channelId}::uuid FOR UPDATE NOWAIT`;
      await tx.$queryRaw`SELECT id FROM "Channel" WHERE id=${actor.channelId}::uuid FOR UPDATE NOWAIT`;
      await tx.$queryRaw`SELECT id FROM "Video" WHERE id=${session.videoId}::uuid FOR UPDATE NOWAIT`;
      await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${session.sourceAssetId}::uuid FOR UPDATE NOWAIT`;
      await tx.$queryRaw`SELECT id FROM "MediaUploadSession" WHERE id=${session.id}::uuid FOR UPDATE NOWAIT`;
    });
  }
  async function waitForLock(marker: string, minimum = 1) {
    await vi.waitFor(
      async () => {
        const [row] = await db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT count(*)::bigint AS count FROM pg_stat_activity
        WHERE datname=current_database() AND pid <> pg_backend_pid()
          AND wait_event_type='Lock' AND query LIKE ${`%${marker}%`}`);
        expect(Number(row?.count)).toBeGreaterThanOrEqual(minimum);
      },
      { timeout: 2000, interval: 10 },
    );
  }

  it("keeps the shipped settlement provider closed with zero media writes or provider calls", async () => {
    const actor = await register();
    const closedApp = await openApplication(false);
    try {
      expect(closedApp.get(DURABLE_UPLOAD_SETTLEMENT)).toBeInstanceOf(
        UnsupportedDurableUploadSettlement,
      );
      const before = await counts();
      const response = await create(actor, draft(actor), closedApp);
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe("UPLOAD_RECOVERY_UNSUPPORTED");
      expect(await counts()).toEqual(before);
      noProvider();
    } finally {
      await closedApp.close();
    }
  });

  it.each(["authorize", "complete"] as const)(
    "keeps %s behind the default gate even for an existing durable session",
    async (name) => {
      const f = await fixture();
      const closedApp = await openApplication(false);
      vi.clearAllMocks();
      try {
        const before = await source(f.session),
          beforeCounts = await counts();
        const body = { ...request(f.session), ...(name === "authorize" ? { partNumber: 1 } : {}) };
        const response = await command(f.actor, f.session.sessionId, name, body, closedApp);
        expect(response.statusCode).toBe(503);
        expect(await source(f.session)).toEqual(before);
        expect(await counts()).toEqual(beforeCounts);
        noProvider();
      } finally {
        await closedApp.close();
      }
    },
  );

  it("still permits identity recovery and revocation when trusted settlement support disappears", async () => {
    const f = await fixture();
    const closedApp = await openApplication(false);
    vi.clearAllMocks();
    try {
      const resumed = success(
        await command(
          f.actor,
          f.session.sessionId,
          "resume",
          { ...request(f.session), fileIdentity: f.request.fileIdentity },
          closedApp,
        ),
      );
      expect(resumed.session.state).toBe("OPEN");
      expect(resumed.grant).toBeUndefined();
      const cancelled = success(
        await command(f.actor, f.session.sessionId, "cancel", request(resumed.session), closedApp),
      );
      expect(cancelled.session.state).toBe("ABORTED");
      expect(
        await db.privacyMediaDeletionJob.count({ where: { uploadSessionId: f.session.sessionId } }),
      ).toBe(3);
      noProvider();
    } finally {
      await closedApp.close();
    }
  });

  it.each([
    "missing",
    "expired",
    "future",
    "wrong-provider",
    "browser-proof",
    "server-proof",
  ] as const)("rejects %s settlement evidence before reservation", async (change) => {
    const actor = await register();
    if (change === "missing") evidence = null;
    else if (change === "expired") evidence!.validUntil = new Date(Date.now() - 1);
    else if (change === "future") evidence!.verifiedAt = new Date(Date.now() + 60000);
    else if (change === "wrong-provider") evidence!.provider = "development";
    else if (change === "browser-proof") evidence!.browserGrantSettlement.proofReference = "";
    else evidence!.serverWriteSettlement.proofReference = "";
    const before = await counts();
    expect((await create(actor)).statusCode).toBe(503);
    expect(await counts()).toEqual(before);
    noProvider();
  });

  it("opens a single-object draft without storage I/O or issuing a bearer grant", async () => {
    const f = await fixture(1024),
      saved = await source(f.session);
    expect(f.session).toMatchObject({
      protocolVersion: 1,
      actorAccountId: f.actor.accountId,
      channelId: f.actor.channelId,
      mode: "SINGLE",
      sizeBytes: 1024,
      partCount: 1,
    });
    expect(saved).toMatchObject({
      creationRequestId: f.request.requestId,
      state: "OPEN",
      grantReservationCount: 0,
      lastGrantExpiresAt: null,
      providerUploadId: null,
    });
    expect(saved.grantlessReservationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      await db.mediaAsset.findUniqueOrThrow({ where: { id: f.session.assetId! } }),
    ).toMatchObject({ status: "PENDING", uploadIntegrityRequired: true });
    expect(await db.mediaProcessingJob.count()).toBe(0);
    noPrivateState(JSON.stringify(f.session), saved.objectKey);
    noProvider();
  });

  it("coalesces concurrent duplicate creations while allocation is pending and persists the replay across restart", async () => {
    const actor = await register(),
      body = draft(actor),
      entered = deferred(),
      release = deferred();
    const allocate = vi.mocked(storage.createMultipartUpload).getMockImplementation()!;
    vi.mocked(storage.createMultipartUpload).mockImplementationOnce(async (input) => {
      entered.resolve();
      await release.promise;
      return allocate(input);
    });
    const first = Promise.resolve(create(actor, body));
    await within(entered.promise, "Allocation was not dispatched");
    let pending: UploadRecoveryCommandResponse;
    try {
      pending = success(
        await within(create(actor, body), "Duplicate create waited for provider I/O"),
      );
      expect(pending.operation).toMatchObject({
        requestId: body.requestId,
        status: "UNKNOWN",
        replayed: true,
      });
      expect(pending.session.state).toBe("PREPARING");
      expect(await db.mediaUploadSession.count()).toBe(1);
      expect(await db.video.count()).toBe(1);
      expect(await db.mediaAsset.count()).toBe(1);
    } finally {
      release.resolve();
    }
    const created = success(await first);
    expect(created.session.sessionId).toBe(pending!.session.sessionId);
    expect(created.operation.status).toBe("SUCCEEDED");
    await app.close();
    app = await openApplication();
    const replay = success(await create(actor, body));
    expect(replay.session).toEqual(created.session);
    expect(replay.operation).toMatchObject({
      requestId: body.requestId,
      status: "SUCCEEDED",
      replayed: true,
    });
    expect(storage.createMultipartUpload).toHaveBeenCalledTimes(1);
    expect(storage.authorizeMultipartPart).not.toHaveBeenCalled();
    expect(storage.authorizeSinglePut).not.toHaveBeenCalled();
  });

  it.each(["title", "bytes", "identity", "channel"] as const)(
    "rejects a creation request ID reused with changed %s",
    async (change) => {
      const f = await fixture();
      const body = { ...f.request, fileIdentity: { ...f.request.fileIdentity } };
      if (change === "title") body.title = "Different video";
      if (change === "bytes") {
        body.sizeBytes++;
        body.fileIdentity = identity(body.sizeBytes);
      }
      if (change === "identity") body.fileIdentity.rootSha256 = "b".repeat(64);
      if (change === "channel") body.channelId = (await register()).channelId;
      const before = await counts();
      vi.clearAllMocks();
      expect((await create(f.actor, body)).statusCode).toBe(409);
      expect(await counts()).toEqual(before);
      noProvider();
    },
  );

  it.each(["maximum", "clips-disabled", "clips-duration"] as const)(
    "replays an existing creation after the %s setting changes",
    async (change) => {
      const actor = await register(),
        body: CreateRecoverableDraftRequest = {
          ...draft(actor),
          videoForm: "CLIP",
          durationMs: 60000,
        };
      const created = success(await create(actor, body));
      const settings = app.get(PlatformSettingsService),
        get = settings.get.bind(settings);
      vi.spyOn(settings, "get").mockImplementation(async (key) => {
        if (change === "maximum" && key === "uploadMaxSizeBytes") return 1024;
        if (change === "clips-disabled" && key === "clipsEnabled") return false;
        if (change === "clips-duration" && key === "clipsMaxDurationMs") return 15000;
        return get(key);
      });
      vi.clearAllMocks();
      const before = await counts(),
        replay = success(await create(actor, body));
      expect(replay.session).toEqual(created.session);
      expect(replay.operation).toMatchObject({ status: "SUCCEEDED", replayed: true });
      expect(await counts()).toEqual(before);
      noProvider();
    },
  );

  it("serializes quota reservations while an earlier allocation is outside the transaction", async () => {
    const actor = await register(),
      settings = app.get(PlatformSettingsService),
      originalGet = settings.get.bind(settings);
    vi.spyOn(settings, "get").mockImplementation(async (key) =>
      key === "uploadChannelQuotaBytes" ? multipartBytes : originalGet(key),
    );
    const entered = deferred(),
      release = deferred(),
      allocate = vi.mocked(storage.createMultipartUpload).getMockImplementation()!;
    vi.mocked(storage.createMultipartUpload).mockImplementationOnce(async (input) => {
      entered.resolve();
      await release.promise;
      return allocate(input);
    });
    const first = Promise.resolve(create(actor));
    await within(entered.promise, "First quota reservation never reached allocation");
    try {
      const denied = await within(create(actor), "Quota check retained a provider transaction");
      expect(denied.statusCode).toBe(413);
      expect(denied.json().error.code).toBe("CHANNEL_UPLOAD_QUOTA_REACHED");
      expect(await db.mediaUploadSession.count()).toBe(1);
      expect(await db.mediaAsset.count()).toBe(1);
      expect(await db.video.count()).toBe(1);
    } finally {
      release.resolve();
    }
    expect(success(await first).session.state).toBe("OPEN");
    expect(storage.createMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it("serializes competing owners against the same channel quota in PostgreSQL", async () => {
    const firstOwner = await register(),
      secondOwner = await register();
    await db.channelMember.create({
      data: { accountId: secondOwner.accountId, channelId: firstOwner.channelId, role: "OWNER" },
    });
    const settings = app.get(PlatformSettingsService),
      originalGet = settings.get.bind(settings);
    vi.spyOn(settings, "get").mockImplementation(async (key) =>
      key === "uploadChannelQuotaBytes" ? multipartBytes : originalGet(key),
    );
    const entered = deferred(),
      release = deferred();
    const blocker = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(86192044, hashtext(${firstOwner.channelId}))`;
        entered.resolve();
        await release.promise;
      },
      { timeout: 10000 },
    );
    await entered.promise;
    const requests = [
      Promise.resolve(create(firstOwner)),
      Promise.resolve(
        create(secondOwner, { ...draft(secondOwner), channelId: firstOwner.channelId }),
      ),
    ];
    try {
      await waitForLock("pg_advisory_xact_lock(86192044", 2);
      expect(await db.mediaUploadSession.count()).toBe(0);
    } finally {
      release.resolve();
      await blocker;
    }
    const responses = await Promise.all(requests);
    expect(responses.map((item) => item.statusCode).sort()).toEqual([201, 413]);
    expect(await db.mediaUploadSession.count()).toBe(1);
    expect(await db.mediaAsset.count()).toBe(1);
    expect(storage.createMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it("does not replay a multipart allocation whose provider response was lost", async () => {
    const actor = await register(),
      body = draft(actor),
      allocate = vi.mocked(storage.createMultipartUpload).getMockImplementation()!;
    vi.mocked(storage.createMultipartUpload).mockImplementationOnce(async (input) => {
      await allocate(input);
      throw Error("synthetic allocation response lost");
    });
    const first = await create(actor, body);
    const saved = await db.mediaUploadSession.findFirstOrThrow({
      where: { creationRequestId: body.requestId },
    });
    expect(saved.state).toBe("UNRESOLVED");
    expect(allocations.size).toBe(1);
    const replay = success(await create(actor, body));
    expect(replay.session.sessionId).toBe(saved.id);
    expect(replay.operation).toMatchObject({ status: "UNKNOWN", replayed: true });
    expect(
      await db.mediaUploadOperation.findFirstOrThrow({
        where: { sessionId: saved.id, requestId: body.requestId },
      }),
    ).toMatchObject({ status: "UNKNOWN", dispatchStartedAt: expect.any(Date) });
    expect(storage.createMultipartUpload).toHaveBeenCalledTimes(1);
    expect(storage.authorizeMultipartPart).not.toHaveBeenCalled();
    expect(first.body).not.toContain("synthetic allocation response lost");
    noPrivateState(JSON.stringify(replay), saved.objectKey);
  });

  it("lets privacy revoke and snapshot a PREPARING reservation during allocation without resurrection", async () => {
    const actor = await register(),
      body = draft(actor),
      entered = deferred(),
      release = deferred();
    const allocate = vi.mocked(storage.createMultipartUpload).getMockImplementation()!;
    vi.mocked(storage.createMultipartUpload).mockImplementationOnce(async (input) => {
      entered.resolve();
      await release.promise;
      return allocate(input);
    });
    const creating = Promise.resolve(create(actor, body));
    await within(entered.promise, "Allocation was not dispatched");
    let deletionId: string;
    try {
      await db.account.update({
        where: { id: actor.accountId },
        data: { status: "CLOSED", closedAt: new Date() },
      });
      const deletion = await db.accountDeletionRequest.create({
        data: {
          accountId: actor.accountId,
          state: "DEACTIVATED",
          deactivatedAt: new Date(Date.now() - 25 * 3600000),
        },
      });
      deletionId = deletion.id;
      expect(
        await within(
          app.get(PrivacyLifecycleService).advanceDue(new Date(), 1),
          "Privacy waited on provider-held database locks",
        ),
      ).toBe(1);
    } finally {
      release.resolve();
    }
    const response = await creating;
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.body).not.toContain(signedUrl);
    const saved = await db.mediaUploadSession.findFirstOrThrow({
      where: { creationRequestId: body.requestId },
    });
    expect(saved.state).toBe("REVOKED");
    expect(saved.grantsRevokedAt).not.toBeNull();
    expect(
      await db.mediaAsset.findUniqueOrThrow({ where: { id: saved.sourceAssetId! } }),
    ).toMatchObject({ status: "REMOVED", removedAt: expect.any(Date) });
    const debt = await db.privacyMediaDeletionJob.findMany({
      where: { uploadSessionId: saved.id },
    });
    expect(debt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId: deletionId!,
          kind: "OBJECT",
          target: saved.objectKey,
        }),
        expect.objectContaining({
          requestId: deletionId!,
          kind: "ALLOCATION",
          target: saved.objectKey,
        }),
      ]),
    );
    expect(await db.mediaProcessingJob.count()).toBe(0);
    expect(storage.authorizeMultipartPart).not.toHaveBeenCalled();
    expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it("runs allocation, signing, inventory, completion and metadata I/O with every authority/source lock released", async () => {
    const actor = await register(),
      seen: string[] = [];
    probe = async (operation, key) => {
      await assertNoHeldLocks(actor, key);
      seen.push(operation);
    };
    const created = success(await create(actor));
    const grant = success(
      await command(actor, created.session.sessionId, "authorize", {
        ...request(created.session),
        partNumber: 1,
      }),
    );
    await storeParts(grant.session);
    const completed = success(
      await command(actor, grant.session.sessionId, "complete", request(grant.session)),
    );
    expect(completed.session.state).toBe("COMPLETED");
    expect(seen).toEqual(
      expect.arrayContaining(["create", "authorizeMultipart", "listParts", "complete", "head"]),
    );
  });

  it("resumes only an identical declaration without creating or signing another upload", async () => {
    const f = await fixture(),
      before = await source(f.session);
    vi.clearAllMocks();
    const body = { ...request(f.session), fileIdentity: f.request.fileIdentity };
    const resumed = success(await command(f.actor, f.session.sessionId, "resume", body));
    expect(resumed.session.sessionId).toBe(f.session.sessionId);
    expect(resumed.session.assetId).toBe(f.session.assetId);
    expect(resumed.session.videoId).toBe(f.session.videoId);
    expect(resumed.session.expiresAt).toBe(before.hardExpiresAt.toISOString());
    expect(resumed.grant).toBeUndefined();
    const replay = success(await command(f.actor, f.session.sessionId, "resume", body));
    expect(replay.operation.replayed).toBe(true);
    expect(replay.session).toEqual(resumed.session);
    noProviderMutation();
  });

  it("rejects a different local file identity before changing the session or contacting storage", async () => {
    const f = await fixture(),
      before = await source(f.session);
    vi.clearAllMocks();
    const response = await command(f.actor, f.session.sessionId, "resume", {
      ...request(f.session),
      fileIdentity: { ...f.request.fileIdentity, rootSha256: "b".repeat(64) },
    });
    expect(response.statusCode).toBe(409);
    expect(await source(f.session)).toEqual(before);
    noProvider();
  });

  async function interruptedSingle() {
    const f = await fixture(1024);
    await db.$transaction(async (tx) => {
      await tx.mediaUploadSession.update({
        where: { id: f.session.sessionId },
        data: { state: "PREPARING", revision: 1 },
      });
      await tx.mediaUploadOperation.updateMany({
        where: { sessionId: f.session.sessionId, kind: "CREATE" },
        data: { status: "RESERVED", dispatchStartedAt: null },
      });
    });
    return { ...f, session: { ...f.session, state: "PREPARING" as const, revision: 1 } };
  }

  it("recovers an interrupted single reservation only with its server witness and undispatched creation journal", async () => {
    const f = await interruptedSingle();
    vi.clearAllMocks();
    const body = { ...request(f.session), fileIdentity: f.request.fileIdentity };
    const resumed = success(await command(f.actor, f.session.sessionId, "resume", body));
    expect(resumed.session).toMatchObject({
      state: "OPEN",
      revision: 2,
      assetId: f.session.assetId,
      videoId: f.session.videoId,
    });
    expect(resumed.grant).toBeUndefined();
    expect(
      await db.mediaUploadOperation.findFirstOrThrow({
        where: { sessionId: f.session.sessionId, kind: "CREATE" },
      }),
    ).toMatchObject({ status: "SUCCEEDED", dispatchStartedAt: null });
    expect(
      success(await command(f.actor, f.session.sessionId, "resume", body)).operation.replayed,
    ).toBe(true);
    expect(await db.mediaAsset.count()).toBe(1);
    noProvider();
  });

  it.each(["no-witness", "dispatched", "grant-reserved", "grant-expiry"] as const)(
    "refuses interrupted single recovery with %s",
    async (change) => {
      const f = await interruptedSingle();
      if (change === "no-witness")
        await db.mediaUploadSession.update({
          where: { id: f.session.sessionId },
          data: {
            creationRequestId: null,
            creationRequestDigest: null,
            grantlessReservationId: null,
          },
        });
      if (change === "dispatched")
        await db.mediaUploadOperation.updateMany({
          where: { sessionId: f.session.sessionId, kind: "CREATE" },
          data: { status: "DISPATCHED", dispatchStartedAt: new Date() },
        });
      if (change === "grant-reserved")
        await db.mediaUploadSession.update({
          where: { id: f.session.sessionId },
          data: { grantReservationCount: 1, lastGrantExpiresAt: new Date(Date.now() + 60000) },
        });
      if (change === "grant-expiry")
        await db.mediaUploadSession.update({
          where: { id: f.session.sessionId },
          data: { lastGrantExpiresAt: new Date(Date.now() + 60000) },
        });
      vi.clearAllMocks();
      const before = await source(f.session),
        beforeCounts = await counts();
      const result = await command(f.actor, f.session.sessionId, "resume", {
        ...request(f.session),
        fileIdentity: f.request.fileIdentity,
      });
      expect(result.statusCode).toBe(change === "no-witness" ? 404 : 409);
      expect(await source(f.session)).toEqual(before);
      expect(await counts()).toEqual(beforeCounts);
      noProvider();
    },
  );

  it.each([1024, multipartBytes])(
    "issues one %i-byte authorization and never returns or renews its grant on duplicate delivery",
    async (bytes) => {
      const f = await fixture(bytes),
        body = { ...request(f.session), partNumber: 1 };
      const authorized = success(await command(f.actor, f.session.sessionId, "authorize", body));
      expect(authorized.grant).toMatchObject({ url: signedUrl, method: "PUT", partNumber: 1 });
      const saved = await source(f.session);
      expect(saved.grantReservationCount).toBe(1);
      expect(saved.lastGrantExpiresAt).toBeInstanceOf(Date);
      expect(saved.lastGrantExpiresAt!.getTime()).toBeLessThanOrEqual(
        saved.hardExpiresAt.getTime(),
      );
      const replay = success(await command(f.actor, f.session.sessionId, "authorize", body));
      expect(replay.operation).toMatchObject({ status: "SUCCEEDED", replayed: true });
      expect(replay.grant).toBeUndefined();
      expect(await source(f.session)).toEqual(saved);
      expect(
        bytes === 1024 ? storage.authorizeSinglePut : storage.authorizeMultipartPart,
      ).toHaveBeenCalledTimes(1);
      noPrivateState(JSON.stringify(replay), saved.objectKey);
      const operations = await db.mediaUploadOperation.findMany({ where: { sessionId: saved.id } });
      expect(JSON.stringify(operations)).not.toContain(signedUrl);
    },
  );

  it("rejects altered authorization replay and stale revisions without resigning", async () => {
    const f = await fixture(),
      body = { ...request(f.session), partNumber: 1 };
    success(await command(f.actor, f.session.sessionId, "authorize", body));
    const before = await source(f.session);
    vi.clearAllMocks();
    expect(
      (await command(f.actor, f.session.sessionId, "authorize", { ...body, partNumber: 2 }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await command(f.actor, f.session.sessionId, "authorize", {
          ...body,
          expectedRevision: body.expectedRevision + 1,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await command(f.actor, f.session.sessionId, "authorize", {
          ...body,
          requestId: randomUUID(),
          expectedRevision: body.expectedRevision - 1,
        })
      ).statusCode,
    ).toBe(409);
    expect(await source(f.session)).toEqual(before);
    noProvider();
  });

  it("keeps a lost authorization response journaled and never renews that request", async () => {
    const f = await fixture(),
      body = { ...request(f.session), partNumber: 1 };
    const sign = vi.mocked(storage.authorizeMultipartPart).getMockImplementation()!;
    vi.mocked(storage.authorizeMultipartPart).mockImplementationOnce(async (input) => {
      await sign(input);
      throw Error("synthetic signer response lost");
    });
    const first = success(await command(f.actor, f.session.sessionId, "authorize", body));
    expect(first.operation.status).toBe("UNKNOWN");
    expect(first.grant).toBeUndefined();
    const saved = await source(f.session);
    expect(saved).toMatchObject({
      state: "UNRESOLVED",
      grantReservationCount: 1,
      lastGrantExpiresAt: expect.any(Date),
    });
    const replay = success(await command(f.actor, f.session.sessionId, "authorize", body));
    expect(replay.operation).toMatchObject({ status: "UNKNOWN", replayed: true });
    expect(replay.grant).toBeUndefined();
    expect(storage.authorizeMultipartPart).toHaveBeenCalledTimes(1);
    expect(await source(f.session)).toEqual(saved);
  });

  it("completes from the provider's exact observed parts and queues immutable input integrity atomically", async () => {
    const f = await fixture(),
      saved = await storeParts(f.session);
    const lifecycle = app.get(MediaProcessingLifecycleService),
      enqueue = lifecycle.enqueueUploadedAssetInTransaction.bind(lifecycle);
    const checked = vi
      .spyOn(lifecycle, "enqueueUploadedAssetInTransaction")
      .mockImplementation(async (tx, assetId) => {
        expect(await tx.mediaAsset.findUniqueOrThrow({ where: { id: assetId } })).toMatchObject({
          status: "UPLOADED",
          uploadIntegrityRequired: true,
        });
        expect(
          await tx.mediaUploadSession.findUniqueOrThrow({ where: { sourceAssetId: assetId } }),
        ).toMatchObject({ state: "COMPLETED" });
        return enqueue(tx, assetId);
      });
    const body = request(f.session),
      response = await command(f.actor, f.session.sessionId, "complete", body),
      completed = success(response);
    expect(completed.session.state).toBe("COMPLETED");
    expect(checked).toHaveBeenCalledTimes(1);
    expect(storage.listParts).toHaveBeenCalledTimes(1);
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
    expect(
      await db.mediaProcessingJob.findFirstOrThrow({ where: { videoId: f.session.videoId! } }),
    ).toMatchObject({
      status: "INTEGRITY_QUEUED",
      inputIntegrityVersion: 1,
      inputIntegritySessionId: f.session.sessionId,
      inputIntegritySourceAssetId: f.session.assetId,
      inputIntegrityAccountId: f.actor.accountId,
      inputIntegrityDigest: f.request.fileIdentity.rootSha256,
      inputR2ObjectKey: saved.objectKey,
    });
    expect(await db.video.findUniqueOrThrow({ where: { id: f.session.videoId! } })).toMatchObject({
      status: "VALIDATING",
    });
    const replay = success(await command(f.actor, f.session.sessionId, "complete", body));
    expect(replay.operation.replayed).toBe(true);
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
    expect(await db.mediaProcessingJob.count()).toBe(1);
    noPrivateState(response.body, saved.objectKey);
  });

  it("completes single-object transfers only after matching metadata without multipart calls", async () => {
    const f = await fixture(1024),
      saved = await source(f.session);
    objects.set(saved.objectKey, { sizeBytes: 1024, contentType: "video/mp4", etag: privateEtag });
    const completed = success(
      await command(f.actor, f.session.sessionId, "complete", request(f.session)),
    );
    expect(completed.session.state).toBe("COMPLETED");
    expect(storage.headObject).toHaveBeenCalledTimes(1);
    expect(storage.listParts).not.toHaveBeenCalled();
    expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
    expect((await db.mediaProcessingJob.findFirstOrThrow()).status).toBe("INTEGRITY_QUEUED");
  });

  it("replays accepted completion after staging removal and hard expiry without redispatching", async () => {
    const f = await fixture();
    await storeParts(f.session);
    const body = request(f.session);
    success(await command(f.actor, f.session.sessionId, "complete", body));
    await db.mediaAsset.update({
      where: { id: f.session.assetId! },
      data: { status: "REMOVED", removedAt: new Date() },
    });
    await db.mediaUploadSession.update({
      where: { id: f.session.sessionId },
      data: {
        createdAt: new Date(Date.now() - 7200000),
        hardExpiresAt: new Date(Date.now() - 1000),
      },
    });
    vi.clearAllMocks();
    const before = await source(f.session),
      beforeCounts = await counts();
    const replay = success(await command(f.actor, f.session.sessionId, "complete", body));
    expect(replay.operation).toMatchObject({
      requestId: body.requestId,
      status: "SUCCEEDED",
      replayed: true,
    });
    expect(replay.session.state).toBe("COMPLETED");
    expect(await source(f.session)).toEqual(before);
    expect(await counts()).toEqual(beforeCounts);
    noProvider();
  });

  it.each(["size", "mime"] as const)(
    "quarantines mismatched single-object %s without accepting or enqueueing media",
    async (change) => {
      const f = await fixture(1024),
        saved = await source(f.session);
      objects.set(saved.objectKey, {
        sizeBytes: change === "size" ? 1025 : 1024,
        contentType: change === "mime" ? "video/webm" : "video/mp4",
        etag: privateEtag,
      });
      const body = request(f.session);
      const result = success(await command(f.actor, f.session.sessionId, "complete", body));
      expect(result.operation.status).toBe("UNKNOWN");
      expect(result.session.state).toBe("UNRESOLVED");
      expect(
        (await db.mediaAsset.findUniqueOrThrow({ where: { id: f.session.assetId! } })).status,
      ).toBe("PENDING");
      expect(await db.mediaProcessingJob.count()).toBe(0);
      success(await command(f.actor, f.session.sessionId, "complete", body));
      expect(storage.headObject).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["missing", "duplicate", "wrong-size", "extra"] as const)(
    "rejects %s provider parts without dispatching completion",
    async (change) => {
      const f = await fixture(),
        saved = await storeParts(f.session),
        allocation = allocations.get(saved.providerUploadId!)!;
      if (change === "missing") allocation.parts.pop();
      if (change === "duplicate") allocation.parts[2] = { ...allocation.parts[0]! };
      if (change === "wrong-size") allocation.parts[2]!.sizeBytes++;
      if (change === "extra")
        allocation.parts.push({ partNumber: 4, etag: privateEtag, sizeBytes: 1 });
      const response = await command(f.actor, f.session.sessionId, "complete", request(f.session));
      expect(success(response).operation.status).toBe("UNKNOWN");
      expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
      expect((await source(f.session)).state).not.toBe("COMPLETED");
      expect(
        (await db.mediaAsset.findUniqueOrThrow({ where: { id: f.session.assetId! } })).status,
      ).toBe("PENDING");
      expect(await db.mediaProcessingJob.count()).toBe(0);
    },
  );

  it("never retries an ambiguous provider completion even if an object now exists", async () => {
    const f = await fixture(),
      saved = await storeParts(f.session),
      complete = vi.mocked(storage.completeMultipartUpload).getMockImplementation()!;
    vi.mocked(storage.completeMultipartUpload).mockImplementationOnce(async (input) => {
      await complete(input);
      throw Error("synthetic completion response lost");
    });
    const body = request(f.session),
      first = await command(f.actor, f.session.sessionId, "complete", body);
    expect(objects.has(saved.objectKey)).toBe(true);
    expect((await source(f.session)).state).toBe("UNRESOLVED");
    const replay = success(await command(f.actor, f.session.sessionId, "complete", body));
    expect(replay.operation).toMatchObject({ status: "UNKNOWN", replayed: true });
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
    expect(await db.mediaProcessingJob.count()).toBe(0);
    expect(
      await db.mediaUploadOperation.findFirstOrThrow({
        where: { sessionId: saved.id, requestId: body.requestId },
      }),
    ).toMatchObject({ status: "UNKNOWN", dispatchStartedAt: expect.any(Date) });
    expect(first.body).not.toContain("synthetic completion response lost");
  });

  function enableBoundObservation() {
    storage.observeUploadCompletion = vi.fn<
      NonNullable<MediaStorageAdapter["observeUploadCompletion"]>
    >(async ({ key, uploadId, expected }) => {
      await probe?.("observeCompletion", key);
      if (uploadId && allocations.has(uploadId)) return { status: "MULTIPART_PRESENT" };
      const object = objects.get(key);
      if (!object) return { status: "OBJECT_ABSENT" };
      const binding = object.uploadBinding;
      if (
        !binding ||
        !object.etag ||
        object.sizeBytes !== expected.sizeBytes ||
        object.contentType !== expected.contentType ||
        binding.sessionId !== expected.binding.sessionId ||
        binding.sourceAssetId !== expected.binding.sourceAssetId ||
        binding.contentIdentityDigest !== expected.binding.contentIdentityDigest
      )
        return { status: "OBJECT_MISMATCH" };
      return {
        status: "OBJECT_VERIFIED",
        metadata: { ...object, etag: object.etag, uploadBinding: binding },
      };
    });
  }
  function reconcile(
    actor: Actor,
    sessionId: string,
    requestId: string,
    expectedRevision: number,
    instance = app,
  ) {
    return instance.inject({
      method: "POST",
      url: `/media/uploads/sessions/${sessionId}/operations/${requestId}/reconcile`,
      headers: { cookie: actor.cookie, "x-ayin-expected-account": actor.accountId },
      payload: { expectedRevision },
    });
  }
  async function lostCompletion(bytes = multipartBytes) {
    const f = await fixture(bytes);
    const saved = await source(f.session);
    const body = request(f.session);
    if (bytes === multipartBytes) {
      await storeParts(f.session);
      const complete = vi.mocked(storage.completeMultipartUpload).getMockImplementation()!;
      vi.mocked(storage.completeMultipartUpload).mockImplementationOnce(async (input) => {
        await complete(input);
        throw Error("synthetic provider response lost after storage");
      });
    } else {
      objects.set(saved.objectKey, {
        sizeBytes: bytes,
        contentType: saved.mimeType,
        etag: privateEtag,
        uploadBinding: {
          sessionId: saved.id,
          sourceAssetId: saved.sourceAssetId!,
          contentIdentityDigest: saved.contentIdentityDigest!,
        },
      });
      vi.mocked(storage.headObject).mockRejectedValueOnce(Error("synthetic HEAD response lost"));
    }
    expect(
      success(await command(f.actor, f.session.sessionId, "complete", body)).operation.status,
    ).toBe("UNKNOWN");
    enableBoundObservation();
    const unknown = await source(f.session);
    vi.clearAllMocks();
    return { ...f, body, saved: unknown };
  }

  it.each([1024, multipartBytes])(
    "reconciles a lost %i-byte completion from bound provider evidence, without redispatch or premature publication",
    async (bytes) => {
      const f = await lostCompletion(bytes);
      probe = async (operation, key) => {
        if (operation === "observeCompletion") await assertNoHeldLocks(f.actor, key);
      };
      const result = await reconcile(f.actor, f.saved.id, f.body.requestId, f.saved.revision);
      expect(result.headers["cache-control"]).toBe("private, no-store");
      expect(success(result)).toMatchObject({
        session: { state: "COMPLETED" },
        operation: { requestId: f.body.requestId, status: "SUCCEEDED", replayed: true },
      });
      expect(await db.mediaProcessingJob.count()).toBe(1);
      expect(await db.mediaProcessingJob.findFirstOrThrow()).toMatchObject({
        status: "INTEGRITY_QUEUED",
        inputIntegrityDigest: f.request.fileIdentity.rootSha256,
      });
      expect(await db.video.findUniqueOrThrow({ where: { id: f.session.videoId! } })).toMatchObject(
        { status: "VALIDATING" },
      );
      expect(storage.observeUploadCompletion).toHaveBeenCalledOnce();
      noProviderMutation();
      noPrivateState(result.body, f.saved.objectKey);
      const repeat = await reconcile(f.actor, f.saved.id, f.body.requestId, f.saved.revision);
      expect(success(repeat).operation.status).toBe("SUCCEEDED");
      expect(storage.observeUploadCompletion).toHaveBeenCalledOnce();
      expect(await db.mediaProcessingJob.count()).toBe(1);
    },
  );

  it.each([
    "absent",
    "size",
    "mime",
    "session",
    "source",
    "digest",
    "no-binding",
    "etag",
    "active",
    "provider-error",
  ] as const)(
    "leaves %s provider evidence unresolved with reservation and journal intact",
    async (kind) => {
      const f = await lostCompletion();
      const object = objects.get(f.saved.objectKey)!;
      if (kind === "absent") objects.delete(f.saved.objectKey);
      if (kind === "size") object.sizeBytes++;
      if (kind === "mime") object.contentType = "video/webm";
      if (kind === "session") object.uploadBinding!.sessionId = randomUUID();
      if (kind === "source") object.uploadBinding!.sourceAssetId = randomUUID();
      if (kind === "digest") object.uploadBinding!.contentIdentityDigest = "b".repeat(64);
      if (kind === "no-binding") delete object.uploadBinding;
      if (kind === "etag") object.etag = null;
      if (kind === "active")
        allocations.set(f.saved.providerUploadId!, {
          key: f.saved.objectKey,
          contentType: "video/mp4",
          parts: [],
        });
      if (kind === "provider-error")
        vi.mocked(storage.observeUploadCompletion!).mockRejectedValueOnce(
          Error("private provider failure"),
        );
      const before = await counts();
      const result = await reconcile(f.actor, f.saved.id, f.body.requestId, f.saved.revision);
      expect(success(result).operation).toMatchObject({ status: "UNKNOWN", replayed: true });
      expect(await source(f.session)).toEqual(f.saved);
      expect(await counts()).toEqual(before);
      expect(result.body).not.toContain("private provider failure");
      noProviderMutation();
    },
  );

  it.each(["owner", "login", "cancel", "expiry", "gate", "source"] as const)(
    "rechecks %s after provider observation and cannot resurrect the source",
    async (change) => {
      const f = await lostCompletion();
      probe = async (operation) => {
        if (operation !== "observeCompletion") return;
        if (change === "owner")
          await db.channelMember.deleteMany({
            where: { accountId: f.actor.accountId, channelId: f.actor.channelId },
          });
        if (change === "login")
          await db.accountSession.updateMany({
            where: { accountId: f.actor.accountId },
            data: { revokedAt: new Date() },
          });
        if (change === "cancel")
          success(
            await command(
              f.actor,
              f.saved.id,
              "cancel",
              request({ ...f.session, revision: f.saved.revision }),
            ),
          );
        if (change === "expiry")
          await db.mediaUploadSession.update({
            where: { id: f.saved.id },
            data: { hardExpiresAt: new Date(Date.now() - 1) },
          });
        if (change === "gate") evidence = null;
        if (change === "source")
          await db.mediaAsset.update({
            where: { id: f.saved.sourceAssetId! },
            data: { removedAt: new Date() },
          });
      };
      const result = await reconcile(f.actor, f.saved.id, f.body.requestId, f.saved.revision);
      expect(result.statusCode).toBe(
        change === "owner"
          ? 403
          : change === "login"
            ? 401
            : change === "expiry"
              ? 410
              : change === "gate"
                ? 503
                : 409,
      );
      expect(await db.mediaProcessingJob.count()).toBe(0);
      expect((await source(f.session)).state).not.toBe("COMPLETED");
      noProviderMutation();
    },
  );

  it("coalesces concurrent reconciliation into one integrity enqueue", async () => {
    const f = await lostCompletion();
    const entered = deferred(),
      release = deferred();
    let observed = 0;
    probe = async (operation) => {
      if (operation !== "observeCompletion") return;
      if (++observed === 2) entered.resolve();
      await release.promise;
    };
    const first = Promise.resolve(
      reconcile(f.actor, f.saved.id, f.body.requestId, f.saved.revision),
    );
    const second = Promise.resolve(
      reconcile(f.actor, f.saved.id, f.body.requestId, f.saved.revision),
    );
    await within(entered.promise, "Concurrent observations did not run");
    release.resolve();
    expect(success(await first).operation.status).toBe("SUCCEEDED");
    expect(success(await second).operation.status).toBe("SUCCEEDED");
    expect(await db.mediaProcessingJob.count()).toBe(1);
    noProviderMutation();
  });

  it.each(["success", "lost-response"] as const)(
    "reconciles DISPATCHED/FINALIZING before the original COMPLETE returns %s",
    async (outcome) => {
      const f = await fixture();
      await storeParts(f.session);
      enableBoundObservation();
      const complete = vi.mocked(storage.completeMultipartUpload).getMockImplementation()!;
      const stored = deferred(),
        release = deferred();
      vi.mocked(storage.completeMultipartUpload).mockImplementationOnce(async (input) => {
        const result = await complete(input);
        stored.resolve();
        await release.promise;
        if (outcome === "lost-response") throw Error("synthetic delayed response lost");
        return result;
      });
      const body = request(f.session);
      const original = Promise.resolve(command(f.actor, f.session.sessionId, "complete", body));
      await within(stored.promise, "Original completion did not store its object");
      try {
        const finalizing = await source(f.session);
        expect(finalizing.state).toBe("FINALIZING");
        expect(
          success(await reconcile(f.actor, finalizing.id, body.requestId, finalizing.revision))
            .operation.status,
        ).toBe("SUCCEEDED");
      } finally {
        release.resolve();
      }
      expect(success(await original).operation.status).toBe("SUCCEEDED");
      expect((await source(f.session)).state).toBe("COMPLETED");
      expect(await db.mediaProcessingJob.count()).toBe(1);
      expect(storage.completeMultipartUpload).toHaveBeenCalledOnce();
    },
  );

  it("requires a fresh revision when original UNKNOWN wins during reconciliation observation", async () => {
    const f = await fixture();
    await storeParts(f.session);
    enableBoundObservation();
    const complete = vi.mocked(storage.completeMultipartUpload).getMockImplementation()!;
    const stored = deferred(),
      releaseOriginal = deferred(),
      observing = deferred(),
      releaseObservation = deferred();
    vi.mocked(storage.completeMultipartUpload).mockImplementationOnce(async (input) => {
      await complete(input);
      stored.resolve();
      await releaseOriginal.promise;
      throw Error("synthetic response lost");
    });
    const body = request(f.session);
    const original = Promise.resolve(command(f.actor, f.session.sessionId, "complete", body));
    await within(stored.promise, "Original completion did not store");
    const finalizing = await source(f.session);
    probe = async (operation) => {
      if (operation !== "observeCompletion") return;
      observing.resolve();
      await releaseObservation.promise;
    };
    const reconciliation = Promise.resolve(
      reconcile(f.actor, finalizing.id, body.requestId, finalizing.revision),
    );
    await within(observing.promise, "Reconciliation did not observe");
    releaseOriginal.resolve();
    expect(success(await original).operation.status).toBe("UNKNOWN");
    releaseObservation.resolve();
    expect((await reconciliation).statusCode).toBe(409);
    expect(await db.mediaProcessingJob.count()).toBe(0);
    const unknown = await source(f.session);
    expect(unknown.state).toBe("UNRESOLVED");
    expect(
      success(await reconcile(f.actor, unknown.id, body.requestId, unknown.revision)).operation
        .status,
    ).toBe("SUCCEEDED");
    expect(await db.mediaProcessingJob.count()).toBe(1);
    expect(storage.completeMultipartUpload).toHaveBeenCalledOnce();
  });

  it("rolls back reconciliation when enqueue fails, and permits another explicit observation", async () => {
    const f = await lostCompletion();
    const lifecycle = app.get(MediaProcessingLifecycleService);
    vi.spyOn(lifecycle, "enqueueUploadedAssetInTransaction").mockRejectedValueOnce(
      Error("synthetic enqueue failure"),
    );
    expect(
      (await reconcile(f.actor, f.saved.id, f.body.requestId, f.saved.revision)).statusCode,
    ).toBe(500);
    expect(await source(f.session)).toEqual(f.saved);
    expect(await db.mediaProcessingJob.count()).toBe(0);
    expect(
      success(await reconcile(f.actor, f.saved.id, f.body.requestId, f.saved.revision)).operation
        .status,
    ).toBe("SUCCEEDED");
    expect(await db.mediaProcessingJob.count()).toBe(1);
    noProviderMutation();
  });

  it("rejects stale revision, wrong operation, foreign owner and disabled provider before storage observation", async () => {
    const f = await lostCompletion();
    const other = await register();
    expect(
      (await reconcile(f.actor, f.saved.id, f.body.requestId, f.saved.revision - 1)).statusCode,
    ).toBe(409);
    expect(
      (await reconcile(f.actor, f.saved.id, f.request.requestId, f.saved.revision)).statusCode,
    ).toBe(404);
    expect(
      (await reconcile(other, f.saved.id, f.body.requestId, f.saved.revision)).statusCode,
    ).toBe(404);
    expect((await reconcile(f.actor, f.saved.id, randomUUID(), f.saved.revision)).statusCode).toBe(
      404,
    );
    evidence = null;
    expect(
      (await reconcile(f.actor, f.saved.id, f.body.requestId, f.saved.revision)).statusCode,
    ).toBe(503);
    noProvider();
  });

  it("coalesces concurrent completion requests during provider dispatch", async () => {
    const f = await fixture();
    await storeParts(f.session);
    const entered = deferred(),
      release = deferred(),
      complete = vi.mocked(storage.completeMultipartUpload).getMockImplementation()!;
    vi.mocked(storage.completeMultipartUpload).mockImplementationOnce(async (input) => {
      entered.resolve();
      await release.promise;
      return complete(input);
    });
    const body = request(f.session),
      first = Promise.resolve(command(f.actor, f.session.sessionId, "complete", body));
    await within(entered.promise, "Completion never dispatched");
    try {
      const pending = success(
        await within(
          command(f.actor, f.session.sessionId, "complete", body),
          "Duplicate completion waited on provider I/O",
        ),
      );
      expect(pending.operation).toMatchObject({ status: "UNKNOWN", replayed: true });
      expect(pending.session.state).toBe("FINALIZING");
      expect(await db.mediaProcessingJob.count()).toBe(0);
    } finally {
      release.resolve();
    }
    expect(success(await first).session.state).toBe("COMPLETED");
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it("rolls back accepted source/session/job writes when integrity enqueue fails", async () => {
    const f = await fixture();
    await storeParts(f.session);
    const lifecycle = app.get(MediaProcessingLifecycleService),
      enqueue = lifecycle.enqueueUploadedAssetInTransaction.bind(lifecycle);
    vi.spyOn(lifecycle, "enqueueUploadedAssetInTransaction").mockImplementationOnce(
      async (tx, assetId) => {
        await enqueue(tx, assetId);
        throw Error("synthetic enqueue rollback");
      },
    );
    const body = request(f.session),
      response = await command(f.actor, f.session.sessionId, "complete", body);
    expect(
      (await db.mediaAsset.findUniqueOrThrow({ where: { id: f.session.assetId! } })).status,
    ).toBe("PENDING");
    expect((await source(f.session)).state).toBe("UNRESOLVED");
    expect(await db.mediaProcessingJob.count()).toBe(0);
    expect((await db.video.findUniqueOrThrow({ where: { id: f.session.videoId! } })).status).toBe(
      "UPLOADING",
    );
    expect(response.body).not.toContain("synthetic enqueue rollback");
    expect(
      success(await command(f.actor, f.session.sessionId, "complete", body)).operation.status,
    ).toBe("UNKNOWN");
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it.each([1024, multipartBytes])(
    "cancels a %i-byte session with durable cleanup debt and no provider mutation",
    async (bytes) => {
      const f = await fixture(bytes),
        original = await source(f.session),
        body = request(f.session);
      vi.clearAllMocks();
      const cancelled = success(await command(f.actor, f.session.sessionId, "cancel", body));
      expect(cancelled.session.state).toBe("ABORTED");
      const saved = await source(f.session);
      expect(saved).toMatchObject({
        contentIdentityDigest: null,
        grantsRevokedAt: expect.any(Date),
        cleanupRequestedAt: expect.any(Date),
        cleanupRetainUntil: expect.any(Date),
      });
      expect(
        await db.mediaAsset.findUniqueOrThrow({ where: { id: saved.sourceAssetId! } }),
      ).toMatchObject({ status: "REMOVED", removedAt: expect.any(Date) });
      const debt = await db.privacyMediaDeletionJob.findMany({
        where: { uploadSessionId: saved.id },
      });
      expect(debt.map((row) => row.kind).sort()).toEqual(
        bytes === 1024 ? ["OBJECT"] : ["ALLOCATION", "MULTIPART", "OBJECT"],
      );
      for (const job of debt)
        expect(job).toMatchObject({
          status: "PENDING",
          target: original.objectKey,
          sessionRevision: saved.revision,
          accountId: f.actor.accountId,
        });
      const replay = success(await command(f.actor, f.session.sessionId, "cancel", body));
      expect(replay.operation.replayed).toBe(true);
      expect(
        await db.privacyMediaDeletionJob.findMany({ where: { uploadSessionId: saved.id } }),
      ).toEqual(debt);
      expect(await db.mediaProcessingJob.count()).toBe(0);
      noProvider();
    },
  );

  it("rejects cancellation after transfer acceptance without deleting accepted media", async () => {
    const f = await fixture();
    await storeParts(f.session);
    const completed = success(
      await command(f.actor, f.session.sessionId, "complete", request(f.session)),
    );
    vi.clearAllMocks();
    const before = await counts(),
      saved = await source(f.session);
    expect(
      (await command(f.actor, f.session.sessionId, "cancel", request(completed.session)))
        .statusCode,
    ).toBe(409);
    expect(await source(f.session)).toEqual(saved);
    expect(await counts()).toEqual(before);
    noProvider();
  });

  it("retains cancelled cleanup bytes in admission quota until settlement", async () => {
    const f = await fixture(),
      settings = app.get(PlatformSettingsService),
      originalGet = settings.get.bind(settings);
    vi.spyOn(settings, "get").mockImplementation(async (key) =>
      key === "uploadChannelQuotaBytes" ? multipartBytes : originalGet(key),
    );
    success(await command(f.actor, f.session.sessionId, "cancel", request(f.session)));
    vi.clearAllMocks();
    const before = await counts();
    const rejected = await create(f.actor, draft(f.actor, 1024));
    expect(rejected.statusCode).toBe(413);
    expect(rejected.json().error.code).toBe("CHANNEL_UPLOAD_QUOTA_REACHED");
    expect(await counts()).toEqual(before);
    noProvider();
  });

  it("rolls back cancellation, journal and source removal if durable cleanup registration fails", async () => {
    const f = await fixture(),
      before = await source(f.session),
      beforeCounts = await counts();
    await db.$executeRawUnsafe(`CREATE FUNCTION reject_recovery_cleanup_test() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'synthetic cleanup registration failure'; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER reject_recovery_cleanup_test BEFORE INSERT ON "PrivacyMediaDeletionJob"
      FOR EACH ROW EXECUTE FUNCTION reject_recovery_cleanup_test()`);
    vi.clearAllMocks();
    try {
      const result = await command(f.actor, f.session.sessionId, "cancel", request(f.session));
      expect(result.statusCode).toBe(500);
      expect(await source(f.session)).toEqual(before);
      expect(await counts()).toEqual(beforeCounts);
      expect(
        await db.mediaAsset.findUniqueOrThrow({ where: { id: f.session.assetId! } }),
      ).toMatchObject({ status: "PENDING", removedAt: null });
      noProvider();
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER reject_recovery_cleanup_test ON "PrivacyMediaDeletionJob"',
      );
      await db.$executeRawUnsafe("DROP FUNCTION reject_recovery_cleanup_test()");
    }
  });

  it("minimizes command journals only after every cleanup obligation is DONE and retention passes", async () => {
    const f = await fixture();
    success(await command(f.actor, f.session.sessionId, "cancel", request(f.session)));
    const jobs = await db.privacyMediaDeletionJob.findMany({
      where: { uploadSessionId: f.session.sessionId },
      orderBy: { id: "asc" },
    });
    const done = {
      status: "DONE" as const,
      completedAt: new Date(),
      settlementProofReference: "synthetic:retention-test-settlement",
      settlementVerifiedAt: new Date(),
      settlementLeaseToken: randomUUID(),
    };
    await db.privacyMediaDeletionJob.updateMany({
      where: { id: { in: jobs.slice(0, -1).map((job) => job.id) } },
      data: done,
    });
    await db.mediaUploadSession.update({
      where: { id: f.session.sessionId },
      data: { cleanupRetainUntil: new Date(Date.now() - 1) },
    });
    await minimizeCompletedUploadCleanup(db, new Date(), 10);
    expect(await db.mediaUploadOperation.count({ where: { sessionId: f.session.sessionId } })).toBe(
      2,
    );
    await db.privacyMediaDeletionJob.update({ where: { id: jobs.at(-1)!.id }, data: done });
    await db.mediaUploadSession.update({
      where: { id: f.session.sessionId },
      data: { cleanupRetainUntil: new Date(Date.now() + 60000) },
    });
    await minimizeCompletedUploadCleanup(db, new Date(), 10);
    expect(
      await db.mediaUploadSession.findUnique({ where: { id: f.session.sessionId } }),
    ).not.toBeNull();
    expect(await db.mediaUploadOperation.count({ where: { sessionId: f.session.sessionId } })).toBe(
      2,
    );
    await db.mediaUploadSession.update({
      where: { id: f.session.sessionId },
      data: { cleanupRetainUntil: new Date(Date.now() - 1) },
    });
    await minimizeCompletedUploadCleanup(db, new Date(), 10);
    expect(
      await db.mediaUploadSession.findUnique({ where: { id: f.session.sessionId } }),
    ).toBeNull();
    expect(await db.mediaUploadOperation.count({ where: { sessionId: f.session.sessionId } })).toBe(
      0,
    );
    const minimized = await db.privacyMediaDeletionJob.findMany({
      where: { uploadSessionId: f.session.sessionId },
    });
    expect(minimized).toHaveLength(3);
    for (const job of minimized)
      expect(job).toMatchObject({
        status: "DONE",
        target: null,
        providerUploadId: null,
        sourceAssetId: null,
      });
  });

  it("rejects partial creation/grant pairs and prevents journal deletion by session cascade", async () => {
    const f = await fixture();
    const body = { ...request(f.session), partNumber: 1 };
    success(await command(f.actor, f.session.sessionId, "authorize", body));
    const before = await source(f.session),
      beforeCounts = await counts();
    for (const data of [
      { creationRequestId: null },
      { creationRequestDigest: null },
      { grantlessReservationId: null },
      { lastGrantExpiresAt: null },
    ])
      await expect(
        db.mediaUploadSession.update({ where: { id: f.session.sessionId }, data }),
      ).rejects.toThrow();
    const authorization = await db.mediaUploadOperation.findFirstOrThrow({
      where: { sessionId: f.session.sessionId, requestId: body.requestId },
    });
    for (const data of [{ grantIssuedAt: null }, { grantExpiresAt: null }])
      await expect(
        db.mediaUploadOperation.update({ where: { id: authorization.id }, data }),
      ).rejects.toThrow();
    await expect(
      db.mediaUploadOperation.update({
        where: { id: authorization.id },
        data: { status: "UNKNOWN", dispatchStartedAt: null },
      }),
    ).rejects.toThrow();
    await expect(
      db.mediaUploadSession.delete({ where: { id: f.session.sessionId } }),
    ).rejects.toThrow();
    expect(await source(f.session)).toEqual(before);
    expect(await counts()).toEqual(beforeCounts);
  });

  it("conceals another creator's session and enforces expected-account/session headers", async () => {
    const f = await fixture(),
      other = await register();
    vi.clearAllMocks();
    const body = { ...request(f.session), partNumber: 1 };
    expect((await command(other, f.session.sessionId, "authorize", body)).statusCode).toBe(404);
    for (const headers of [
      { cookie: f.actor.cookie, "x-ayin-expected-account": other.accountId },
      { cookie: f.actor.cookie, "x-ayin-expected-session": randomUUID() },
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/media/uploads/sessions/${f.session.sessionId}/authorize`,
            headers,
            payload: body,
          })
        ).statusCode,
      ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/media/uploads/sessions/${f.session.sessionId}/authorize`,
          payload: body,
        })
      ).statusCode,
    ).toBe(401);
    noProvider();
  });

  it.each([
    "owner",
    "account",
    "login",
    "version",
    "channel",
    "video",
    "asset",
    "expired",
  ] as const)("checks current %s before granting upload authority", async (change) => {
    const f = await fixture();
    if (change === "owner")
      await db.channelMember.deleteMany({
        where: { accountId: f.actor.accountId, channelId: f.actor.channelId },
      });
    if (change === "account")
      await db.account.update({ where: { id: f.actor.accountId }, data: { status: "CLOSED" } });
    if (change === "login")
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
        where: { id: f.actor.channelId },
        data: { removedAt: new Date() },
      });
    if (change === "video")
      await db.video.update({ where: { id: f.session.videoId! }, data: { removedAt: new Date() } });
    if (change === "asset")
      await db.mediaAsset.update({
        where: { id: f.session.assetId! },
        data: { removedAt: new Date() },
      });
    if (change === "expired")
      await db.mediaUploadSession.update({
        where: { id: f.session.sessionId },
        data: {
          createdAt: new Date(Date.now() - 7200000),
          hardExpiresAt: new Date(Date.now() - 1000),
        },
      });
    vi.clearAllMocks();
    const response = await command(f.actor, f.session.sessionId, "authorize", {
      ...request(f.session),
      partNumber: 1,
    });
    expect(response.statusCode).toBe(
      change === "expired"
        ? 410
        : ["account", "login", "version"].includes(change)
          ? 401
          : change === "owner"
            ? 403
            : 409,
    );
    expect(response.body).not.toContain(signedUrl);
    noProvider();
  });

  it.each(["owner", "login", "version", "source"] as const)(
    "rechecks %s after signing before releasing the grant",
    async (change) => {
      const f = await fixture(),
        sign = vi.mocked(storage.authorizeMultipartPart).getMockImplementation()!;
      vi.mocked(storage.authorizeMultipartPart).mockImplementationOnce(async (input) => {
        const grant = await sign(input);
        if (change === "owner")
          await db.channelMember.deleteMany({
            where: { accountId: f.actor.accountId, channelId: f.actor.channelId },
          });
        if (change === "login")
          await db.accountSession.updateMany({
            where: { accountId: f.actor.accountId },
            data: { revokedAt: new Date() },
          });
        if (change === "version")
          await db.account.update({
            where: { id: f.actor.accountId },
            data: { authVersion: { increment: 1 } },
          });
        if (change === "source")
          await db.mediaAsset.update({
            where: { id: f.session.assetId! },
            data: { removedAt: new Date() },
          });
        return grant;
      });
      const response = await command(f.actor, f.session.sessionId, "authorize", {
        ...request(f.session),
        partNumber: 1,
      });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.body).not.toContain(signedUrl);
      expect(storage.authorizeMultipartPart).toHaveBeenCalledTimes(1);
      expect(await db.mediaProcessingJob.count()).toBe(0);
    },
  );

  it.each(["revision", "source", "hard-expiry", "login-expiry"] as const)(
    "rechecks %s after an observed PostgreSQL source-lock wait",
    async (change) => {
      const f = await fixture(),
        entered = deferred(),
        release = deferred();
      if (change === "login-expiry")
        await db.accountSession.updateMany({
          where: { accountId: f.actor.accountId },
          data: { expiresAt: new Date(Date.now() + 1300) },
        });
      const blocker = db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${f.session.assetId}::uuid FOR UPDATE`;
          entered.resolve();
          await release.promise;
          if (change === "revision")
            await tx.mediaUploadSession.update({
              where: { id: f.session.sessionId },
              data: { revision: { increment: 1 } },
            });
          if (change === "source")
            await tx.mediaAsset.update({
              where: { id: f.session.assetId! },
              data: { removedAt: new Date() },
            });
          if (change === "hard-expiry")
            await tx.mediaUploadSession.update({
              where: { id: f.session.sessionId },
              data: {
                createdAt: new Date(Date.now() - 7200000),
                hardExpiresAt: new Date(Date.now() - 1),
              },
            });
        },
        { timeout: 10000 },
      );
      await entered.promise;
      vi.clearAllMocks();
      const pending = Promise.resolve(
        command(f.actor, f.session.sessionId, "authorize", {
          ...request(f.session),
          partNumber: 1,
        }),
      );
      try {
        await waitForLock("ayin-recovery-command-source-lock");
        if (change === "login-expiry") await new Promise((resolve) => setTimeout(resolve, 1500));
      } finally {
        release.resolve();
        await blocker;
      }
      const result = await pending;
      expect(result.statusCode).toBe(
        change === "hard-expiry" ? 410 : change === "login-expiry" ? 401 : 409,
      );
      noProvider();
    },
  );

  it("allows a fresh valid login to resume the same initiating account's draft", async () => {
    const f = await fixture();
    await db.accountSession.updateMany({
      where: { accountId: f.actor.accountId },
      data: { revokedAt: new Date() },
    });
    const account = await db.account.findUniqueOrThrow({ where: { id: f.actor.accountId } });
    const token = await app.get(SessionService).create(account.id, account.authVersion, {}, {});
    const actor = { ...f.actor, cookie: `${f.actor.cookie.split("=", 1)[0]}=${token}` };
    const resumed = success(
      await command(actor, f.session.sessionId, "resume", {
        ...request(f.session),
        fileIdentity: f.request.fileIdentity,
      }),
    );
    expect(resumed.session.sessionId).toBe(f.session.sessionId);
    expect(resumed.grant).toBeUndefined();
  });

  it("rejects unknown creation fields, malformed declarations and request identities before reservation", async () => {
    const actor = await register(),
      valid = draft(actor),
      before = await counts();
    const invalid = [
      { ...valid, adminOverride: true },
      { ...valid, providerUploadId: "client-supplied" },
      { ...valid, sessionToken: "legacy-bearer" },
      { ...valid, settlementVerified: true },
      { ...valid, requestId: "not-a-uuid" },
      { ...valid, sizeBytes: valid.sizeBytes + 1 },
      { ...valid, fileIdentity: { ...valid.fileIdentity, leafCount: 1 } },
      { ...valid, fileIdentity: { ...valid.fileIdentity, extra: true } },
      { ...valid, fileIdentity: { ...valid.fileIdentity, rootSha256: "A".repeat(64) } },
    ];
    for (const body of invalid) expect((await create(actor, body)).statusCode).toBe(400);
    expect(await counts()).toEqual(before);
    noProvider();
  });

  it.each(["resume", "authorize", "complete", "cancel"] as const)(
    "strictly validates %s body, path, and query without mutation",
    async (name) => {
      const f = await fixture(),
        before = await source(f.session),
        beforeCounts = await counts();
      vi.clearAllMocks();
      const valid = {
        ...request(f.session),
        ...(name === "resume" ? { fileIdentity: f.request.fileIdentity } : {}),
        ...(name === "authorize" ? { partNumber: 1 } : {}),
      };
      for (const body of [
        { ...valid, parts: [{ partNumber: 1, etag: "client-etag" }] },
        { ...valid, uploadId: "client-provider-id" },
        { ...valid, sessionToken: "legacy-bearer" },
        { ...valid, expectedRevision: "1" },
        { ...valid, expectedRevision: 0 },
        { ...valid, requestId: "bad" },
      ])
        expect((await command(f.actor, f.session.sessionId, name, body)).statusCode).toBe(400);
      expect((await command(f.actor, "not-a-uuid", name, valid)).statusCode).toBe(400);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/media/uploads/sessions/${f.session.sessionId}/${name}?renew=true`,
            headers: { cookie: f.actor.cookie },
            payload: valid,
          })
        ).statusCode,
      ).toBe(400);
      expect(await source(f.session)).toEqual(before);
      expect(await counts()).toEqual(beforeCounts);
      noProvider();
    },
  );

  it("leaves legacy creator drafts unenrolled even when recovery-shaped fields are supplied", async () => {
    const actor = await register(),
      body = draft(actor, 1024);
    const response = await app.inject({
      method: "POST",
      url: "/creator/videos/drafts",
      headers: { cookie: actor.cookie },
      payload: body,
    });
    expect(response.statusCode).toBe(201);
    expect(await db.mediaUploadSession.count()).toBe(0);
    expect(await db.mediaUploadOperation.count()).toBe(0);
    const asset = await db.mediaAsset.findFirstOrThrow();
    expect(asset.uploadIntegrityRequired).toBe(false);
    vi.clearAllMocks();
    expect(
      (
        await command(actor, asset.id, "resume", {
          requestId: randomUUID(),
          expectedRevision: 1,
          fileIdentity: body.fileIdentity,
        })
      ).statusCode,
    ).toBe(404);
    noProvider();
  });

  it.each(["authorize-part", "resume", "complete", "abort"] as const)(
    "rejects a synthetically signed legacy token targeting a required-integrity asset through %s",
    async (name) => {
      const f = await fixture(),
        saved = await source(f.session);
      const sessionToken = app.get(UploadSessionTokenService).sign({
        version: 1,
        accountId: f.actor.accountId,
        channelId: f.actor.channelId,
        assetId: f.session.assetId!,
        objectKey: saved.objectKey,
        uploadId: saved.providerUploadId,
        mode: "multipart",
        mimeType: "video/mp4",
        sizeBytes: f.session.sizeBytes,
        partSizeBytes: f.session.partSizeBytes,
        expiresAtMs: Date.now() + 60000,
      });
      vi.clearAllMocks();
      const before = await counts(),
        asset = await db.mediaAsset.findUniqueOrThrow({ where: { id: f.session.assetId! } });
      const response = await app.inject({
        method: "POST",
        url: `/media/uploads/sessions/${name}`,
        headers: { cookie: f.actor.cookie },
        payload: {
          sessionToken,
          ...(name === "authorize-part" ? { partNumber: 1 } : {}),
          ...(name === "complete" ? { parts: [{ partNumber: 1, etag: privateEtag }] } : {}),
        },
      });
      expect(response.statusCode).toBe(409);
      expect(await source(f.session)).toEqual(saved);
      expect(await db.mediaAsset.findUniqueOrThrow({ where: { id: f.session.assetId! } })).toEqual(
        asset,
      );
      expect(await counts()).toEqual(before);
      noProvider();
    },
  );

  it("excludes required-integrity source objects and multipart inventory from the legacy abandoned-upload janitor", async () => {
    const f = await fixture(),
      saved = await source(f.session);
    const createdAt = new Date(Date.now() - 7200000);
    await db.mediaAsset.update({ where: { id: f.session.assetId! }, data: { createdAt } });
    const legacy = await db.mediaAsset.create({
      data: {
        channelId: f.actor.channelId,
        videoId: f.session.videoId!,
        kind: "SOURCE_VIDEO",
        status: "PENDING",
        r2ObjectKey: `channels/${f.actor.channelId}/media/${randomUUID()}/legacy.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 1024n,
        createdAt,
      },
    });
    vi.clearAllMocks();
    vi.mocked(storage.listMultipartUploads).mockResolvedValueOnce([
      { key: saved.objectKey, uploadId: saved.providerUploadId!, initiatedAt: createdAt },
      { key: legacy.r2ObjectKey, uploadId: "synthetic-legacy-upload", initiatedAt: createdAt },
    ]);
    const result = await app
      .get(MediaUploadService)
      .cleanupAbandonedUploads(new Date(Date.now() - 3600000));
    expect(result).toEqual({ abortedMultipart: 1, rejectedAssets: 1 });
    expect(storage.abortMultipartUpload).toHaveBeenCalledExactlyOnceWith({
      key: legacy.r2ObjectKey,
      uploadId: "synthetic-legacy-upload",
    });
    expect(storage.deleteObject).toHaveBeenCalledExactlyOnceWith(legacy.r2ObjectKey);
    expect(await source(f.session)).toEqual(saved);
    expect(
      await db.mediaAsset.findUniqueOrThrow({ where: { id: f.session.assetId! } }),
    ).toMatchObject({ status: "PENDING", removedAt: null, uploadIntegrityRequired: true });
    expect(await db.mediaAsset.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({
      status: "REJECTED",
      removedAt: expect.any(Date),
    });
    expect(await db.privacyMediaDeletionJob.count()).toBe(0);
    expect(await db.mediaProcessingJob.count()).toBe(0);
    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
    expect(storage.authorizeMultipartPart).not.toHaveBeenCalled();
    expect(storage.authorizeSinglePut).not.toHaveBeenCalled();
    expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
    expect(storage.deletePrefix).not.toHaveBeenCalled();
  });

  it("permits independent multipart authorizations at one revision without losing either reservation", async () => {
    const f = await fixture(),
      first = request(f.session),
      second = request(f.session);
    vi.clearAllMocks();
    const sign = vi.mocked(storage.authorizeMultipartPart).getMockImplementation()!;
    const committed: string[] = [];
    vi.mocked(storage.authorizeMultipartPart).mockImplementation(async (input) => {
      const requestId = input.partNumber === 1 ? first.requestId : second.requestId;
      const journal = await db.mediaUploadOperation.findUniqueOrThrow({
        where: { sessionId_requestId: { sessionId: f.session.sessionId, requestId } },
      });
      expect(journal).toMatchObject({
        status: "DISPATCHED",
        grantIssuedAt: input.now,
        grantExpiresAt: expect.any(Date),
      });
      expect(journal.grantExpiresAt!.getTime()).toBe(
        input.now!.getTime() + input.expiresInSeconds * 1000,
      );
      const reserved = await source(f.session);
      expect(reserved.grantReservationCount).toBeGreaterThanOrEqual(1);
      expect(reserved.lastGrantExpiresAt!.getTime()).toBeGreaterThanOrEqual(
        journal.grantExpiresAt!.getTime(),
      );
      committed.push(requestId);
      return sign(input);
    });
    const results = await Promise.all([
      command(f.actor, f.session.sessionId, "authorize", { ...first, partNumber: 1 }),
      command(f.actor, f.session.sessionId, "authorize", { ...second, partNumber: 2 }),
    ]);
    expect(results.map((result) => success(result).grant?.partNumber).sort()).toEqual([1, 2]);
    expect(await source(f.session)).toMatchObject({
      state: "OPEN",
      revision: f.session.revision,
      grantReservationCount: 2,
    });
    expect(
      await db.mediaUploadOperation.count({
        where: { sessionId: f.session.sessionId, kind: "AUTHORIZE", status: "SUCCEEDED" },
      }),
    ).toBe(2);
    expect(committed.sort()).toEqual([first.requestId, second.requestId].sort());
    expect(storage.authorizeMultipartPart).toHaveBeenCalledTimes(2);
    expect(storage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it("enforces the bounded command journal while reserving its final slot for cancellation", async () => {
    const f = await fixture();
    const history = Array.from({ length: 20_048 }, () => ({
      sessionId: f.session.sessionId,
      requestId: randomUUID(),
      kind: "RESUME",
      requestDigest: "b".repeat(64),
      expectedRevision: f.session.revision,
      status: "SUCCEEDED" as const,
    }));
    // Bound fixture SQL batches as well as the application command history.
    for (let offset = 0; offset < history.length; offset += 1000)
      await db.mediaUploadOperation.createMany({ data: history.slice(offset, offset + 1000) });
    expect(await db.mediaUploadOperation.count({ where: { sessionId: f.session.sessionId } })).toBe(
      20_049,
    );
    vi.clearAllMocks();
    const before = await source(f.session);
    const denied = await command(f.actor, f.session.sessionId, "authorize", {
      ...request(f.session),
      partNumber: 1,
    });
    expect(denied.statusCode).toBe(429);
    expect(denied.json().error.code).toBe("UPLOAD_COMMAND_LIMIT");
    expect(await source(f.session)).toEqual(before);
    expect(await db.mediaUploadOperation.count({ where: { sessionId: f.session.sessionId } })).toBe(
      20_049,
    );
    const body = request(f.session);
    expect(success(await command(f.actor, f.session.sessionId, "cancel", body)).session.state).toBe(
      "ABORTED",
    );
    expect(await db.mediaUploadOperation.count({ where: { sessionId: f.session.sessionId } })).toBe(
      20_050,
    );
    expect(
      await db.privacyMediaDeletionJob.count({
        where: { uploadSessionId: f.session.sessionId, status: "PENDING" },
      }),
    ).toBe(3);
    expect(
      success(await command(f.actor, f.session.sessionId, "cancel", body)).operation.replayed,
    ).toBe(true);
    expect(await db.mediaUploadOperation.count({ where: { sessionId: f.session.sessionId } })).toBe(
      20_050,
    );
    noProvider();
  });
  it("rejects a file beyond configured multipart capacity before reservation or allocation", async () => {
    const actor = await register();
    const settings = app.get(PlatformSettingsService);
    const get = settings.get.bind(settings);
    vi.spyOn(settings, "get").mockImplementation(async (key) =>
      key === "uploadMaxSizeBytes" || key === "uploadChannelQuotaBytes" ? 50 * 1024 ** 3 : get(key),
    );
    const before = await counts();
    const body = draft(actor, 50 * 1024 ** 3);
    const result = await create(actor, body);
    expect(result.statusCode).toBe(413);
    expect(result.json().error.code).toBe("UPLOAD_PART_LIMIT");
    expect(await counts()).toEqual(before);
    noProvider();
  });

  function read(actor: Actor, url: string, instance = app) {
    return instance.inject({
      method: "GET",
      url,
      headers: { cookie: actor.cookie, "x-ayin-expected-account": actor.accountId },
    });
  }
  async function readOnlyState(session: RecoverableUploadSession) {
    return {
      session: await source(session),
      operations: await db.mediaUploadOperation.findMany({
        where: { sessionId: session.sessionId },
        orderBy: { id: "asc" },
      }),
      asset: await db.mediaAsset.findUnique({ where: { id: session.assetId! } }),
      video: await db.video.findUnique({ where: { id: session.videoId! } }),
      jobs: await db.mediaProcessingJob.findMany({
        where: { videoId: session.videoId! },
        orderBy: { id: "asc" },
      }),
      cleanup: await db.privacyMediaDeletionJob.findMany({
        where: { uploadSessionId: session.sessionId },
        orderBy: { id: "asc" },
      }),
    };
  }
  function creationUrl(id: string) {
    return `/creator/videos/recoverable-drafts/${id}`;
  }
  function outcomeUrl(sessionId: string, id: string) {
    return `/media/uploads/sessions/${sessionId}/operations/${id}`;
  }
  function readOutcome(result: { statusCode: number; body: string; json(): unknown }) {
    expect(result.statusCode, result.body).toBe(200);
    const value = result.json() as UploadRecoveryCommandResponse;
    expect(value.operation.replayed).toBe(true);
    expect(value.grant).toBeUndefined();
    expect(result.body).not.toContain(signedUrl);
    expect(result.body).not.toContain("requestDigest");
    noPrivateState(result.body);
    return value;
  }

  it("exposes only authenticated bounded capability from the shipped unsupported provider", async () => {
    const actor = await register(),
      closedApp = await openApplication(false);
    try {
      const before = await counts();
      expect(
        (await closedApp.inject({ method: "GET", url: "/media/uploads/sessions/capability" }))
          .statusCode,
      ).toBe(401);
      const result = await read(actor, "/media/uploads/sessions/capability", closedApp);
      expect(result.statusCode).toBe(200);
      expect(result.headers["cache-control"]).toBe("private, no-store");
      expect(result.json()).toEqual({
        protocolVersion: 1,
        supported: false,
        reason: "UNSUPPORTED",
      });
      expect(
        (await read(actor, "/media/uploads/sessions/capability?supported=true", closedApp))
          .statusCode,
      ).toBe(400);
      expect(await counts()).toEqual(before);
      noProvider();
    } finally {
      await closedApp.close();
    }
  });

  it("does not cache a supported capability as authority to create later", async () => {
    const actor = await register(),
      before = await counts();
    const supported = await read(actor, "/media/uploads/sessions/capability");
    expect(supported.json()).toEqual({ protocolVersion: 1, supported: true, reason: null });
    evidence = null;
    expect((await read(actor, "/media/uploads/sessions/capability")).json()).toEqual({
      protocolVersion: 1,
      supported: false,
      reason: "UNSUPPORTED",
    });
    expect((await create(actor)).statusCode).toBe(503);
    expect(await counts()).toEqual(before);
    noProvider();
  });

  it("reads a lost CREATE outcome without a session ID or a second allocation", async () => {
    const actor = await register(),
      body = draft(actor),
      entered = deferred(),
      release = deferred();
    expect((await read(actor, creationUrl(body.requestId))).statusCode).toBe(404);
    expect(await db.mediaUploadSession.count()).toBe(0);
    noProvider();
    probe = async (kind) => {
      if (kind === "create") {
        entered.resolve();
        await release.promise;
      }
    };
    const pending = Promise.resolve(create(actor, body));
    await within(entered.promise, "CREATE was not dispatched");
    try {
      const before = await counts();
      const result = await read(actor, creationUrl(body.requestId));
      const outcome = readOutcome(result);
      expect(outcome.operation).toEqual({
        requestId: body.requestId,
        status: "UNKNOWN",
        replayed: true,
      });
      expect(outcome.session.state).toBe("PREPARING");
      expect(result.headers["cache-control"]).toBe("private, no-store");
      expect(await counts()).toEqual(before);
      expect(storage.createMultipartUpload).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve();
    }
    const created = success(await pending);
    const before = await source(created.session),
      beforeCounts = await counts();
    const found = readOutcome(await read(actor, creationUrl(body.requestId)));
    expect(found.operation.status).toBe("SUCCEEDED");
    expect(found.session.sessionId).toBe(created.session.sessionId);
    expect(await source(created.session)).toEqual(before);
    expect(await counts()).toEqual(beforeCounts);
    expect(storage.createMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a dispatched AUTHORIZE while OPEN without replaying or returning grants", async () => {
    const f = await fixture(),
      body = { ...request(f.session), partNumber: 1 },
      entered = deferred(),
      release = deferred();
    probe = async (kind) => {
      if (kind === "authorizeMultipart") {
        entered.resolve();
        await release.promise;
      }
    };
    const pending = Promise.resolve(command(f.actor, f.session.sessionId, "authorize", body));
    await within(entered.promise, "AUTHORIZE was not dispatched");
    try {
      const before = await readOnlyState(f.session),
        beforeCounts = await counts();
      const outcome = readOutcome(
        await read(f.actor, outcomeUrl(f.session.sessionId, body.requestId)),
      );
      expect(outcome.session).toMatchObject({ state: "OPEN", revision: f.session.revision });
      expect(outcome.operation.status).toBe("UNKNOWN");
      expect(await readOnlyState(f.session)).toEqual(before);
      expect(await counts()).toEqual(beforeCounts);
    } finally {
      release.resolve();
    }
    expect(success(await pending).grant?.url).toBe(signedUrl);
    const before = await counts();
    const outcome = readOutcome(
      await read(f.actor, outcomeUrl(f.session.sessionId, body.requestId)),
    );
    expect(outcome.operation.status).toBe("SUCCEEDED");
    expect((await read(f.actor, outcomeUrl(f.session.sessionId, randomUUID()))).statusCode).toBe(
      404,
    );
    expect(storage.authorizeMultipartPart).toHaveBeenCalledTimes(1);
    expect(await counts()).toEqual(before);
  });

  it("reads RESERVED and UNKNOWN outcomes without changing the journal or pending source", async () => {
    const f = await fixture(1024);
    await db.mediaUploadSession.update({
      where: { id: f.session.sessionId },
      data: { state: "PREPARING" },
    });
    const operation = await db.mediaUploadOperation.findFirstOrThrow({
      where: { sessionId: f.session.sessionId, kind: "CREATE" },
    });
    await db.mediaUploadOperation.update({
      where: { id: operation.id },
      data: { status: "RESERVED" },
    });
    vi.clearAllMocks();
    const before = await source(f.session),
      beforeCounts = await counts();
    expect(
      readOutcome(await read(f.actor, creationUrl(f.request.requestId))).operation.status,
    ).toBe("PENDING");
    expect(
      readOutcome(await read(f.actor, outcomeUrl(f.session.sessionId, f.request.requestId)))
        .operation.status,
    ).toBe("PENDING");
    expect(await source(f.session)).toEqual(before);
    expect(await counts()).toEqual(beforeCounts);
    await db.mediaUploadSession.update({
      where: { id: f.session.sessionId },
      data: { state: "UNRESOLVED" },
    });
    await db.mediaUploadOperation.update({
      where: { id: operation.id },
      data: { status: "UNKNOWN", dispatchStartedAt: new Date() },
    });
    const unresolved = await source(f.session);
    expect(
      readOutcome(await read(f.actor, creationUrl(f.request.requestId))).operation.status,
    ).toBe("UNKNOWN");
    expect(await source(f.session)).toEqual(unresolved);
    noProvider();
  });

  it("keeps outcome lookups account-scoped, authenticated, strict and free of mutations", async () => {
    const f = await fixture(),
      stranger = await register();
    vi.clearAllMocks();
    const before = await counts();
    const urls = [
      creationUrl(f.request.requestId),
      outcomeUrl(f.session.sessionId, f.request.requestId),
    ];
    for (const url of urls) {
      expect((await read(stranger, url)).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
      expect((await read(f.actor, `${url}?retry=true`)).statusCode).toBe(400);
    }
    expect((await read(f.actor, creationUrl("not-a-uuid"))).statusCode).toBe(400);
    expect((await read(f.actor, outcomeUrl(f.session.sessionId, "not-a-uuid"))).statusCode).toBe(
      400,
    );
    expect((await read(f.actor, outcomeUrl("not-a-uuid", f.request.requestId))).statusCode).toBe(
      400,
    );
    expect(await counts()).toEqual(before);
    noProvider();
  });

  it.each(["owner", "login", "privacy"] as const)(
    "rechecks current %s authority for both read-only outcomes",
    async (change) => {
      const f = await fixture();
      if (change === "owner")
        await db.channelMember.deleteMany({
          where: { channelId: f.actor.channelId, accountId: f.actor.accountId },
        });
      if (change === "login")
        await db.accountSession.updateMany({
          where: { accountId: f.actor.accountId },
          data: { revokedAt: new Date() },
        });
      if (change === "privacy")
        await db.video.update({
          where: { id: f.session.videoId! },
          data: { status: "REMOVED", removedAt: new Date() },
        });
      vi.clearAllMocks();
      const before = await source(f.session),
        beforeCounts = await counts();
      for (const url of [
        creationUrl(f.request.requestId),
        outcomeUrl(f.session.sessionId, f.request.requestId),
      ])
        expect((await read(f.actor, url)).statusCode).toBe(
          change === "owner" ? 403 : change === "login" ? 401 : 409,
        );
      expect(await source(f.session)).toEqual(before);
      expect(await counts()).toEqual(beforeCounts);
      noProvider();
    },
  );

  it("reads accepted outcomes after expiry and source retirement without completion replay", async () => {
    const f = await fixture(),
      body = request(f.session);
    await storeParts(f.session);
    success(await command(f.actor, f.session.sessionId, "complete", body));
    await db.mediaAsset.update({
      where: { id: f.session.assetId! },
      data: { status: "REMOVED", removedAt: new Date() },
    });
    await db.mediaUploadSession.update({
      where: { id: f.session.sessionId },
      data: {
        createdAt: new Date(Date.now() - 7200000),
        hardExpiresAt: new Date(Date.now() - 1000),
      },
    });
    vi.clearAllMocks();
    const before = await readOnlyState(f.session),
      beforeCounts = await counts();
    for (const url of [
      creationUrl(f.request.requestId),
      outcomeUrl(f.session.sessionId, body.requestId),
    ]) {
      const result = readOutcome(await read(f.actor, url));
      expect(result.session.state).toBe("COMPLETED");
      expect(result.operation.status).toBe("SUCCEEDED");
    }
    expect(await readOnlyState(f.session)).toEqual(before);
    expect(await counts()).toEqual(beforeCounts);
    noProvider();
  });
});
