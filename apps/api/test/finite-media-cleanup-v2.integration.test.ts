import "reflect-metadata";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrismaClient, type MediaProcessingJob } from "@ayin/db";
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
import {
  DURABLE_UPLOAD_SETTLEMENT,
  FiniteMultipartDurableUploadSettlement,
} from "../src/media/durable-upload-settlement.js";
import { capturedMediaClaim, outputAttemptAddresses } from "../src/media/media-output-attempt.js";
import {
  freezeOutputAttempts,
  MediaOutputWriteJournalService,
} from "../src/media/media-output-write-journal.js";
import { MediaProcessingLifecycleService } from "../src/media/media-processing-lifecycle.service.js";
import { MediaProcessingQueueService } from "../src/media/media-processing-queue.service.js";
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
import {
  loadMediaStorageConfig,
  type MediaStorageConfig,
} from "../src/media/media-storage.config.js";
import {
  assertUploadByteQuota,
  assertUploadDebtByteCapacity,
  assertUploadSessionCapacity,
  conservativeMultipartExposure,
} from "../src/media/media-upload-admission.js";
import { registerUploadCleanupInTransaction } from "../src/media/media-upload-cleanup.js";
import { R2HttpError } from "../src/media/r2-sigv4.js";
import { PrivacyLifecycleService } from "../src/privacy/privacy-lifecycle.service.js";
import {
  claimMediaCleanupJob,
  finishFiniteMediaCleanupJob,
  minimizeCompletedUploadCleanup,
  processPrivacyMediaDeletionBatch,
} from "../src/privacy/privacy-media-cleanup.js";

import {
  finiteOutputSnapshot,
  finiteSourceSnapshot,
  type FiniteCleanupEvidence,
  type FiniteCleanupSnapshot,
} from "../src/privacy/privacy-media-cleanup-v2.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const partSizeBytes = 5 * 1024 * 1024;
const bytes = 1024;
const day = 86_400_000;
const identity = (sizeBytes = bytes): UploadFileIdentity => ({
  algorithm: "AYIN_SHA256_CHUNKS_V1",
  version: 1,
  sizeBytes,
  chunkSizeBytes: 4 * 1024 * 1024,
  leafCount: Math.ceil(sizeBytes / (4 * 1024 * 1024)),
  rootSha256: "a".repeat(64),
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Real PostgreSQL/API transactions with isolated synthetic provider observations.
// No fixture claims to prove an eternal provider-side absence or byte-size bound.
databaseDescribe("Finite media cleanup V2 on PostgreSQL", () => {
  const db = createPrismaClient(databaseUrl);
  let app: NestFastifyApplication;
  let grantSeconds = 900;
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
  const storage: MediaStorageAdapter = {
    kind: "r2",
    available: true,
    createMultipartUpload: vi.fn(),
    authorizeMultipartPart: vi.fn(),
    authorizeSinglePut: vi.fn(),
    completeMultipartUpload: vi.fn(),
    listParts: vi.fn(),
    listMultipartUploads: vi.fn(),
    abortMultipartUpload: vi.fn(),
    headObject: vi.fn(),
    deleteObject: vi.fn(),
    deletePrefix: vi.fn(),
    observeUploadCompletion: vi.fn(),
  };
  beforeAll(async () => {
    process.env.APP_ENV = "test";
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_TOKEN_SECRET = "finite-v2-test-auth-secret-more-than-32-characters";
    process.env.UPLOAD_SESSION_SECRET = "finite-v2-test-upload-secret-more-than-32-characters";
    process.env.WEB_ORIGIN = "http://localhost:3000";
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MEDIA_STORAGE_ADAPTER)
      .useValue(storage)
      .overrideProvider(MEDIA_STORAGE_CONFIG)
      .useValue({
        ...loadMediaStorageConfig({ APP_ENV: "test" }),
        recoveryV2Enabled: true,
        recoveryDebtAccountBytes: 10 * 1024 ** 4,
        recoveryDebtChannelBytes: 50 * 1024 ** 4,
        multipartThresholdBytes: 64 * 1024 * 1024,
        get uploadUrlTtlSeconds() {
          return grantSeconds;
        },
        partSizeBytes,
      })
      .overrideProvider(DURABLE_UPLOAD_SETTLEMENT)
      .useValue(new FiniteMultipartDurableUploadSettlement())
      .overrideProvider(MediaProcessingStorageService)
      .useValue({ headObject: storage.headObject })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    grantSeconds = 900;
    for (const operation of Object.values(storage))
      if (vi.isMockFunction(operation)) operation.mockReset();
    allocations.clear();
    objects.clear();
    vi.mocked(storage.createMultipartUpload).mockImplementation(
      async ({ key, contentType, uploadBinding }) => {
        const uploadId = `synthetic-v2-${randomUUID()}`;
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
        expect(allocations.get(uploadId)?.key).toBe(key);
        return {
          url: "https://synthetic.invalid/finite-v2-part",
          expiresAt: new Date((now?.getTime() ?? Date.now()) + expiresInSeconds * 1000),
        };
      },
    );
    vi.mocked(storage.authorizeSinglePut).mockRejectedValue(
      Error("V2 must never issue a single PUT"),
    );
    vi.mocked(storage.listParts).mockImplementation(async ({ key, uploadId }) => {
      const allocation = allocations.get(uploadId);
      if (!allocation || allocation.key !== key)
        throw new MediaStorageObservationError("NO_SUCH_UPLOAD", "listParts", 404);
      return allocation.parts.map((part) => ({ ...part }));
    });
    vi.mocked(storage.listMultipartUploads).mockImplementation(async (prefix) =>
      [...allocations]
        .filter(([, value]) => value.key.startsWith(prefix))
        .map(([uploadId, value]) => ({ key: value.key, uploadId, initiatedAt: new Date() })),
    );
    vi.mocked(storage.completeMultipartUpload).mockImplementation(
      async ({ key, uploadId, parts }) => {
        const allocation = allocations.get(uploadId);
        if (!allocation || allocation.key !== key) throw Error("Missing synthetic allocation");
        expect(parts).toEqual(
          allocation.parts.map(({ partNumber, etag }) => ({ partNumber, etag })),
        );
        objects.set(key, {
          sizeBytes: allocation.parts.reduce((sum, part) => sum + part.sizeBytes, 0),
          contentType: allocation.contentType,
          etag: '"synthetic-v2"',
          ...(allocation.uploadBinding ? { uploadBinding: allocation.uploadBinding } : {}),
        });
        allocations.delete(uploadId);
        return { etag: '"synthetic-v2"' };
      },
    );
    vi.mocked(storage.observeUploadCompletion!).mockImplementation(
      async ({ key, uploadId, expected }) => {
        if (uploadId && allocations.has(uploadId)) return { status: "MULTIPART_PRESENT" };
        const object = objects.get(key);
        if (!object) return { status: "OBJECT_ABSENT" };
        if (
          !object.uploadBinding ||
          !object.etag ||
          object.sizeBytes !== expected.sizeBytes ||
          object.contentType !== expected.contentType ||
          object.uploadBinding.sessionId !== expected.binding.sessionId ||
          object.uploadBinding.sourceAssetId !== expected.binding.sourceAssetId ||
          object.uploadBinding.contentIdentityDigest !== expected.binding.contentIdentityDigest
        )
          return { status: "OBJECT_MISMATCH" };
        return {
          status: "OBJECT_VERIFIED",
          metadata: { ...object, etag: object.etag, uploadBinding: object.uploadBinding },
        };
      },
    );
    vi.mocked(storage.abortMultipartUpload).mockImplementation(async ({ key, uploadId }) => {
      if (allocations.get(uploadId)?.key === key) allocations.delete(uploadId);
    });
    vi.mocked(storage.headObject).mockImplementation(async (key) => {
      const object = objects.get(key);
      if (!object) throw new R2HttpError(404, "HEAD");
      return object;
    });
    vi.mocked(storage.deleteObject).mockImplementation(async (key) => {
      objects.delete(key);
    });
    vi.mocked(storage.deletePrefix).mockRejectedValue(
      Error("V2 cleanup must use exact journal addresses"),
    );
    await db.$executeRawUnsafe(
      'TRUNCATE TABLE "Account", "Channel", "MediaUploadSession", "AccountDeletionRequest", "PrivacyMediaDeletionJob", "MediaProcessingOutputAttempt", "PlatformSetting" CASCADE',
    );
  });
  afterAll(async () => {
    await app?.close();
    await db.$disconnect();
  });

  let registration = 0;
  async function register() {
    registration++;
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      remoteAddress: `198.19.${Math.floor(registration / 250)}.${(registration % 250) + 1}`,
      payload: {
        name: "Finite cleanup creator",
        email: `${randomUUID()}@finite.invalid`,
        password: "strong-pass-123",
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const raw = response.headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw[0] : raw)?.split(";", 1)[0];
    if (!cookie) throw Error("Authenticated fixture cookie missing");
    return {
      cookie,
      accountId: response.json().user.account.id as string,
      channelId: response.json().user.channel.id as string,
    };
  }
  type Actor = Awaited<ReturnType<typeof register>>;
  function draft(actor: Actor): CreateRecoverableDraftRequest {
    return {
      requestId: randomUUID(),
      channelId: actor.channelId,
      title: "Finite synthetic source",
      sizeBytes: bytes,
      mimeType: "video/mp4",
      videoForm: "LONG_FORM",
      fileIdentity: identity(),
    };
  }
  function create(actor: Actor, payload = draft(actor)) {
    return app.inject({
      method: "POST",
      url: "/creator/videos/recoverable-drafts",
      headers: { cookie: actor.cookie, "x-ayin-expected-account": actor.accountId },
      payload,
    });
  }
  function command(
    actor: Actor,
    session: RecoverableUploadSession,
    name: "authorize" | "complete" | "cancel",
    extra: Record<string, unknown> = {},
  ) {
    return app.inject({
      method: "POST",
      url: `/media/uploads/sessions/${session.sessionId}/${name}`,
      headers: { cookie: actor.cookie, "x-ayin-expected-account": actor.accountId },
      payload: { requestId: randomUUID(), expectedRevision: session.revision, ...extra },
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
  async function source(session: RecoverableUploadSession) {
    return db.mediaUploadSession.findUniqueOrThrow({ where: { id: session.sessionId } });
  }
  async function fixture(actor?: Actor) {
    const owner = actor ?? (await register());
    const request = draft(owner);
    const result = success(await create(owner, request));
    return { actor: owner, request, session: result.session };
  }
  async function storeParts(session: RecoverableUploadSession, actor: Actor) {
    const before = await source(session);
    if (before.grantReservationCount === 0)
      success(await command(actor, session, "authorize", { partNumber: 1 }));
    const saved = await source(session);
    const allocation = allocations.get(saved.providerUploadId!);
    if (!allocation) throw Error("Synthetic allocation missing");
    allocation.parts = [{ partNumber: 1, sizeBytes: bytes, etag: '"part-v2"' }];
    return saved;
  }
  async function accepted() {
    const f = await fixture();
    await storeParts(f.session, f.actor);
    f.session = success(await command(f.actor, f.session, "complete")).session;
    expect(f.session.state).toBe("COMPLETED");
    return f;
  }
  async function claimed() {
    const f = await accepted();
    const job = await app.get(MediaProcessingQueueService).claimNext("finite-v2-worker");
    expect(job).not.toBeNull();
    expect(
      await app.get(MediaProcessingLifecycleService).recordInputVerification({
        jobId: job!.id,
        workerId: job!.leaseOwner!,
        ...capturedMediaClaim(job!),
        identity: identity(),
      }),
    ).toBe(true);
    return { ...f, job: job! };
  }
  async function dispatch(
    job: MediaProcessingJob,
    suffix = "canonical.mp4",
    contentType = "video/mp4",
  ) {
    const receipt = await app.get(MediaOutputWriteJournalService).dispatch({
      jobId: job.id,
      workerId: job.leaseOwner!,
      ...capturedMediaClaim(job),
      objectKey: `${job.outputR2ObjectKey.slice(0, -"canonical.mp4".length)}${suffix}`,
      expectedSizeBytes: bytes,
      contentType,
    });
    expect(receipt).not.toBeNull();
    return receipt!;
  }
  async function freeze(job: MediaProcessingJob) {
    await db.$transaction((tx) => freezeOutputAttempts(tx, [job.id]));
  }
  async function due() {
    await db.privacyMediaDeletionJob.updateMany({
      where: { status: { in: ["PENDING", "FAILED"] } },
      data: { availableAt: new Date(0) },
    });
  }
  async function cleanup(limit = 30) {
    return processPrivacyMediaDeletionBatch(db, storage, new Date(), limit);
  }

  async function claimExactly(id: string) {
    await db.privacyMediaDeletionJob.updateMany({
      where: { id: { not: id }, status: "PENDING" },
      data: { availableAt: new Date(Date.now() + day) },
    });
    const claim = await claimMediaCleanupJob(db, new Date());
    expect(claim?.id).toBe(id);
    return claim!;
  }
  type CleanupClaim = Awaited<ReturnType<typeof claimExactly>>;
  function finiteEvidence(
    claim: CleanupClaim,
    snapshot: FiniteCleanupSnapshot,
  ): FiniteCleanupEvidence {
    const observed = new Date(claim.claimedAt!);
    return {
      version: "AYIN_CLEANUP_V2",
      conclusion: "FROZEN_ACKNOWLEDGED_AND_OBSERVED_ABSENT",
      operationKey: claim.operationKey,
      kind: claim.kind,
      leaseToken: claim.leaseToken,
      attempt: claim.attempts,
      writeSetDigest: snapshot.writeSetDigest,
      observedAbsentAt: observed.toISOString(),
      observationStartedAt: observed.toISOString(),
      sessionId: claim.uploadSessionId,
      sessionRevision: claim.sessionRevision,
      outputAttemptId: claim.outputAttemptId,
      exactObjectCount: snapshot.keys.length,
      abortAcknowledgedAt: null,
      abortUploadIdDigest: null,
      retentionCheckedAt: null,
    };
  }
  function rawDone(
    claim: CleanupClaim,
    evidence: object,
    overrides: {
      settlementLeaseToken?: string;
      observedAbsentAt?: Date;
      attempts?: number;
      sessionRevision?: number;
    } = {},
  ) {
    const observed = overrides.observedAbsentAt ?? new Date(claim.claimedAt!);
    return db.$executeRaw`UPDATE "PrivacyMediaDeletionJob" SET status='DONE',
      "completedAt"=${new Date()}, "observedAbsentAt"=${observed},
      "settlementLeaseToken"=${overrides.settlementLeaseToken ?? claim.leaseToken}::uuid,
      attempts=${overrides.attempts ?? claim.attempts}, "sessionRevision"=${overrides.sessionRevision ?? claim.sessionRevision},
      "cleanupEvidence"=${JSON.stringify(evidence)}::jsonb, "leaseToken"=NULL, "leaseExpiresAt"=NULL
      WHERE id=${claim.id}::uuid`;
  }

  it("keeps V2 admission disabled when its switch is enabled without explicit positive debt budgets", async () => {
    const actor = await register();
    const config = app.get<{ recoveryDebtAccountBytes: number }>(MEDIA_STORAGE_CONFIG);
    const previous = config.recoveryDebtAccountBytes;
    config.recoveryDebtAccountBytes = 0;
    try {
      const capability = await app.inject({
        method: "GET",
        url: "/media/uploads/sessions/capability",
        headers: { cookie: actor.cookie, "x-ayin-expected-account": actor.accountId },
      });
      expect(capability.statusCode).toBe(200);
      expect(capability.json()).toMatchObject({ supported: false, reason: "UNSUPPORTED" });
      expect((await create(actor)).statusCode).toBe(503);
      expect(await db.mediaUploadSession.count()).toBe(0);
      expect(storage.createMultipartUpload).not.toHaveBeenCalled();
    } finally {
      config.recoveryDebtAccountBytes = previous;
    }
  });

  it("uses multipart for a tiny V2 source and commits exact CREATE acknowledgement before issuing any part", async () => {
    const f = await fixture();
    const saved = await source(f.session);
    expect(saved).toMatchObject({
      sourceProtocolVersion: 2,
      mode: "MULTIPART",
      state: "OPEN",
      providerExposureBytes: 0n,
    });
    expect(
      await db.mediaUploadOperation.findFirstOrThrow({
        where: { sessionId: saved.id, kind: "CREATE" },
      }),
    ).toMatchObject({
      providerOutcome: "ACKNOWLEDGED",
      providerTerminalAt: expect.any(Date),
      providerUploadId: saved.providerUploadId,
    });
    expect(storage.authorizeMultipartPart).not.toHaveBeenCalled();
    const authorized = success(await command(f.actor, f.session, "authorize", { partNumber: 1 }));
    expect(authorized.operation.status).toBe("SUCCEEDED");
    expect(storage.authorizeMultipartPart).toHaveBeenCalledWith(
      expect.objectContaining({
        key: saved.objectKey,
        uploadId: saved.providerUploadId,
        partNumber: 1,
        expectedSizeBytes: bytes,
      }),
    );
    expect((await source(f.session)).providerExposureBytes).toBe(
      conservativeMultipartExposure(bytes, partSizeBytes),
    );
    expect(storage.authorizeSinglePut).not.toHaveBeenCalled();
  });

  it("journals a lost CREATE once, grants no parts, and retains allocation debt without whole-file exposure", async () => {
    const actor = await register(),
      body = draft(actor);
    const allocate = vi.mocked(storage.createMultipartUpload).getMockImplementation()!;
    vi.mocked(storage.createMultipartUpload).mockImplementationOnce(async (input) => {
      await allocate(input);
      throw Error("Synthetic lost CREATE reply");
    });
    const first = success(await create(actor, body));
    const saved = await source(first.session);
    expect(saved).toMatchObject({
      state: "UNRESOLVED",
      providerUploadId: null,
      providerExposureBytes: 0n,
      grantReservationCount: 0,
    });
    const replay = success(await create(actor, body));
    expect(replay.operation).toMatchObject({ status: "UNKNOWN", replayed: true });
    expect(storage.createMultipartUpload).toHaveBeenCalledTimes(1);
    expect((await command(actor, first.session, "authorize", { partNumber: 1 })).statusCode).toBe(
      409,
    );
    expect(storage.authorizeMultipartPart).not.toHaveBeenCalled();
    expect(
      await db.mediaUploadOperation.findFirstOrThrow({
        where: { sessionId: saved.id, kind: "CREATE" },
      }),
    ).toMatchObject({ providerOutcome: "UNKNOWN", providerTerminalAt: null });
    await command(actor, first.session, "cancel");
    await cleanup();
    expect(
      await db.privacyMediaDeletionJob.count({
        where: { uploadSessionId: saved.id, status: "DONE" },
      }),
    ).toBe(0);
    await expect(
      db.$transaction((tx) => assertUploadByteQuota(tx, actor.channelId, bytes, bytes)),
    ).resolves.toBeUndefined();
  });

  it("coalesces concurrent CREATE and COMPLETE commands without duplicate provider dispatch", async () => {
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
    const pending = Promise.resolve(create(actor, body));
    await entered.promise;
    try {
      expect(success(await create(actor, body)).operation.replayed).toBe(true);
    } finally {
      release.resolve();
    }
    const opened = success(await pending).session;
    await storeParts(opened, actor);
    const completeEntered = deferred(),
      completeRelease = deferred();
    const complete = vi.mocked(storage.completeMultipartUpload).getMockImplementation()!;
    vi.mocked(storage.completeMultipartUpload).mockImplementationOnce(async (input) => {
      completeEntered.resolve();
      await completeRelease.promise;
      return complete(input);
    });
    const requestId = randomUUID();
    const completing = Promise.resolve(command(actor, opened, "complete", { requestId }));
    await completeEntered.promise;
    try {
      expect(
        success(await command(actor, opened, "complete", { requestId })).operation.replayed,
      ).toBe(true);
    } finally {
      completeRelease.resolve();
    }
    expect(success(await completing).session.state).toBe("COMPLETED");
    expect(storage.createMultipartUpload).toHaveBeenCalledTimes(1);
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
    expect(
      await db.mediaUploadOperation.count({
        where: { sessionId: opened.sessionId, kind: "COMPLETE", providerOutcome: "ACKNOWLEDGED" },
      }),
    ).toBe(1);
  });

  it("retains a missing COMPLETE acknowledgement after read-only source acceptance", async () => {
    const f = await fixture();
    success(await command(f.actor, f.session, "authorize", { partNumber: 1 }));
    const saved = await storeParts(f.session, f.actor),
      requestId = randomUUID();
    const complete = vi.mocked(storage.completeMultipartUpload).getMockImplementation()!;
    vi.mocked(storage.completeMultipartUpload).mockImplementationOnce(async (input) => {
      await complete(input);
      throw Error("Synthetic lost COMPLETE reply");
    });
    const unknown = success(await command(f.actor, f.session, "complete", { requestId }));
    expect(unknown.operation.status).toBe("UNKNOWN");
    const reconciled = success(
      await app.inject({
        method: "POST",
        url: `/media/uploads/sessions/${saved.id}/operations/${requestId}/reconcile`,
        headers: { cookie: f.actor.cookie, "x-ayin-expected-account": f.actor.accountId },
        payload: { expectedRevision: unknown.session.revision },
      }),
    );
    expect(reconciled.session.state).toBe("COMPLETED");
    expect(
      await db.mediaUploadOperation.findUniqueOrThrow({
        where: { sessionId_requestId: { sessionId: saved.id, requestId } },
      }),
    ).toMatchObject({ status: "SUCCEEDED", providerOutcome: "UNKNOWN", providerTerminalAt: null });
    expect((await source(f.session)).providerExposureBytes).toBe(
      conservativeMultipartExposure(bytes, partSizeBytes),
    );
    expect(
      success(await command(f.actor, f.session, "complete", { requestId })).operation.replayed,
    ).toBe(true);
    expect(storage.completeMultipartUpload).toHaveBeenCalledTimes(1);
    expect(await db.mediaProcessingJob.count()).toBe(1);
    await expect(
      db.$transaction((tx) =>
        assertUploadDebtByteCapacity(tx, f.actor.accountId, f.actor.channelId, 0n, {
          account: bytes,
          channel: bytes,
        }),
      ),
    ).rejects.toMatchObject({ code: "UPLOAD_PHYSICAL_DEBT_LIMIT" });
    await expect(
      db.$transaction((tx) => assertUploadByteQuota(tx, f.actor.channelId, bytes, 2 * bytes)),
    ).resolves.toBeUndefined();
  });

  it("saves a delayed exact CREATE acknowledgement after cancellation without reopening authority", async () => {
    const actor = await register(),
      body = draft(actor),
      entered = deferred(),
      release = deferred();
    const allocate = vi.mocked(storage.createMultipartUpload).getMockImplementation()!;
    vi.mocked(storage.createMultipartUpload).mockImplementationOnce(async (input) => {
      const value = await allocate(input);
      entered.resolve();
      await release.promise;
      return value;
    });
    const pending = Promise.resolve(create(actor, body));
    await entered.promise;
    try {
      const observed = success(await create(actor, body));
      success(await command(actor, observed.session, "cancel"));
    } finally {
      release.resolve();
    }
    await pending;
    const saved = await db.mediaUploadSession.findFirstOrThrow();
    expect(saved.state).toBe("ABORTED");
    const op = await db.mediaUploadOperation.findFirstOrThrow({ where: { kind: "CREATE" } });
    expect(op).toMatchObject({
      providerOutcome: "ACKNOWLEDGED",
      providerTerminalAt: expect.any(Date),
      providerUploadId: expect.any(String),
    });
    await cleanup();
    await due();
    await cleanup();
    expect(storage.abortMultipartUpload).toHaveBeenCalledWith({
      key: saved.objectKey,
      uploadId: op.providerUploadId,
    });
    expect(
      await db.privacyMediaDeletionJob.count({
        where: { uploadSessionId: saved.id, status: { not: "DONE" } },
      }),
    ).toBe(0);
    expect(storage.authorizeMultipartPart).not.toHaveBeenCalled();
    expect(storage.createMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it("accepts more than fifty sequential source transfers without active-slot lockout", async () => {
    const actor = await register();
    for (let index = 0; index < 51; index++) {
      const f = await fixture(actor);
      await storeParts(f.session, f.actor);
      expect(success(await command(actor, f.session, "complete")).session.state).toBe("COMPLETED");
    }
    expect(await db.mediaUploadSession.count({ where: { state: "COMPLETED" } })).toBe(51);
    expect(await db.mediaProcessingJob.count()).toBe(51);
    expect((await fixture(actor)).session.state).toBe("OPEN");
  }, 60_000);

  it("bounds uncertain allocation backlog independently of freed active upload slots", async () => {
    const actor = await register();
    vi.mocked(storage.createMultipartUpload).mockRejectedValue(
      Error("Synthetic unknown allocation"),
    );
    for (let index = 0; index < 10; index++)
      expect(success(await create(actor)).session.state).toBe("UNRESOLVED");
    await expect(
      db.$transaction((tx) => assertUploadSessionCapacity(tx, actor.accountId, actor.channelId)),
    ).rejects.toMatchObject({ code: "UPLOAD_ADMISSION_LIMIT" });
    expect((await create(actor)).statusCode).toBe(429);
    expect(storage.createMultipartUpload).toHaveBeenCalledTimes(10);
    expect(
      await db.mediaUploadSession.count({
        where: { state: { in: ["PREPARING", "OPEN", "FINALIZING"] } },
      }),
    ).toBe(0);
  });

  it("journals one immutable dispatch, rejects duplicate/foreign/frozen writes, and preserves a delayed acknowledgement", async () => {
    const f = await claimed(),
      journal = app.get(MediaOutputWriteJournalService);
    const receipt = await dispatch(f.job);
    expect(
      await db.mediaProcessingOutputWrite.findUniqueOrThrow({ where: { id: receipt.id } }),
    ).toMatchObject({
      status: "DISPATCHED",
      expectedSizeBytes: BigInt(bytes),
      objectKey: f.job.outputR2ObjectKey,
    });
    await expect(dispatch(f.job)).rejects.toThrow();
    await expect(dispatch(f.job, "hls/../../foreign.ts", "video/mp2t")).rejects.toThrow();
    await journal.markUnknown(receipt);
    await freeze(f.job);
    await expect(dispatch(f.job, "thumbnail.jpg", "image/jpeg")).rejects.toThrow();
    await expect(journal.acknowledge({ ...receipt, id: randomUUID() })).rejects.toThrow();
    await journal.acknowledge(receipt);
    expect(
      await db.mediaProcessingOutputWrite.findUniqueOrThrow({ where: { id: receipt.id } }),
    ).toMatchObject({ status: "ACKNOWLEDGED", acknowledgedAt: expect.any(Date) });
    await expect(
      db.mediaProcessingOutputWrite.update({
        where: { id: receipt.id },
        data: { expectedSizeBytes: 1n },
      }),
    ).rejects.toThrow();
    await expect(
      db.mediaProcessingOutputWrite.delete({ where: { id: receipt.id } }),
    ).rejects.toThrow();
    expect(await db.mediaProcessingOutputWrite.count()).toBe(1);
  });

  it.each(["DISPATCHED", "UNKNOWN"] as const)(
    "does not settle an absent output whose PUT remains %s",
    async (status) => {
      const f = await claimed(),
        receipt = await dispatch(f.job);
      if (status === "UNKNOWN") await app.get(MediaOutputWriteJournalService).markUnknown(receipt);
      await freeze(f.job);
      await db.privacyMediaDeletionJob.update({
        where: { operationKey: `output-attempt:${f.job.currentOutputAttemptId}` },
        data: { retainUntil: new Date(Date.now() - 365 * day) },
      });
      await db.mediaProcessingJob.update({
        where: { id: f.job.id },
        data: { status: "FAILED", leaseOwner: null, leaseExpiresAt: null },
      });
      await cleanup();
      const job = await db.privacyMediaDeletionJob.findUniqueOrThrow({
        where: { operationKey: `output-attempt:${f.job.currentOutputAttemptId}` },
      });
      expect(job.cleanupContractVersion).toBe(2);
      expect(job.status).not.toBe("DONE");
      expect(job.target).toBe(f.job.outputR2ObjectKey);
      expect(
        await db.mediaProcessingOutputAttempt.findUnique({
          where: { id: f.job.currentOutputAttemptId! },
        }),
      ).not.toBeNull();
      expect(
        await db.mediaProcessingOutputWrite.findUniqueOrThrow({ where: { id: receipt.id } }),
      ).toMatchObject({ status });
      await app.get(MediaOutputWriteJournalService).acknowledge(receipt);
      await due();
      await cleanup();
      expect(
        (await db.privacyMediaDeletionJob.findUniqueOrThrow({ where: { id: job.id } })).status,
      ).toBe("DONE");
    },
  );

  it("freezes privacy output dispatch while an existing PUT acknowledgement is still in flight", async () => {
    grantSeconds = 2;
    const f = await claimed(),
      journal = app.get(MediaOutputWriteJournalService);
    const saved = await source(f.session),
      receipt = await dispatch(f.job),
      release = deferred();
    const delayedPut = (async () => {
      await release.promise;
      objects.set(receipt.objectKey, {
        sizeBytes: bytes,
        contentType: "video/mp4",
        etag: '"late-put"',
      });
      await journal.acknowledge(receipt);
    })();
    try {
      const request = await db.accountDeletionRequest.create({
        data: {
          accountId: f.actor.accountId,
          state: "DEACTIVATED",
          deactivatedAt: new Date(Date.now() - 2 * day),
        },
      });
      expect(await app.get(PrivacyLifecycleService).advanceDue(new Date(), 1)).toBe(1);
      expect(
        await db.mediaProcessingJob.findUniqueOrThrow({ where: { id: f.job.id } }),
      ).toMatchObject({ status: "CANCELLED", leaseOwner: null, inputIntegrityDigest: null });
      expect(
        (
          await db.mediaProcessingOutputAttempt.findUniqueOrThrow({
            where: { id: f.job.currentOutputAttemptId! },
          })
        ).writesFrozenAt,
      ).toBeInstanceOf(Date);
      await expect(dispatch(f.job, "thumbnail.jpg", "image/jpeg")).rejects.toThrow();
      await cleanup();
      const obligation = await db.privacyMediaDeletionJob.findUniqueOrThrow({
        where: { operationKey: `output-attempt:${f.job.currentOutputAttemptId}` },
      });
      expect(obligation).toMatchObject({
        requestId: request.id,
        cleanupContractVersion: 2,
        status: "PENDING",
        debtKind: "UNKNOWN_WRITE",
      });
      expect(
        (await db.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } }))
          .mediaCleanupCompletedAt,
      ).toBeNull();
      release.resolve();
      await delayedPut;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, saved.lastGrantExpiresAt!.getTime() - Date.now()) + 30),
      );
      await due();
      await cleanup();
      await due();
      await cleanup();
      expect(objects.has(receipt.objectKey)).toBe(false);
      expect(
        (await db.privacyMediaDeletionJob.findUniqueOrThrow({ where: { id: obligation.id } }))
          .status,
      ).toBe("DONE");
      expect(
        (await db.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } }))
          .mediaCleanupCompletedAt,
      ).toBeInstanceOf(Date);
    } finally {
      release.resolve();
      await delayedPut;
    }
  });

  it("settles the exact acknowledged losing attempt without deleting winning playback", async () => {
    const f = await claimed(),
      first = f.job,
      receipt = await dispatch(first);
    await app.get(MediaOutputWriteJournalService).acknowledge(receipt);
    objects.set(first.outputR2ObjectKey, {
      sizeBytes: bytes,
      contentType: "video/mp4",
      etag: '"loser"',
    });
    expect(
      await app.get(MediaProcessingLifecycleService).recordCanonicalVerification({
        jobId: first.id,
        workerId: first.leaseOwner!,
        ...capturedMediaClaim(first),
        identity: identity(),
      }),
    ).toBe(true);
    const losingThumbnailReceipt = await dispatch(first, "thumbnail.jpg", "image/jpeg");
    await app.get(MediaOutputWriteJournalService).acknowledge(losingThumbnailReceipt);
    const losingThumbnailKey = first.outputR2ObjectKey.replace(/canonical\.mp4$/, "thumbnail.jpg");
    const losingThumbnail = await db.mediaAsset.create({
      data: {
        channelId: f.actor.channelId,
        videoId: first.videoId,
        kind: "THUMBNAIL",
        status: "PENDING",
        r2ObjectKey: losingThumbnailKey,
        mimeType: "image/jpeg",
        sizeBytes: BigInt(bytes),
      },
    });
    objects.set(losingThumbnailKey, {
      sizeBytes: bytes,
      contentType: "image/jpeg",
      etag: '"losing-thumbnail"',
    });
    await db.mediaProcessingJob.update({
      where: { id: first.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    const winner = await app.get(MediaProcessingQueueService).claimNext("finite-v2-replacement");
    expect(winner?.currentOutputAttemptId).not.toBe(first.currentOutputAttemptId);
    expect(winner?.outputR2ObjectKey).not.toBe(first.outputR2ObjectKey);
    objects.set(winner!.outputR2ObjectKey, {
      sizeBytes: bytes,
      contentType: "video/mp4",
      etag: '"winner"',
    });
    const lifecycle = app.get(MediaProcessingLifecycleService);
    expect(
      await lifecycle.recordInputVerification({
        jobId: winner!.id,
        workerId: winner!.leaseOwner!,
        ...capturedMediaClaim(winner!),
        identity: identity(),
      }),
    ).toBe(true);
    const winnerReceipt = await dispatch(winner!);
    await app.get(MediaOutputWriteJournalService).acknowledge(winnerReceipt);
    expect(
      await lifecycle.recordCanonicalVerification({
        jobId: winner!.id,
        workerId: winner!.leaseOwner!,
        ...capturedMediaClaim(winner!),
        identity: identity(),
      }),
    ).toBe(true);
    const ready = await lifecycle.finalizeReady({
      jobId: winner!.id,
      workerId: winner!.leaseOwner!,
      ...capturedMediaClaim(winner!),
      metadata: { sizeBytes: bytes, durationMs: 1000, width: 640, height: 360 },
    });
    expect(ready?.asset.r2ObjectKey).toBe(winner!.outputR2ObjectKey);
    await cleanup();
    expect(objects.has(first.outputR2ObjectKey)).toBe(false);
    expect(objects.has(losingThumbnailKey)).toBe(false);
    expect(
      (await db.mediaAsset.findUniqueOrThrow({ where: { id: losingThumbnail.id } })).status,
    ).toBe("REMOVED");
    expect(objects.has(winner!.outputR2ObjectKey)).toBe(true);
    expect(storage.deletePrefix).not.toHaveBeenCalled();
    const cleanupJob = await db.privacyMediaDeletionJob.findUniqueOrThrow({
      where: { operationKey: `output-attempt:${first.currentOutputAttemptId}` },
    });
    expect(cleanupJob).toMatchObject({
      status: "DONE",
      cleanupContractVersion: 2,
      observedAbsentAt: expect.any(Date),
      cleanupEvidence: expect.objectContaining({
        version: "AYIN_CLEANUP_V2",
        conclusion: "FROZEN_ACKNOWLEDGED_AND_OBSERVED_ABSENT",
        operationKey: cleanupJob.operationKey,
      }),
    });
  });

  it("requires terminal abort and post-grant-cutoff exact observations for an ordinary cancellation", async () => {
    grantSeconds = 2;
    const f = await fixture();
    success(await command(f.actor, f.session, "authorize", { partNumber: 1 }));
    const saved = await source(f.session);
    const neighbor = `${saved.objectKey}.unrelated`;
    allocations.set("synthetic-neighbor", { key: neighbor, contentType: "video/mp4", parts: [] });
    objects.set(neighbor, { sizeBytes: bytes, contentType: "video/mp4", etag: '"neighbor"' });
    success(await command(f.actor, f.session, "cancel"));
    await cleanup();
    expect(
      await db.privacyMediaDeletionJob.count({
        where: { uploadSessionId: saved.id, status: "DONE" },
      }),
    ).toBe(0);
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, saved.lastGrantExpiresAt!.getTime() - Date.now()) + 30),
    );
    await due();
    await cleanup();
    await due();
    await cleanup();
    const jobs = await db.privacyMediaDeletionJob.findMany({
      where: { uploadSessionId: saved.id },
    });
    expect(jobs.length).toBeGreaterThanOrEqual(3);
    expect(jobs.every((job) => job.status === "DONE" && job.cleanupContractVersion === 2)).toBe(
      true,
    );
    const multipart = jobs.find((job) => job.kind === "MULTIPART")!;
    expect(multipart.cleanupEvidence).toMatchObject({
      version: "AYIN_CLEANUP_V2",
      abortUploadIdDigest: createHash("sha256").update(saved.providerUploadId!).digest("hex"),
      abortAcknowledgedAt: expect.any(String),
      sessionId: saved.id,
      sessionRevision: multipart.sessionRevision,
    });
    expect(multipart.observedAbsentAt!.getTime()).toBeGreaterThanOrEqual(
      saved.lastGrantExpiresAt!.getTime(),
    );
    expect(storage.abortMultipartUpload).toHaveBeenCalledWith({
      key: saved.objectKey,
      uploadId: saved.providerUploadId,
    });
    expect(allocations.has("synthetic-neighbor")).toBe(true);
    expect(objects.has(neighbor)).toBe(true);
    expect(storage.deletePrefix).not.toHaveBeenCalled();
  });

  it("reopens completed privacy and retained debt when an exact late object is observed", async () => {
    grantSeconds = 2;
    const f = await fixture();
    success(await command(f.actor, f.session, "authorize", { partNumber: 1 }));
    const saved = await source(f.session);
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, saved.lastGrantExpiresAt!.getTime() - Date.now()) + 30),
    );
    const request = await db.accountDeletionRequest.create({
      data: {
        accountId: f.actor.accountId,
        state: "ANONYMIZED",
        anonymizedAt: new Date(),
        mediaCleanupQueuedAt: new Date(),
      },
    });
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${f.actor.accountId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${saved.sourceAssetId}::uuid FOR NO KEY UPDATE`;
      await registerUploadCleanupInTransaction(tx, {
        sessionId: saved.id,
        accountId: f.actor.accountId,
        requestId: request.id,
        state: "REVOKED",
        now: new Date(),
      });
    });
    await cleanup();
    await due();
    await cleanup();
    expect(
      (await db.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } }))
        .mediaCleanupCompletedAt,
    ).toBeInstanceOf(Date);
    await expect(
      db.$transaction((tx) =>
        assertUploadDebtByteCapacity(tx, f.actor.accountId, f.actor.channelId, 0n, {
          account: bytes,
          channel: bytes,
        }),
      ),
    ).resolves.toBeUndefined();
    objects.set(saved.objectKey, {
      sizeBytes: bytes,
      contentType: "video/mp4",
      etag: '"late-residual"',
    });
    await db.privacyMediaDeletionJob.updateMany({
      where: { uploadSessionId: saved.id },
      data: { recheckAt: new Date(0) },
    });
    await cleanup();
    expect(
      (await db.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } }))
        .mediaCleanupCompletedAt,
    ).toBeNull();
    expect(
      await db.privacyMediaDeletionJob.count({
        where: {
          uploadSessionId: saved.id,
          status: { not: "DONE" },
          lastObservation: "LATE_OBJECT_FOUND",
        },
      }),
    ).toBeGreaterThan(0);
    expect(objects.has(saved.objectKey)).toBe(true);
    await expect(
      db.$transaction((tx) =>
        assertUploadDebtByteCapacity(tx, f.actor.accountId, f.actor.channelId, 0n, {
          account: bytes,
          channel: bytes,
        }),
      ),
    ).rejects.toMatchObject({ code: "UPLOAD_PHYSICAL_DEBT_LIMIT" });
    await due();
    await cleanup();
    expect(objects.has(saved.objectKey)).toBe(false);
    expect(
      (await db.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } }))
        .mediaCleanupCompletedAt,
    ).toBeInstanceOf(Date);
  });

  it("requires a final successful retention recheck before minimizing resolved source addresses", async () => {
    const f = await fixture(),
      retainUntil = new Date(Date.now() + 1800);
    const providerUploadId = (await source(f.session)).providerUploadId!;
    await db.mediaUploadSession.update({
      where: { id: f.session.sessionId },
      data: { cleanupRetainUntil: retainUntil },
    });
    success(await command(f.actor, f.session, "cancel"));
    await cleanup();
    await due();
    await cleanup();
    expect(
      await db.privacyMediaDeletionJob.count({
        where: { uploadSessionId: f.session.sessionId, status: { not: "DONE" } },
      }),
    ).toBe(0);
    await minimizeCompletedUploadCleanup(db, new Date(retainUntil.getTime() + day), 30);
    expect(await source(f.session)).not.toBeNull();
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, retainUntil.getTime() - Date.now()) + 30),
    );
    const head = vi.mocked(storage.headObject).getMockImplementation()!;
    vi.mocked(storage.headObject).mockRejectedValueOnce(new R2HttpError(503, "HEAD"));
    await cleanup();
    expect(await source(f.session)).not.toBeNull();
    expect(
      await db.privacyMediaDeletionJob.count({
        where: { uploadSessionId: f.session.sessionId, status: { not: "DONE" } },
      }),
    ).toBeGreaterThan(0);
    vi.mocked(storage.headObject).mockImplementation(head);
    await due();
    await cleanup();
    expect(
      await db.mediaUploadSession.findUnique({ where: { id: f.session.sessionId } }),
    ).toBeNull();
    const minimized = await db.privacyMediaDeletionJob.findMany({
      where: { uploadSessionId: f.session.sessionId },
    });
    expect(minimized.length).toBeGreaterThan(0);
    expect(JSON.stringify(minimized)).not.toContain(providerUploadId);
    expect(
      minimized.every(
        (job) =>
          job.status === "DONE" && job.target === null && job.observedAbsentAt! >= retainUntil,
      ),
    ).toBe(true);
  });

  it.each(["ACKNOWLEDGED", "UNKNOWN"] as const)(
    "bounds exact HLS cleanup per pass and revisits the entire %s write set",
    async (outcome) => {
      const f = await claimed(),
        journal = app.get(MediaOutputWriteJournalService);
      const canonical = await dispatch(f.job);
      await journal.acknowledge(canonical);
      expect(
        await app.get(MediaProcessingLifecycleService).recordCanonicalVerification({
          jobId: f.job.id,
          workerId: f.job.leaseOwner!,
          ...capturedMediaClaim(f.job),
          identity: identity(),
        }),
      ).toBe(true);
      let uncertain: Awaited<ReturnType<typeof dispatch>> | undefined;
      for (let index = 1; index <= 30; index++) {
        const receipt = await dispatch(
          f.job,
          `hls/360p/segment-${String(index).padStart(6, "0")}.ts`,
          "video/mp2t",
        );
        if (outcome === "UNKNOWN" && index === 30) {
          uncertain = receipt;
          await journal.markUnknown(receipt);
        } else await journal.acknowledge(receipt);
        objects.set(receipt.objectKey, {
          sizeBytes: bytes,
          contentType: "video/mp2t",
          etag: '"segment"',
        });
      }
      await freeze(f.job);
      await db.mediaProcessingJob.update({
        where: { id: f.job.id },
        data: { status: "FAILED", leaseOwner: null, leaseExpiresAt: null },
      });
      vi.mocked(storage.deleteObject).mockClear();
      await cleanup(1);
      expect(storage.deleteObject).toHaveBeenCalledTimes(25);
      expect(
        await db.privacyMediaDeletionJob.findUniqueOrThrow({
          where: { operationKey: `output-attempt:${f.job.currentOutputAttemptId}` },
        }),
      ).toMatchObject({ status: "PENDING", lastObservation: "EXACT_OBSERVATION_IN_PROGRESS" });
      await due();
      await cleanup(1);
      expect(objects.size).toBe(1); // Original accepted source remains live.
      if (uncertain) {
        expect(
          (
            await db.privacyMediaDeletionJob.findUniqueOrThrow({
              where: { operationKey: `output-attempt:${f.job.currentOutputAttemptId}` },
            })
          ).status,
        ).toBe("PENDING");
        // A full sweep visits the last key despite uncertainty, then the next slow
        // reconciliation must restart and see a late write at that same exact key.
        objects.set(uncertain.objectKey, {
          sizeBytes: bytes,
          contentType: "video/mp2t",
          etag: '"late-unknown-segment"',
        });
        await due();
        await cleanup(1);
        await due();
        await cleanup(1);
        expect(objects.has(uncertain.objectKey)).toBe(false);
        expect(
          (
            await db.privacyMediaDeletionJob.findUniqueOrThrow({
              where: { operationKey: `output-attempt:${f.job.currentOutputAttemptId}` },
            })
          ).status,
        ).toBe("PENDING");
        await journal.acknowledge(uncertain);
        await due();
        await cleanup(1);
        await due();
        await cleanup(1);
      }
      expect(
        (
          await db.privacyMediaDeletionJob.findUniqueOrThrow({
            where: { operationKey: `output-attempt:${f.job.currentOutputAttemptId}` },
          })
        ).status,
      ).toBe("DONE");
      expect(storage.deletePrefix).not.toHaveBeenCalled();
    },
  );

  it("preserves a populated V1 required-job PUT lane with rollout disabled and zero V2 debt budgets", async () => {
    const actor = await register();
    const video = await db.video.create({
      data: {
        channelId: actor.channelId,
        slug: `historical-${randomUUID()}`,
        title: "Historical required source",
        status: "VALIDATING",
      },
    });
    const asset = await db.mediaAsset.create({
      data: {
        channelId: actor.channelId,
        videoId: video.id,
        kind: "SOURCE_VIDEO",
        status: "UPLOADED",
        r2ObjectKey: `channels/${actor.channelId}/media/${randomUUID()}/source.mp4`,
        mimeType: "video/mp4",
        sizeBytes: BigInt(bytes),
      },
    });
    const session = await db.mediaUploadSession.create({
      data: {
        sourceAssetId: asset.id,
        initiatingAccountId: actor.accountId,
        channelId: actor.channelId,
        videoId: video.id,
        authority: "OWNER",
        mode: "SINGLE",
        state: "COMPLETED",
        objectKey: asset.r2ObjectKey,
        sizeBytes: BigInt(bytes),
        mimeType: "video/mp4",
        partSizeBytes: BigInt(partSizeBytes),
        contentIdentityAlgorithm: identity().algorithm,
        contentIdentityDigest: identity().rootSha256,
        hardExpiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    expect(session.sourceProtocolVersion).toBe(1);
    const config = app.get<MediaStorageConfig>(MEDIA_STORAGE_CONFIG);
    const previous = {
      recoveryV2Enabled: config.recoveryV2Enabled,
      recoveryDebtAccountBytes: config.recoveryDebtAccountBytes,
      recoveryDebtChannelBytes: config.recoveryDebtChannelBytes,
    };
    Object.assign(config, {
      recoveryV2Enabled: false,
      recoveryDebtAccountBytes: 0,
      recoveryDebtChannelBytes: 0,
    });
    const directory = await mkdtemp(join(tmpdir(), "ayin-finite-v1-compat-"));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    try {
      const enqueued = await app
        .get(MediaProcessingLifecycleService)
        .enqueueUploadedAsset(asset.id);
      expect(enqueued?.outputProtocolVersion).toBe(1);
      const job = (await app
        .get(MediaProcessingQueueService)
        .claimNext("compatible-historical-worker"))!;
      expect(
        (
          await db.mediaProcessingOutputAttempt.findUniqueOrThrow({
            where: { id: job.currentOutputAttemptId! },
          })
        ).protocolVersion,
      ).toBe(1);
      expect(
        await app.get(MediaProcessingLifecycleService).recordInputVerification({
          jobId: job.id,
          workerId: job.leaseOwner!,
          ...capturedMediaClaim(job),
          identity: identity(),
        }),
      ).toBe(true);
      const path = join(directory, "canonical.mp4");
      await writeFile(path, Buffer.alloc(bytes));
      vi.mocked(storage.authorizeSinglePut).mockResolvedValue({
        url: "https://synthetic.invalid/legacy-worker-put",
        expiresAt: new Date(Date.now() + 60_000),
      });
      const workerStorage = new MediaProcessingStorageService(
        storage,
        { ...config, mode: "r2" },
        app.get(MediaOutputWriteJournalService),
      );
      const context = { jobId: job.id, workerId: job.leaseOwner!, ...capturedMediaClaim(job) };
      await expect(
        workerStorage.uploadFile(job.outputR2ObjectKey, path, "video/mp4", context),
      ).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://synthetic.invalid/legacy-worker-put",
        expect.objectContaining({
          method: "PUT",
          headers: { "content-type": "video/mp4", "content-length": String(bytes) },
        }),
      );
      expect(await db.mediaProcessingOutputWrite.count()).toBe(0);
      await expect(
        workerStorage.uploadFile(job.outputR2ObjectKey, path, "video/mp4", {
          ...context,
          workerId: "foreign-worker",
        }),
      ).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await freeze(job);
      expect(
        (
          await db.mediaProcessingOutputAttempt.findUniqueOrThrow({
            where: { id: job.currentOutputAttemptId! },
          })
        ).writesFrozenAt,
      ).toBeNull();
      expect(
        await db.privacyMediaDeletionJob.count({ where: { scope: "PROCESSING_OUTPUT" } }),
      ).toBe(0);
      await db.accountDeletionRequest.create({
        data: {
          accountId: actor.accountId,
          state: "DEACTIVATED",
          deactivatedAt: new Date(Date.now() - 2 * day),
        },
      });
      expect(await app.get(PrivacyLifecycleService).advanceDue(new Date(), 1)).toBe(1);
      await cleanup();
      expect(
        await db.privacyMediaDeletionJob.findUniqueOrThrow({
          where: { operationKey: `processing-outputs:${job.id}` },
        }),
      ).toMatchObject({
        cleanupContractVersion: 1,
        status: "PENDING",
        lastObservation: "OUTPUT_SETTLEMENT_UNVERIFIED",
      });
      expect(await db.mediaProcessingOutputWrite.count()).toBe(0);
    } finally {
      Object.assign(config, previous);
      fetchMock.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects an old integrity worker that lacks the V2 output-journal capability", async () => {
    const f = await accepted();
    const job = await db.mediaProcessingJob.findFirstOrThrow({
      where: { videoId: f.session.videoId! },
    });
    expect(job.outputProtocolVersion).toBe(2);
    const outputAttemptId = randomUUID();
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('ayin.media_integrity_worker_version', '2', true)`;
        await tx.mediaProcessingOutputAttempt.create({
          data: {
            id: outputAttemptId,
            processingJobId: job.id,
            channelId: f.actor.channelId,
            videoId: job.videoId,
            generation: job.generation,
            claimToken: `old-worker:${randomUUID()}`,
            attempt: job.attempt + 1,
            ...outputAttemptAddresses({
              channelId: f.actor.channelId,
              videoId: job.videoId,
              generation: job.generation,
              outputAttemptId,
            }),
          },
        });
      }),
    ).rejects.toThrow();
    expect(await db.mediaProcessingOutputAttempt.count()).toBe(0);
    expect(
      (await app.get(MediaProcessingQueueService).claimNext("compatible-finite-worker"))?.id,
    ).toBe(job.id);
  });

  it("rejects missing or malformed finite source evidence under an otherwise valid PostgreSQL cleanup lease", async () => {
    const f = await fixture();
    success(await command(f.actor, f.session, "cancel"));
    const session = await source(f.session);
    const row = await db.privacyMediaDeletionJob.findFirstOrThrow({
      where: { uploadSessionId: session.id, kind: "OBJECT" },
    });
    const claim = await claimExactly(row.id);
    const snapshot = finiteSourceSnapshot(
      session,
      await db.mediaUploadOperation.findMany({ where: { sessionId: session.id } }),
      new Date(),
    );
    expect(snapshot.unresolved).toBeNull();
    const evidence = finiteEvidence(claim, snapshot);
    await expect(db.$executeRaw`UPDATE "PrivacyMediaDeletionJob" SET status='DONE', "completedAt"=${new Date()},
      "settlementProofReference"='synthetic:old-worker-delete-only', "settlementVerifiedAt"=${new Date()},
      "settlementLeaseToken"=${claim.leaseToken}::uuid WHERE id=${claim.id}::uuid`).rejects.toThrow();
    const mandatory = [
      "version",
      "conclusion",
      "operationKey",
      "kind",
      "writeSetDigest",
      "leaseToken",
      "attempt",
      "observedAbsentAt",
      "sessionId",
      "sessionRevision",
    ] as const;
    for (const key of mandatory) {
      const missing: Record<string, unknown> = { ...evidence };
      delete missing[key];
      await expect(rawDone(claim, missing), `missing ${key}`).rejects.toThrow();
      await expect(rawDone(claim, { ...evidence, [key]: null }), `null ${key}`).rejects.toThrow();
    }
    for (const writeSetDigest of ["", "a".repeat(63), "g".repeat(64)])
      await expect(rawDone(claim, { ...evidence, writeSetDigest })).rejects.toThrow();
    for (const patch of [
      { operationKey: "wrong-operation" },
      { kind: "ALLOCATION" },
      { leaseToken: randomUUID() },
      { attempt: claim.attempts + 1 },
      { sessionId: randomUUID() },
      { sessionRevision: session.revision + 1 },
      { observedAbsentAt: new Date(0).toISOString() },
    ])
      await expect(rawDone(claim, { ...evidence, ...patch })).rejects.toThrow();
    await expect(
      rawDone(claim, evidence, { settlementLeaseToken: randomUUID() }),
    ).rejects.toThrow();
    await expect(rawDone(claim, evidence, { attempts: claim.attempts + 1 })).rejects.toThrow();
    await expect(
      rawDone(claim, evidence, { sessionRevision: session.revision + 1 }),
    ).rejects.toThrow();
    await expect(
      rawDone(claim, evidence, { observedAbsentAt: new Date(Date.now() + day) }),
    ).rejects.toThrow();
    await expect(rawDone(claim, {})).rejects.toThrow();
    await db.privacyMediaDeletionJob.update({ where: { id: claim.id }, data: { claimedAt: null } });
    await expect(rawDone(claim, evidence)).rejects.toThrow(/current exact cleanup lease/);
    await db.privacyMediaDeletionJob.update({
      where: { id: claim.id },
      data: { claimedAt: new Date(0) },
    });
    await expect(
      rawDone(
        claim,
        { ...evidence, observedAbsentAt: new Date(0).toISOString() },
        { observedAbsentAt: new Date(0) },
      ),
    ).rejects.toThrow(/Unaccounted source writes/);
    await db.privacyMediaDeletionJob.update({
      where: { id: claim.id },
      data: { claimedAt: claim.claimedAt },
    });
    // SQL enforces the evidence shape; the authoritative application fence also
    // recomputes the frozen write set instead of accepting a well-formed hash.
    expect(
      await finishFiniteMediaCleanupJob(db, claim, { ...evidence, writeSetDigest: "f".repeat(64) }),
    ).toBe(false);
    expect(
      (await db.privacyMediaDeletionJob.findUniqueOrThrow({ where: { id: claim.id } })).status,
    ).toBe("PROCESSING");
    expect(await finishFiniteMediaCleanupJob(db, claim, evidence)).toBe(true);
  });

  it("rejects missing or mismatched source and output rows rather than treating null lookups as settled", async () => {
    const f = await fixture();
    success(await command(f.actor, f.session, "cancel"));
    const session = await source(f.session);
    for (const target of [
      "missing-source",
      "mismatched-source-key",
      "mismatched-source-channel",
    ] as const) {
      const row = await db.privacyMediaDeletionJob.create({
        data: {
          operationKey: `synthetic:${randomUUID()}`,
          scope: "UPLOAD_SESSION",
          kind: "OBJECT",
          channelId: target === "mismatched-source-channel" ? randomUUID() : session.channelId,
          uploadSessionId: target === "missing-source" ? randomUUID() : session.id,
          sessionRevision: session.revision,
          target:
            target === "mismatched-source-key"
              ? `${session.objectKey}.different`
              : session.objectKey,
          cleanupContractVersion: 2,
        },
      });
      const claim = await claimExactly(row.id);
      const evidence = finiteEvidence(claim, {
        writeSetDigest: "a".repeat(64),
        keys: [row.target!],
        uploadIds: [],
        unresolved: null,
        observationFloor: new Date(0),
      });
      await expect(rawDone(claim, evidence), target).rejects.toThrow(/Unaccounted source writes/);
    }
    const output = await claimed();
    const receipt = await dispatch(output.job);
    await app.get(MediaOutputWriteJournalService).acknowledge(receipt);
    await freeze(output.job);
    await db.mediaProcessingJob.update({
      where: { id: output.job.id },
      data: { status: "FAILED", leaseOwner: null, leaseExpiresAt: null },
    });
    for (const target of [
      "missing-output",
      "mismatched-output-job",
      "mismatched-output-key",
      "mismatched-output-channel",
    ] as const) {
      const outputAttemptId =
        target === "missing-output" ? randomUUID() : output.job.currentOutputAttemptId!;
      const row = await db.privacyMediaDeletionJob.create({
        data: {
          operationKey: `synthetic:${randomUUID()}`,
          scope: "PROCESSING_OUTPUT",
          kind: "OUTPUT_SETTLEMENT",
          channelId: target === "mismatched-output-channel" ? randomUUID() : output.actor.channelId,
          processingJobId: target === "mismatched-output-job" ? randomUUID() : output.job.id,
          outputAttemptId,
          target:
            target === "mismatched-output-key"
              ? `${output.job.outputR2ObjectKey}.different`
              : output.job.outputR2ObjectKey,
          outputAddresses: { version: 3, attemptIds: [outputAttemptId] },
          cleanupContractVersion: 2,
        },
      });
      const claim = await claimExactly(row.id);
      const evidence = finiteEvidence(claim, {
        writeSetDigest: "a".repeat(64),
        keys: [row.target!],
        uploadIds: [],
        unresolved: null,
        observationFloor: new Date(0),
      });
      await expect(rawDone(claim, evidence), target).rejects.toThrow(/Unaccounted output writes/);
    }
  });

  it("rejects malformed exact output evidence and a stale write-set digest while retaining a valid claim", async () => {
    const f = await claimed(),
      receipt = await dispatch(f.job);
    await app.get(MediaOutputWriteJournalService).acknowledge(receipt);
    await freeze(f.job);
    await db.mediaProcessingJob.update({
      where: { id: f.job.id },
      data: { status: "FAILED", leaseOwner: null, leaseExpiresAt: null },
    });
    const row = await db.privacyMediaDeletionJob.findUniqueOrThrow({
      where: { operationKey: `output-attempt:${f.job.currentOutputAttemptId}` },
    });
    const claim = await claimExactly(row.id);
    const attempt = await db.mediaProcessingOutputAttempt.findUniqueOrThrow({
      where: { id: f.job.currentOutputAttemptId! },
    });
    const snapshot = finiteOutputSnapshot(
      attempt,
      await db.mediaProcessingOutputWrite.findMany({ where: { outputAttemptId: attempt.id } }),
    );
    const evidence = finiteEvidence(claim, snapshot);
    for (const key of [
      "version",
      "conclusion",
      "operationKey",
      "kind",
      "writeSetDigest",
      "leaseToken",
      "attempt",
      "observedAbsentAt",
      "outputAttemptId",
    ] as const) {
      const missing: Record<string, unknown> = { ...evidence };
      delete missing[key];
      await expect(rawDone(claim, missing), `missing output ${key}`).rejects.toThrow();
    }
    await expect(rawDone(claim, { ...evidence, outputAttemptId: randomUUID() })).rejects.toThrow(
      /Unaccounted output writes/,
    );
    await db.privacyMediaDeletionJob.update({ where: { id: claim.id }, data: { claimedAt: null } });
    await expect(rawDone(claim, evidence)).rejects.toThrow(/current exact cleanup lease/);
    await db.privacyMediaDeletionJob.update({
      where: { id: claim.id },
      data: { claimedAt: new Date(0) },
    });
    await expect(
      rawDone(
        claim,
        { ...evidence, observedAbsentAt: new Date(0).toISOString() },
        { observedAbsentAt: new Date(0) },
      ),
    ).rejects.toThrow(/Unaccounted output writes/);
    await db.privacyMediaDeletionJob.update({
      where: { id: claim.id },
      data: { claimedAt: claim.claimedAt },
    });
    expect(
      await finishFiniteMediaCleanupJob(db, claim, { ...evidence, writeSetDigest: "f".repeat(64) }),
    ).toBe(false);
    expect(
      await finishFiniteMediaCleanupJob(db, claim, {
        ...evidence,
        exactObjectCount: snapshot.keys.length + 1,
      }),
    ).toBe(false);
    expect(
      await finishFiniteMediaCleanupJob(db, claim, {
        ...evidence,
        observationStartedAt: new Date(0).toISOString(),
      }),
    ).toBe(false);
    expect(await finishFiniteMediaCleanupJob(db, claim, evidence)).toBe(true);
  });

  it("cannot restore a cancelled source's grant authority or rebind its retained custody references", async () => {
    const f = await fixture(),
      other = await fixture();
    success(await command(f.actor, f.session, "cancel"));
    const saved = await source(f.session);
    for (const data of [
      { state: "OPEN" as const },
      { grantReservationCount: { increment: 1 } },
      { lastGrantExpiresAt: new Date(Date.now() + day) },
    ]) {
      await expect(db.mediaUploadSession.update({ where: { id: saved.id }, data })).rejects.toThrow(
        /Frozen finite sources cannot regain grant authority/,
      );
    }
    await expect(
      db.mediaUploadSession.update({
        where: { id: saved.id },
        data: { initiatingAccountId: other.actor.accountId },
      }),
    ).rejects.toThrow(/Finite source references allow detachment only/);
    await expect(
      db.mediaUploadSession.update({
        where: { id: saved.id },
        data: { sourceAssetId: other.session.assetId },
      }),
    ).rejects.toThrow(/Finite source references allow detachment only/);
    await db.mediaUploadSession.update({
      where: { id: saved.id },
      data: { initiatingAccountId: null, sourceAssetId: null },
    });
    await expect(
      db.mediaUploadSession.update({
        where: { id: saved.id },
        data: {
          initiatingAccountId: saved.initiatingAccountId,
          sourceAssetId: saved.sourceAssetId,
        },
      }),
    ).rejects.toThrow(/Finite source references allow detachment only/);
    expect((await source(f.session)).state).toBe("ABORTED");
  });

  it("rejects an old cleanup worker's DELETE-only DONE update for V2 source and output obligations", async () => {
    const f = await fixture();
    success(await command(f.actor, f.session, "cancel"));
    const sourceJob = await db.privacyMediaDeletionJob.findFirstOrThrow({
      where: { uploadSessionId: f.session.sessionId },
    });
    expect(sourceJob.cleanupContractVersion).toBe(2);
    await expect(
      db.privacyMediaDeletionJob.update({
        where: { id: sourceJob.id },
        data: {
          status: "DONE",
          completedAt: new Date(),
          settlementProofReference: "synthetic:old-v1",
          settlementVerifiedAt: new Date(),
          settlementLeaseToken: randomUUID(),
        },
      }),
    ).rejects.toThrow();
    const output = await claimed();
    await freeze(output.job);
    await expect(
      db.privacyMediaDeletionJob.update({
        where: { operationKey: `output-attempt:${output.job.currentOutputAttemptId}` },
        data: { status: "DONE", completedAt: new Date() },
      }),
    ).rejects.toThrow();
    await expect(
      db.mediaUploadSession.update({
        where: { id: f.session.sessionId },
        data: { sourceProtocolVersion: 1 },
      }),
    ).rejects.toThrow();
  });
});
