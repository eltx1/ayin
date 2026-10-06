import { capturedMediaClaim } from "../src/media/media-output-attempt.js";
import { MediaProcessingQueueService } from "../src/media/media-processing-queue.service.js";
import { PlatformSettingsService } from "../src/platform-config/platform-settings.service.js";
import "reflect-metadata";
import { hashUploadFileIdentity } from "@ayin/types";
import { randomUUID } from "node:crypto";
import { createPrismaClient, type MediaUploadSession } from "@ayin/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type DatabaseService } from "../src/database/database.service.js";
import { type PasswordService } from "../src/auth/password.service.js";
import { type AdminAuditLogService } from "../src/admin/admin-audit-log.service.js";
import {
  type MediaStorageAdapter,
  MediaStorageObservationError,
  type UploadCleanupSettlementBinding,
  type UploadCleanupSettlementEvidence,
} from "../src/media/media-storage.adapter.js";
import { R2HttpError } from "../src/media/r2-sigv4.js";
import {
  registerProcessingSourceCleanup,
  registerUploadCleanupInTransaction,
} from "../src/media/media-upload-cleanup.js";
import {
  claimMediaCleanupJob,
  finishMediaCleanupJob,
  minimizeCompletedUploadCleanup,
  processPrivacyMediaDeletionBatch,
  expireUploadSessions,
} from "../src/privacy/privacy-media-cleanup.js";
import { PrivacyLifecycleService } from "../src/privacy/privacy-lifecycle.service.js";
import { PrivacyExportService } from "../src/privacy/privacy-export.service.js";
import { MediaProcessingLifecycleService } from "../src/media/media-processing-lifecycle.service.js";

const url = process.env.TEST_DATABASE_URL;
const databaseDescribe = url ? describe : describe.skip;
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// No real provider connection exists in this suite. This explicit synthetic
// settlement protocol certifies test-state quiescence, never actual R2 behavior.
function fakeStorage() {
  const objects = new Set<string>();
  const allocations = new Map<string, string>();
  const storage: MediaStorageAdapter = {
    kind: "development",
    available: true,
    createMultipartUpload: vi.fn(),
    authorizeMultipartPart: vi.fn(),
    authorizeSinglePut: vi.fn(),
    completeMultipartUpload: vi.fn(),
    listParts: vi.fn(async ({ key, uploadId }) => {
      if (allocations.get(uploadId) !== key)
        throw new MediaStorageObservationError("NO_SUCH_UPLOAD", "listParts", 404);
      return [];
    }),
    listMultipartUploads: vi.fn(async (prefix) =>
      [...allocations]
        .filter(([, key]) => key.startsWith(prefix))
        .map(([uploadId, key]) => ({ key, uploadId, initiatedAt: new Date() })),
    ),
    abortMultipartUpload: vi.fn(async ({ uploadId }) => {
      allocations.delete(uploadId);
    }),
    headObject: vi.fn(async (key) => {
      if (!objects.has(key)) throw new R2HttpError(404, "HEAD");
      return { sizeBytes: 7, contentType: "video/mp4", etag: '"fake"' };
    }),
    deleteObject: vi.fn(async (key) => {
      objects.delete(key);
    }),
    deletePrefix: vi.fn(async () => undefined),
  };
  return { storage, objects, allocations };
}
function proof(binding: UploadCleanupSettlementBinding): UploadCleanupSettlementEvidence {
  return {
    binding: { ...binding },
    conclusion: "NO_FUTURE_ALLOCATION_OR_WRITE",
    provenance: {
      provider: binding.provider,
      verifierVersion: "AYIN_UPLOAD_SETTLEMENT_V1",
      proofReference: "synthetic:no-inflight:v1",
    },
    verifiedAt: new Date(),
  };
}

databaseDescribe("Persisted upload cleanup and privacy on PostgreSQL", () => {
  const db = createPrismaClient(url);
  const database = { client: db } as DatabaseService;
  const queue = new MediaProcessingQueueService(database, new PlatformSettingsService(database));
  let fake: ReturnType<typeof fakeStorage>;
  let lifecycle: PrivacyLifecycleService;
  beforeEach(async () => {
    await db.$executeRawUnsafe(
      'TRUNCATE TABLE "Account", "Channel", "MediaUploadSession", "AccountDeletionRequest", "PrivacyMediaDeletionJob", "MediaProcessingOutputAttempt" CASCADE',
    );
    fake = fakeStorage();
    lifecycle = new PrivacyLifecycleService(
      database,
      {} as PasswordService,
      {} as AdminAuditLogService,
      fake.storage,
    );
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  async function fixture(
    mode: "SINGLE" | "MULTIPART" = "MULTIPART",
    state: MediaUploadSession["state"] = "OPEN",
  ) {
    const account = await db.account.create({
      data: { email: `${randomUUID()}@example.invalid`, displayName: "Cleanup fixture" },
    });
    const channel = await db.channel.create({
      data: { handle: `cleanup-${randomUUID()}`, name: "Cleanup fixture" },
    });
    await db.channelMember.create({
      data: { accountId: account.id, channelId: channel.id, role: "OWNER" },
    });
    const video = await db.video.create({
      data: { channelId: channel.id, title: "Cleanup fixture", slug: `cleanup-${randomUUID()}` },
    });
    const asset = await db.mediaAsset.create({
      data: {
        channelId: channel.id,
        videoId: video.id,
        kind: "SOURCE_VIDEO",
        r2ObjectKey: `channels/${channel.id}/media/${randomUUID()}/source.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 7n,
      },
    });
    const session = await db.mediaUploadSession.create({
      data: {
        initiatingAccountId: account.id,
        channelId: channel.id,
        videoId: video.id,
        sourceAssetId: asset.id,
        authority: "OWNER",
        mode,
        state,
        objectKey: asset.r2ObjectKey,
        providerUploadId: mode === "SINGLE" || state === "PREPARING" ? null : "known-upload",
        sizeBytes: 7n,
        mimeType: "video/mp4",
        partSizeBytes: 5242880n,
        contentIdentityAlgorithm: "AYIN_SHA256_CHUNKS_V1",
        contentIdentityDigest: "a".repeat(64),
        hardExpiresAt: new Date(Date.now() + 3600000),
        lastGrantExpiresAt: new Date(Date.now() - 1000),
      },
    });
    return { account, channel, video, asset, session };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function revoke(
    f: Fixture,
    state: "REVOKED" | "ABORTED" | "EXPIRED" = "ABORTED",
    requestId?: string,
  ) {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${f.account.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "MediaAsset" WHERE id=${f.asset.id}::uuid FOR NO KEY UPDATE`;
      await registerUploadCleanupInTransaction(tx, {
        sessionId: f.session.id,
        accountId: f.account.id,
        state,
        ...(requestId ? { requestId } : {}),
        now: new Date(),
      });
    });
  }
  async function jobs(f: Fixture) {
    return db.privacyMediaDeletionJob.findMany({
      where: { uploadSessionId: f.session.id },
      orderBy: { operationKey: "asc" },
    });
  }
  async function run(limit = 20) {
    return processPrivacyMediaDeletionBatch(db, fake.storage, new Date(), limit);
  }
  async function dueAgain() {
    await db.privacyMediaDeletionJob.updateMany({
      where: { status: "PENDING" },
      data: { availableAt: new Date(Date.now() - 1000) },
    });
  }
  async function deletion(f: Fixture) {
    return db.accountDeletionRequest.create({
      data: {
        accountId: f.account.id,
        state: "DEACTIVATED",
        deactivatedAt: new Date(Date.now() - 2 * 86400000),
      },
    });
  }

  async function foreignAdmin(f: Fixture) {
    const admin = await db.account.create({
      data: { email: `${randomUUID()}@admin.invalid`, displayName: "Foreign initiating admin" },
    });
    await db.adminRoleAssignment.create({ data: { accountId: admin.id, role: "OPERATIONS" } });
    await db.channel.update({ where: { id: f.channel.id }, data: { isPlatformOwned: true } });
    await db.mediaUploadSession.update({
      where: { id: f.session.id },
      data: { initiatingAccountId: admin.id, authority: "ADMIN" },
    });
    return admin;
  }
  async function anonymizeAccount(accountId: string) {
    const request = await db.accountDeletionRequest.create({
      data: { accountId, state: "DEACTIVATED", deactivatedAt: new Date(Date.now() - 2 * 86400000) },
    });
    await lifecycle.advanceDue(new Date(), 1);
    return request;
  }
  async function identityOf(bytes: Buffer) {
    return hashUploadFileIdentity(
      (async function* () {
        yield bytes;
      })(),
      bytes.length,
    );
  }

  it.each([
    { timing: "before-processing", ownerless: false },
    { timing: "after-ready", ownerless: false },
    { timing: "before-processing", ownerless: true },
  ] as const)(
    "preserves channel-owned COMPLETED media when its initiating admin is deleted $timing (ownerless=$ownerless)",
    async ({ timing, ownerless }) => {
      const f = await fixture("MULTIPART", "COMPLETED");
      const admin = await foreignAdmin(f);
      if (ownerless)
        await db.channelMember.deleteMany({ where: { channelId: f.channel.id, role: "OWNER" } });
      const inputIdentity = await identityOf(Buffer.from("SOURCE!"));
      await db.mediaUploadSession.update({
        where: { id: f.session.id },
        data: { contentIdentityDigest: inputIdentity.rootSha256 },
      });
      await db.mediaAsset.update({ where: { id: f.asset.id }, data: { status: "UPLOADED" } });
      const processing = new MediaProcessingLifecycleService(database);
      const queued = (await processing.enqueueUploadedAsset(f.asset.id))!;
      const job = (await queue.claimNext("foreign-admin-custody-worker"))!;
      expect(job.id).toBe(queued.id);
      const workerId = job.leaseOwner!;
      const finish = async () => {
        expect(
          await processing.recordInputVerification({
            jobId: job.id,
            workerId,
            ...capturedMediaClaim(job),
            identity: inputIdentity,
          }),
        ).toBe(true);
        const outputIdentity = await identityOf(Buffer.from("CANONICAL"));
        expect(
          await processing.recordCanonicalVerification({
            jobId: job.id,
            workerId,
            ...capturedMediaClaim(job),
            identity: outputIdentity,
          }),
        ).toBe(true);
        const ready = await processing.finalizeReady({
          jobId: job.id,
          workerId,
          ...capturedMediaClaim(job),
          metadata: {
            sizeBytes: outputIdentity.sizeBytes,
            durationMs: 1000,
            width: 16,
            height: 16,
          },
        });
        expect(ready).not.toBeNull();
        return ready!;
      };
      const readyBefore = timing === "after-ready" ? await finish() : null;
      const request = await anonymizeAccount(admin.id);
      if (timing === "before-processing") {
        expect(
          await db.mediaUploadSession.findUnique({ where: { id: f.session.id } }),
        ).toMatchObject({
          state: "COMPLETED",
          cleanupRequestedAt: null,
          contentIdentityDigest: inputIdentity.rootSha256,
        });
        expect(await db.mediaAsset.findUnique({ where: { id: f.asset.id } })).toMatchObject({
          status: "UPLOADED",
          removedAt: null,
        });
      }
      const ready = readyBefore ?? (await finish());
      expect(await db.mediaProcessingJob.findUnique({ where: { id: job.id } })).toMatchObject({
        status: "READY",
        inputIntegrityAccountId: admin.id,
        inputIntegrityRedactedAt: null,
      });
      expect(await db.mediaAsset.findUnique({ where: { id: ready.asset.id } })).toMatchObject({
        status: "VALIDATED",
        removedAt: null,
      });
      expect(await db.channel.findUnique({ where: { id: f.channel.id } })).toMatchObject({
        status: "ACTIVE",
        removedAt: null,
      });
      expect(await db.account.findUnique({ where: { id: f.account.id } })).toMatchObject({
        status: "ACTIVE",
      });
      const cleanup = await jobs(f);
      expect(cleanup.map((item) => item.kind).sort()).toEqual([
        "ALLOCATION",
        "MULTIPART",
        "OBJECT",
      ]);
      expect(
        cleanup.every(
          (item) =>
            item.scope === "PROCESSING_SOURCE" &&
            item.processingJobId === job.id &&
            item.accountId === null &&
            item.requestId === null,
        ),
      ).toBe(true);
      expect(await db.privacyMediaDeletionJob.count({ where: { requestId: request.id } })).toBe(0);
      expect(
        await db.accountDeletionRequest.findUnique({ where: { id: request.id } }),
      ).toMatchObject({ mediaCleanupCompletedAt: expect.any(Date) });
    },
  );

  it("revokes a foreign admin's OPEN grant without deleting its owner's channel", async () => {
    const f = await fixture("SINGLE", "OPEN");
    const admin = await foreignAdmin(f);
    const request = await anonymizeAccount(admin.id);
    expect(await db.mediaUploadSession.findUnique({ where: { id: f.session.id } })).toMatchObject({
      state: "REVOKED",
      contentIdentityDigest: null,
    });
    expect(await db.mediaAsset.findUnique({ where: { id: f.asset.id } })).toMatchObject({
      status: "REMOVED",
    });
    expect(await db.channel.findUnique({ where: { id: f.channel.id } })).toMatchObject({
      status: "ACTIVE",
      removedAt: null,
    });
    expect((await jobs(f))[0]).toMatchObject({
      scope: "UPLOAD_SESSION",
      requestId: request.id,
      accountId: admin.id,
    });
    expect(await db.accountDeletionRequest.findUnique({ where: { id: request.id } })).toMatchObject(
      { mediaCleanupCompletedAt: null },
    );
  });

  it("still cancels and redacts foreign-admin accepted input when the actual channel owner is deleted", async () => {
    const f = await fixture("SINGLE", "COMPLETED");
    await foreignAdmin(f);
    await db.mediaAsset.update({ where: { id: f.asset.id }, data: { status: "UPLOADED" } });
    const job = (await new MediaProcessingLifecycleService(database).enqueueUploadedAsset(
      f.asset.id,
    ))!;
    const request = await anonymizeAccount(f.account.id);
    expect(await db.mediaUploadSession.findUnique({ where: { id: f.session.id } })).toMatchObject({
      state: "REVOKED",
    });
    expect(await db.mediaProcessingJob.findUnique({ where: { id: job.id } })).toMatchObject({
      status: "CANCELLED",
      inputIntegrityDigest: null,
      inputIntegrityRedactedAt: expect.any(Date),
    });
    expect(
      await db.privacyMediaDeletionJob.findUnique({
        where: { operationKey: `processing-outputs:${job.id}` },
      }),
    ).toMatchObject({ requestId: request.id, kind: "OUTPUT_SETTLEMENT" });
  });

  it("keeps deterministic unique obligations across repeated cancel and privacy adoption", async () => {
    const f = await fixture();
    await revoke(f);
    await revoke(f);
    expect((await jobs(f)).map((job) => job.kind).sort()).toEqual([
      "ALLOCATION",
      "MULTIPART",
      "OBJECT",
    ]);
    const request = await deletion(f);
    await lifecycle.advanceDue(new Date(), 1);
    const adopted = await jobs(f);
    expect(adopted).toHaveLength(3);
    expect(adopted.every((job) => job.requestId === request.id)).toBe(true);
    const session = await db.mediaUploadSession.findUniqueOrThrow({ where: { id: f.session.id } });
    expect(session).toMatchObject({ state: "REVOKED", contentIdentityDigest: null });
    expect(adopted.every((job) => job.sessionRevision === session.revision)).toBe(true);
    expect(await db.accountDeletionRequest.findUnique({ where: { id: request.id } })).toMatchObject(
      { state: "ANONYMIZED", mediaCleanupCompletedAt: null },
    );
  });

  it("reconciles a lost PREPARING create into every exact upload ID, never a prefix neighbor", async () => {
    const f = await fixture("MULTIPART", "PREPARING");
    fake.allocations.set("lost-a", f.session.objectKey);
    fake.allocations.set("lost-b", f.session.objectKey);
    fake.allocations.set("neighbor", `${f.session.objectKey}.other`);
    await revoke(f);
    await run();
    expect(
      (await jobs(f))
        .filter((job) => job.kind === "MULTIPART")
        .map((job) => job.providerUploadId)
        .sort(),
    ).toEqual(["lost-a", "lost-b"]);
    expect(fake.allocations.has("neighbor")).toBe(true);
    expect((await jobs(f)).every((job) => job.status !== "DONE")).toBe(true);
    expect(fake.storage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it("adopts multiple discovered multipart IDs at the same key without nullable uniqueness collisions", async () => {
    const f = await fixture("MULTIPART", "PREPARING");
    fake.allocations.set("lost-before-privacy-a", f.session.objectKey);
    fake.allocations.set("lost-before-privacy-b", f.session.objectKey);
    await revoke(f);
    await run();
    const request = await deletion(f);
    await lifecycle.advanceDue(new Date(), 1);
    const multipart = (await jobs(f)).filter((job) => job.kind === "MULTIPART");
    expect(multipart).toHaveLength(2);
    expect(
      multipart.every((job) => job.requestId === request.id && job.target === f.session.objectKey),
    ).toBe(true);
    expect(new Set(multipart.map((job) => job.operationKey)).size).toBe(2);
    await revoke(f, "REVOKED", request.id);
    expect((await jobs(f)).filter((job) => job.kind === "MULTIPART")).toHaveLength(2);
  });

  it("does not treat successful DELETE, abort, expiry or absence as final settlement", async () => {
    const f = await fixture();
    fake.allocations.set("known-upload", f.session.objectKey);
    fake.objects.add(f.session.objectKey);
    await revoke(f);
    await run();
    expect(fake.storage.deleteObject).toHaveBeenCalled();
    expect(fake.storage.abortMultipartUpload).toHaveBeenCalled();
    expect((await jobs(f)).every((job) => job.status !== "DONE")).toBe(true);
    fake.objects.add(f.session.objectKey); // delayed presigned PUT after the first deletion
    await dueAgain();
    await run();
    expect((await jobs(f)).every((job) => job.status !== "DONE")).toBe(true);
  });

  it("keeps lost allocation discoverable when provider success arrives after privacy revocation", async () => {
    const f = await fixture("MULTIPART", "PREPARING");
    const request = await deletion(f);
    await lifecycle.advanceDue(new Date(), 1);
    await run();
    fake.allocations.set("late-create-response", f.session.objectKey);
    await dueAgain();
    await run();
    expect(
      (await jobs(f)).find((job) => job.providerUploadId === "late-create-response"),
    ).toMatchObject({ requestId: request.id, kind: "MULTIPART" });
    expect(await db.accountDeletionRequest.findUnique({ where: { id: request.id } })).toMatchObject(
      { mediaCleanupCompletedAt: null },
    );
  });

  it("distinguishes missing multipart from a final object still present", async () => {
    const f = await fixture();
    await revoke(f);
    fake.objects.add(f.session.objectKey);
    fake.storage.verifyUploadCleanupSettlement = vi.fn(async (binding) => proof(binding));
    const all = await jobs(f);
    await db.privacyMediaDeletionJob.updateMany({
      where: { id: { in: all.filter((j) => j.kind !== "MULTIPART").map((j) => j.id) } },
      data: { availableAt: new Date(Date.now() + 3600000) },
    });
    await run(1);
    expect((await jobs(f)).find((job) => job.kind === "MULTIPART")).toMatchObject({
      status: "PENDING",
      lastError: "OBJECT_PRESENT",
    });
    expect(fake.storage.abortMultipartUpload).not.toHaveBeenCalled();
  });

  it.each([
    "PROVIDER_ERROR",
    "INVALID_RESPONSE",
    "OBSERVATION_LIMIT_EXCEEDED",
    "OBSERVATION_TIMEOUT",
  ] as const)("keeps %s unresolved without partial inventory adoption", async (code) => {
    const f = await fixture("MULTIPART", "PREPARING");
    await revoke(f);
    vi.mocked(fake.storage.listMultipartUploads).mockRejectedValue(
      new MediaStorageObservationError(code, "listMultipartUploads"),
    );
    await run();
    expect((await jobs(f)).find((job) => job.kind === "ALLOCATION")).toMatchObject({
      status: "PENDING",
      lastError: code,
    });
    expect((await jobs(f)).some((job) => job.kind === "MULTIPART")).toBe(false);
  });

  it("claims once across actual PostgreSQL contenders and fences an older lease/attempt", async () => {
    const f = await fixture("SINGLE");
    await revoke(f);
    const claims = await Promise.all([
      claimMediaCleanupJob(db, new Date()),
      claimMediaCleanupJob(db, new Date()),
    ]);
    const first = claims.find((claim) => claim !== null)!;
    expect(claims.filter(Boolean)).toHaveLength(1);
    await db.privacyMediaDeletionJob.update({
      where: { id: first.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    const second = (await claimMediaCleanupJob(db, new Date()))!;
    expect(second.attempts).toBe(first.attempts + 1);
    expect(second.leaseToken).not.toBe(first.leaseToken);
    const currentSession = await db.mediaUploadSession.findUniqueOrThrow({
      where: { id: f.session.id },
    });
    const staleProof = proof({
      provider: fake.storage.kind,
      operationKey: first.operationKey,
      kind: "OBJECT",
      key: first.target,
      uploadId: null,
      sessionId: currentSession.id,
      sessionRevision: currentSession.revision,
      mode: currentSession.mode,
      grantsRevokedAt: currentSession.grantsRevokedAt!.toISOString(),
      lastGrantExpiresAt: currentSession.lastGrantExpiresAt!.toISOString(),
      leaseToken: first.leaseToken,
      attempt: first.attempts,
    });
    expect(await finishMediaCleanupJob(db, first, new Date(), staleProof)).toBe(false);
    expect(await db.privacyMediaDeletionJob.findUnique({ where: { id: first.id } })).toMatchObject({
      status: "PROCESSING",
      leaseToken: second.leaseToken,
    });
  });

  it("rejects an expired cleanup lease even when the PostgreSQL session timezone is not UTC", async () => {
    const f = await fixture("SINGLE");
    const request = await db.accountDeletionRequest.create({
      data: { accountId: f.account.id, state: "ANONYMIZED", mediaCleanupQueuedAt: new Date() },
    });
    await db.privacyMediaDeletionJob.create({
      data: {
        accountId: f.account.id,
        requestId: request.id,
        kind: "OBJECT",
        target: "legacy/timezone.mp4",
      },
    });
    const claim = (await claimMediaCleanupJob(db, new Date()))!;
    await db.privacyMediaDeletionJob.update({
      where: { id: claim.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    const connection = new URL(url!);
    connection.searchParams.set("options", "-c timezone=Pacific/Honolulu");
    const zoned = createPrismaClient(connection.toString());
    try {
      const rows = await zoned.$queryRaw<
        Array<{ zone: string }>
      >`SELECT current_setting('TimeZone') AS zone`;
      expect(rows[0]!.zone).toBe("Pacific/Honolulu");
      expect(await finishMediaCleanupJob(zoned, claim)).toBe(false);
    } finally {
      await zoned.$disconnect();
    }
    expect(await db.privacyMediaDeletionJob.findUnique({ where: { id: claim.id } })).toMatchObject({
      status: "PROCESSING",
    });
  });

  it("privacy progresses while provider work is paused, adopts its obligation and fences stale completion", async () => {
    const f = await fixture("SINGLE");
    await revoke(f);
    const entered = deferred(),
      release = deferred();
    fake.storage.verifyUploadCleanupSettlement = vi.fn(async (binding) => {
      entered.resolve();
      await release.promise;
      return proof(binding);
    });
    const worker = run(1);
    await entered.promise;
    const request = await deletion(f);
    try {
      await lifecycle.advanceDue(new Date(), 1);
      expect(
        await db.accountDeletionRequest.findUnique({ where: { id: request.id } }),
      ).toMatchObject({ state: "ANONYMIZED", mediaCleanupCompletedAt: null });
    } finally {
      release.resolve();
      await worker;
    }
    expect((await jobs(f))[0]).toMatchObject({ requestId: request.id, status: "PENDING" });
    await dueAgain();
    await run();
    expect(await db.accountDeletionRequest.findUnique({ where: { id: request.id } })).toMatchObject(
      { mediaCleanupCompletedAt: expect.any(Date) },
    );
  });

  it("does not let a stale provider failure requeue or fail a newer claim", async () => {
    const f = await fixture("SINGLE");
    await revoke(f);
    const entered = deferred(),
      release = deferred();
    vi.mocked(fake.storage.headObject).mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      throw Error("synthetic late provider failure");
    });
    const worker = run(1);
    await entered.promise;
    const old = (await jobs(f))[0]!;
    await db.privacyMediaDeletionJob.update({
      where: { id: old.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    const next = (await claimMediaCleanupJob(db, new Date()))!;
    try {
      expect(next.attempts).toBe(old.attempts + 1);
    } finally {
      release.resolve();
      await worker;
    }
    expect((await jobs(f))[0]).toMatchObject({
      status: "PROCESSING",
      attempts: next.attempts,
      leaseToken: next.leaseToken,
      lastError: null,
    });
  });

  it("makes a fifth claim revoked by privacy visibly exhausted rather than stranded PENDING", async () => {
    const f = await fixture("SINGLE");
    await revoke(f);
    const job = (await jobs(f))[0]!;
    await db.privacyMediaDeletionJob.update({ where: { id: job.id }, data: { attempts: 4 } });
    const fifth = (await claimMediaCleanupJob(db, new Date()))!;
    expect(fifth.attempts).toBe(5);
    const request = await deletion(f);
    await lifecycle.advanceDue(new Date(), 1);
    expect((await jobs(f))[0]).toMatchObject({
      status: "FAILED",
      attempts: 5,
      requestId: request.id,
    });
    expect(await lifecycle.status(f.account.id)).toMatchObject({
      mediaCleanup: { requiresReview: 1 },
    });
  });

  it("uses a fresh claim clock even when the caller's batch timestamp is already stale", async () => {
    const f = await fixture("SINGLE");
    await revoke(f);
    fake.storage.verifyUploadCleanupSettlement = vi.fn(async (binding) => proof(binding));
    await processPrivacyMediaDeletionBatch(db, fake.storage, new Date(Date.now() - 3600000), 20);
    expect((await jobs(f))[0]).toMatchObject({ status: "DONE", attempts: 1 });
  });

  it("rejects standalone cancellation after transfer acceptance without altering the processing source", async () => {
    const f = await fixture("SINGLE", "COMPLETED");
    await db.mediaAsset.update({ where: { id: f.asset.id }, data: { status: "UPLOADED" } });
    await expect(revoke(f)).rejects.toThrow("processing/privacy lifecycle");
    expect(await jobs(f)).toHaveLength(0);
    expect(await db.mediaUploadSession.findUnique({ where: { id: f.session.id } })).toMatchObject({
      state: "COMPLETED",
      revision: 1,
      contentIdentityDigest: "a".repeat(64),
    });
    expect(await db.mediaAsset.findUnique({ where: { id: f.asset.id } })).toMatchObject({
      status: "UPLOADED",
    });
  });

  it("privacy discovers exact allocation snapshots after source detachment", async () => {
    const f = await fixture("MULTIPART", "PREPARING");
    await db.mediaAsset.delete({ where: { id: f.asset.id } });
    const request = await deletion(f);
    await lifecycle.advanceDue(new Date(), 1);
    expect((await jobs(f)).map((job) => job.kind).sort()).toEqual(["ALLOCATION", "OBJECT"]);
    expect(
      (await jobs(f)).every(
        (job) => job.target === f.session.objectKey && job.requestId === request.id,
      ),
    ).toBe(true);
  });

  it("adopts unresolved obligations even after the source and session are detached", async () => {
    const f = await fixture("SINGLE");
    await revoke(f);
    await db.mediaAsset.delete({ where: { id: f.asset.id } });
    await db.mediaUploadSession.delete({ where: { id: f.session.id } });
    const request = await deletion(f);
    await lifecycle.advanceDue(new Date(), 1);
    expect((await jobs(f))[0]).toMatchObject({
      requestId: request.id,
      status: "PENDING",
      target: f.session.objectKey,
    });
    expect(await db.accountDeletionRequest.findUnique({ where: { id: request.id } })).toMatchObject(
      { mediaCleanupCompletedAt: null },
    );
  });

  it("expires sessions into durable cleanup before removing input eligibility and digest", async () => {
    const f = await fixture("SINGLE");
    const createdAt = new Date(Date.now() - 7200000),
      hardExpiresAt = new Date(Date.now() - 3600000);
    await db.mediaUploadSession.update({
      where: { id: f.session.id },
      data: { createdAt, hardExpiresAt },
    });
    await expireUploadSessions(db, new Date(), 10);
    expect(await db.mediaUploadSession.findUnique({ where: { id: f.session.id } })).toMatchObject({
      state: "EXPIRED",
      contentIdentityDigest: null,
      grantsRevokedAt: expect.any(Date),
    });
    expect((await jobs(f))[0]).toMatchObject({ kind: "OBJECT", status: "PENDING" });
    expect(await db.mediaAsset.findUnique({ where: { id: f.asset.id } })).toMatchObject({
      status: "REMOVED",
    });
  });

  it("preserves the raw account RESTRICT boundary for registered grant cleanup", async () => {
    const f = await fixture("SINGLE");
    await revoke(f);
    const original = (await jobs(f))[0]!;
    await expect(db.account.delete({ where: { id: f.account.id } })).rejects.toThrow();
    expect(await db.mediaUploadSession.findUnique({ where: { id: f.session.id } })).toMatchObject({
      initiatingAccountId: f.account.id,
      state: "ABORTED",
    });
    expect(
      await db.privacyMediaDeletionJob.findUnique({ where: { id: original.id } }),
    ).toMatchObject({
      accountId: f.account.id,
      uploadSessionId: f.session.id,
      status: "PENDING",
      target: f.session.objectKey,
    });
    await run();
    expect(
      await db.privacyMediaDeletionJob.findUnique({ where: { id: original.id } }),
    ).toMatchObject({ status: "PENDING", lastError: "SETTLEMENT_UNVERIFIED" });
  });

  it("does not strand expiry when source, initiating account and membership references disappear", async () => {
    const f = await fixture("SINGLE");
    await db.mediaAsset.delete({ where: { id: f.asset.id } });
    await db.account.delete({ where: { id: f.account.id } });
    await db.mediaUploadSession.update({
      where: { id: f.session.id },
      data: {
        createdAt: new Date(Date.now() - 7200000),
        hardExpiresAt: new Date(Date.now() - 3600000),
      },
    });
    await expireUploadSessions(db, new Date(), 10);
    expect((await jobs(f))[0]).toMatchObject({
      accountId: null,
      channelId: f.channel.id,
      uploadSessionId: f.session.id,
      target: f.session.objectKey,
    });
    expect(await db.mediaUploadSession.findUnique({ where: { id: f.session.id } })).toMatchObject({
      state: "EXPIRED",
      contentIdentityDigest: null,
    });
  });

  it("retains addresses through finite retries and blocks privacy completion after exhaustion", async () => {
    const f = await fixture("SINGLE");
    const request = await deletion(f);
    await lifecycle.advanceDue(new Date(), 1);
    for (let i = 0; i < 5; i++) {
      await dueAgain();
      await run();
    }
    const job = (await jobs(f))[0]!;
    expect(job).toMatchObject({
      attempts: 5,
      status: "FAILED",
      target: f.session.objectKey,
      lastError: "SETTLEMENT_UNVERIFIED",
    });
    await db.mediaUploadSession.update({
      where: { id: f.session.id },
      data: { cleanupRetainUntil: new Date(Date.now() - 1) },
    });
    await minimizeCompletedUploadCleanup(db, new Date(), 10);
    expect(await db.mediaUploadSession.findUnique({ where: { id: f.session.id } })).not.toBeNull();
    expect(await db.accountDeletionRequest.findUnique({ where: { id: request.id } })).toMatchObject(
      { mediaCleanupCompletedAt: null, lastError: expect.stringContaining("operator") },
    );
    expect(await lifecycle.status(f.account.id)).toMatchObject({
      mediaCleanup: { requiresReview: 1 },
    });
    expect(await run()).toBe(0);
  });

  it("rejects a quiescence proof for another revision or lease", async () => {
    const f = await fixture("SINGLE");
    await revoke(f);
    fake.storage.verifyUploadCleanupSettlement = vi.fn(async (binding) =>
      proof({ ...binding, sessionRevision: binding.sessionRevision + 1 }),
    );
    await run();
    expect((await jobs(f))[0]).toMatchObject({
      status: "PENDING",
      lastError: "INVALID_SETTLEMENT_EVIDENCE",
    });
  });

  it("adopts every orphan output attempt through channel custody after the video and job disappear", async () => {
    const f = await fixture("SINGLE", "COMPLETED");
    await db.mediaAsset.update({ where: { id: f.asset.id }, data: { status: "UPLOADED" } });
    const queued = (await new MediaProcessingLifecycleService(database).enqueueUploadedAsset(
      f.asset.id,
    ))!;
    const first = (await queue.claimNext("orphan-output"))!;
    await db.mediaProcessingJob.update({
      where: { id: first.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    await queue.claimNext("orphan-output");
    const attempts = await db.mediaProcessingOutputAttempt.findMany({
      where: { processingJobId: queued.id },
    });
    await db.video.delete({ where: { id: f.video.id } });
    expect(await db.mediaProcessingJob.findUnique({ where: { id: queued.id } })).toBeNull();
    const request = await anonymizeAccount(f.account.id);
    const barrier = await db.privacyMediaDeletionJob.findUniqueOrThrow({
      where: { operationKey: `processing-outputs:${queued.id}` },
    });
    expect(barrier).toMatchObject({
      requestId: request.id,
      kind: "OUTPUT_SETTLEMENT",
      status: "PENDING",
    });
    const addresses = barrier.outputAddresses as { prefixes: string[] };
    expect(addresses.prefixes).toEqual(
      expect.arrayContaining(attempts.map((attempt) => attempt.prefix)),
    );
    expect(
      await db.mediaProcessingOutputAttempt.findMany({ where: { processingJobId: queued.id } }),
    ).toHaveLength(2);
    expect(await db.accountDeletionRequest.findUnique({ where: { id: request.id } })).toMatchObject(
      { mediaCleanupCompletedAt: null },
    );
  });

  it("keeps output writers unresolved even after a valid source-key settlement proof", async () => {
    const f = await fixture("SINGLE", "COMPLETED");
    await db.mediaAsset.update({ where: { id: f.asset.id }, data: { status: "UPLOADED" } });
    const job = await new MediaProcessingLifecycleService(database).enqueueUploadedAsset(
      f.asset.id,
    );
    expect(job).not.toBeNull();
    const first = (await queue.claimNext("output-barrier"))!;
    await db.mediaProcessingJob.update({
      where: { id: first.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    const winner = (await queue.claimNext("output-barrier"))!;
    const attempts = await db.mediaProcessingOutputAttempt.findMany({
      where: { processingJobId: job!.id },
    });
    expect(attempts).toHaveLength(2);
    fake.objects.add(first.outputR2ObjectKey);
    fake.objects.add(winner.outputR2ObjectKey);
    const request = await deletion(f);
    await lifecycle.advanceDue(new Date(), 1);
    fake.storage.verifyUploadCleanupSettlement = vi.fn(async (binding) => proof(binding));
    await run();
    expect((await jobs(f)).every((item) => item.status === "DONE")).toBe(true);
    const barrier = await db.privacyMediaDeletionJob.findUniqueOrThrow({
      where: { operationKey: `processing-outputs:${job!.id}` },
    });
    expect(barrier).toMatchObject({
      kind: "OUTPUT_SETTLEMENT",
      requestId: request.id,
      status: "PENDING",
      lastError: "OUTPUT_SETTLEMENT_UNVERIFIED",
    });
    const addresses = barrier.outputAddresses as { objects: string[]; prefixes: string[] };
    for (const attempt of attempts) {
      expect(addresses.objects).toEqual(
        expect.arrayContaining([
          attempt.canonicalR2ObjectKey,
          attempt.thumbnailR2ObjectKey,
          `${attempt.hlsR2Prefix}master.m3u8`,
        ]),
      );
      expect(addresses.prefixes).toEqual(
        expect.arrayContaining([attempt.prefix, attempt.hlsR2Prefix]),
      );
    }
    fake.objects.add(first.outputR2ObjectKey); // an already-started output finishes after DELETE
    await dueAgain();
    await run();
    expect(await db.accountDeletionRequest.findUnique({ where: { id: request.id } })).toMatchObject(
      { mediaCleanupCompletedAt: null },
    );
    expect(
      vi
        .mocked(fake.storage.verifyUploadCleanupSettlement)
        .mock.calls.every(([binding]) => binding.key === f.session.objectKey),
    ).toBe(true);
    await expect(
      db.privacyMediaDeletionJob.update({
        where: { id: barrier.id },
        data: { status: "DONE", completedAt: new Date() },
      }),
    ).rejects.toThrow();
  });

  it("minimizes exact addresses only after proof, all obligations DONE and retention", async () => {
    const f = await fixture("SINGLE");
    await revoke(f);
    fake.storage.verifyUploadCleanupSettlement = vi.fn(async (binding) => proof(binding));
    await run();
    expect((await jobs(f))[0]).toMatchObject({
      status: "DONE",
      settlementProofReference: "synthetic:no-inflight:v1",
      settlementLeaseToken: expect.any(String),
    });
    await minimizeCompletedUploadCleanup(db, new Date(), 10);
    expect(await db.mediaUploadSession.findUnique({ where: { id: f.session.id } })).not.toBeNull();
    await db.mediaUploadSession.update({
      where: { id: f.session.id },
      data: { cleanupRetainUntil: new Date(Date.now() - 1) },
    });
    await minimizeCompletedUploadCleanup(db, new Date(), 10);
    expect(await db.mediaUploadSession.findUnique({ where: { id: f.session.id } })).toBeNull();
    expect((await jobs(f))[0]).toMatchObject({
      status: "DONE",
      target: null,
      providerUploadId: null,
      sourceAssetId: null,
    });
  });

  it("does not let an older unresolved session starve verified retention with a small batch", async () => {
    const blocked = await fixture("SINGLE"),
      complete = await fixture("SINGLE");
    await revoke(blocked);
    await revoke(complete);
    await db.privacyMediaDeletionJob.updateMany({
      where: { uploadSessionId: blocked.session.id },
      data: { availableAt: new Date(Date.now() + 3600000) },
    });
    fake.storage.verifyUploadCleanupSettlement = vi.fn(async (binding) => proof(binding));
    await run();
    await db.mediaUploadSession.update({
      where: { id: blocked.session.id },
      data: { cleanupRetainUntil: new Date(Date.now() - 2000) },
    });
    await db.mediaUploadSession.update({
      where: { id: complete.session.id },
      data: { cleanupRetainUntil: new Date(Date.now() - 1000) },
    });
    await minimizeCompletedUploadCleanup(db, new Date(), 1);
    expect(
      await db.mediaUploadSession.findUnique({ where: { id: blocked.session.id } }),
    ).not.toBeNull();
    expect(
      await db.mediaUploadSession.findUnique({ where: { id: complete.session.id } }),
    ).toBeNull();
  });

  it("registers processing source cleanup transactionally after READY without provider work", async () => {
    const f = await fixture("SINGLE", "COMPLETED");
    const input = {
      jobId: randomUUID(),
      accountId: f.account.id,
      sessionId: f.session.id,
      sourceAssetId: f.asset.id,
      stagingKey: f.session.objectKey,
      now: new Date(),
    };
    await expect(
      db.$transaction(async (tx) => {
        await registerProcessingSourceCleanup(tx, input);
        throw Error("simulated READY rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await jobs(f)).toHaveLength(0);
    await db.$transaction((tx) => registerProcessingSourceCleanup(tx, input));
    await db.$transaction((tx) => registerProcessingSourceCleanup(tx, input));
    expect(await jobs(f)).toHaveLength(1);
    expect((await jobs(f))[0]).toMatchObject({
      scope: "PROCESSING_SOURCE",
      processingJobId: input.jobId,
      target: f.session.objectKey,
    });
    expect(fake.storage.deleteObject).not.toHaveBeenCalled();
    expect(await db.mediaUploadSession.findUnique({ where: { id: f.session.id } })).toMatchObject({
      contentIdentityDigest: null,
    });
  });

  it("excludes upload IDs, object keys, digests and settlement internals from export", async () => {
    const f = await fixture();
    await revoke(f);
    const exported = JSON.stringify(await new PrivacyExportService(database).build(f.account.id));
    for (const secret of [
      f.session.objectKey,
      "known-upload",
      "a".repeat(64),
      "providerUploadId",
      "settlementProofReference",
    ])
      expect(exported).not.toContain(secret);
  });

  it("rejects old worker DELETE-only DONE updates at the database boundary", async () => {
    const f = await fixture("SINGLE");
    await revoke(f);
    const job = (await jobs(f))[0]!;
    await expect(
      db.privacyMediaDeletionJob.update({
        where: { id: job.id },
        data: { status: "DONE", completedAt: new Date() },
      }),
    ).rejects.toThrow();
    expect((await jobs(f))[0]).toMatchObject({ status: "PENDING" });
  });

  it("keeps legacy cleanup progressing after an incompatible worker's new-scope completion is rejected", async () => {
    const f = await fixture("SINGLE");
    await revoke(f);
    const durable = (await jobs(f))[0]!;
    await db.privacyMediaDeletionJob.update({
      where: { id: durable.id },
      data: { status: "PROCESSING", attempts: 1, claimedAt: new Date() },
    });
    await expect(
      db.privacyMediaDeletionJob.update({
        where: { id: durable.id },
        data: { status: "DONE", completedAt: new Date() },
      }),
    ).rejects.toThrow();
    const request = await db.accountDeletionRequest.create({
      data: { accountId: f.account.id, state: "ANONYMIZED", mediaCleanupQueuedAt: new Date() },
    });
    const legacy = await db.privacyMediaDeletionJob.create({
      data: {
        accountId: f.account.id,
        requestId: request.id,
        kind: "OBJECT",
        target: "legacy/private-source.mp4",
      },
    });
    await run();
    expect(await db.privacyMediaDeletionJob.findUnique({ where: { id: legacy.id } })).toMatchObject(
      { status: "DONE" },
    );
    expect(
      await db.privacyMediaDeletionJob.findUnique({ where: { id: durable.id } }),
    ).toMatchObject({ status: "PROCESSING", leaseToken: null });
  });

  it("verifies actual catalog delete/update actions for cleanup ownership and permitted reference changes", async () => {
    const catalog = await db.$queryRaw<
      Array<{
        tableName: string;
        constraintName: string;
        deleteAction: string;
        updateAction: string;
        definition: string;
      }>
    >`
      SELECT c.conrelid::regclass::text AS "tableName", c.conname AS "constraintName",
        c.confdeltype::text AS "deleteAction", c.confupdtype::text AS "updateAction",
        pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c WHERE c.contype='f' AND c.conrelid IN
        ('"PrivacyMediaDeletionJob"'::regclass, '"MediaUploadSession"'::regclass, '"MediaAsset"'::regclass, '"Video"'::regclass, '"AccountDeletionRequest"'::regclass)
      ORDER BY c.conrelid::regclass::text, c.conname`;
    expect(
      catalog.find((row) => row.constraintName === "PrivacyMediaDeletionJob_accountId_fkey"),
    ).toMatchObject({ deleteAction: "r", updateAction: "c" });
    expect(
      catalog.find((row) => row.constraintName === "PrivacyMediaDeletionJob_requestId_fkey"),
    ).toMatchObject({ deleteAction: "r", updateAction: "c" });
    expect(
      catalog.find((row) => row.constraintName === "AccountDeletionRequest_accountId_fkey"),
    ).toMatchObject({ deleteAction: "r", updateAction: "c" });
    expect(
      catalog.find((row) => row.constraintName === "MediaUploadSession_sourceAssetId_fkey"),
    ).toMatchObject({ deleteAction: "n", updateAction: "c" });
    expect(
      catalog.find((row) => row.constraintName === "MediaUploadSession_initiatingAccountId_fkey"),
    ).toMatchObject({ deleteAction: "n", updateAction: "c" });
    expect(catalog.find((row) => row.constraintName === "MediaAsset_channelId_fkey")).toMatchObject(
      { deleteAction: "c", updateAction: "c" },
    );
    expect(catalog.find((row) => row.constraintName === "Video_channelId_fkey")).toMatchObject({
      deleteAction: "r",
      updateAction: "c",
    });
    expect(catalog.filter((row) => row.tableName.includes("PrivacyMediaDeletionJob"))).toHaveLength(
      2,
    );
    const f = await fixture("SINGLE");
    await revoke(f);
    const original = (await jobs(f))[0]!;
    // Existing content blocks a direct channel delete; do not weaken that FK.
    await expect(db.channel.delete({ where: { id: f.channel.id } })).rejects.toThrow();
    await db.video.delete({ where: { id: f.video.id } });
    await db.channel.delete({ where: { id: f.channel.id } });
    expect(await db.mediaAsset.findUnique({ where: { id: f.asset.id } })).toBeNull();
    expect(await db.mediaUploadSession.findUnique({ where: { id: f.session.id } })).toMatchObject({
      sourceAssetId: null,
      channelId: f.channel.id,
      objectKey: f.session.objectKey,
    });
    expect(
      await db.privacyMediaDeletionJob.findUnique({ where: { id: original.id } }),
    ).toMatchObject({
      channelId: f.channel.id,
      sourceAssetId: f.asset.id,
      uploadSessionId: f.session.id,
      target: f.session.objectKey,
      status: "PENDING",
    });
    await db.mediaUploadSession.delete({ where: { id: f.session.id } });
    expect(
      await db.privacyMediaDeletionJob.findUnique({ where: { id: original.id } }),
    ).toMatchObject({ target: f.session.objectKey, status: "PENDING" });
  });

  it("rejects deletion of a request that would discard its retained cleanup obligations", async () => {
    const f = await fixture("SINGLE");
    const request = await anonymizeAccount(f.account.id);
    await expect(db.accountDeletionRequest.delete({ where: { id: request.id } })).rejects.toThrow();
    expect(
      await db.privacyMediaDeletionJob.count({ where: { requestId: request.id } }),
    ).toBeGreaterThan(0);
    expect(await db.accountDeletionRequest.findUnique({ where: { id: request.id } })).toMatchObject(
      { mediaCleanupCompletedAt: null },
    );
  });

  it("enforces standalone ownership at the database boundary, including explicit null revisions", async () => {
    const f = await fixture("SINGLE");
    await expect(
      db.privacyMediaDeletionJob.create({
        data: {
          accountId: f.account.id,
          scope: "UPLOAD_SESSION",
          channelId: f.channel.id,
          uploadSessionId: f.session.id,
          kind: "OBJECT",
          target: f.session.objectKey,
          sessionRevision: null,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.privacyMediaDeletionJob.create({
        data: { accountId: f.account.id, kind: "OBJECT", target: f.session.objectKey },
      }),
    ).rejects.toThrow();
  });
});
