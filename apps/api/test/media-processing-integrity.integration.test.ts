import { PrivacyLifecycleService } from "../src/privacy/privacy-lifecycle.service.js";
import { MediaAdaptiveProcessingService } from "../src/media/media-adaptive-processing.service.js";
import {
  hlsMasterObjectKey,
  hlsRenditionPlaylistObjectKey,
  hlsRenditionSegmentPrefix,
} from "../src/media/media-architecture-v2.js";
import {
  capturedMediaClaim,
  outputAttemptAddresses,
  outputAttemptNamespace,
} from "../src/media/media-output-attempt.js";
import "reflect-metadata";
import { createPrismaClient, type MediaProcessingJob } from "@ayin/db";
import { hashUploadFileIdentity } from "@ayin/types";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaProcessingLifecycleService } from "../src/media/media-processing-lifecycle.service.js";
import { MediaProcessingQueueService } from "../src/media/media-processing-queue.service.js";
import { MediaAdaptiveLifecycleService } from "../src/media/media-adaptive-lifecycle.service.js";
import { declareCompatibleIntegrityWorker } from "../src/media/media-processing-integrity-fence.js";
import { PlatformSettingsService } from "../src/platform-config/platform-settings.service.js";
import { mkdtemp, readFile, rm, writeFile, chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MediaAutoThumbnailService,
  autoThumbnailObjectKey,
} from "../src/media/media-auto-thumbnail.service.js";
import { MediaProcessingExecutorService } from "../src/media/media-processing-executor.service.js";
import { redactCancelledInputIntegrityInTransaction } from "../src/media/media-processing-integrity.js";
import type { MediaProbeMetadata } from "../src/media/media-probe.js";
import { publicMediaProcessingJob } from "../src/media/media-processing-status.js";

const databaseDescribe = process.env.TEST_DATABASE_URL ? describe : describe.skip;
databaseDescribe("durable worker byte identity and atomic readiness", () => {
  const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
  const database = { client: prisma } as never;
  const lifecycle = new MediaProcessingLifecycleService(database);
  const queue = new MediaProcessingQueueService(database, new PlatformSettingsService(database));
  const adaptive = new MediaAdaptiveLifecycleService(database);
  afterAll(async () => prisma.$disconnect());
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "Account", "Channel", "PlatformSetting", "PrivacyMediaDeletionJob", "MediaProcessingOutputAttempt" CASCADE',
    );
  });
  function thumbnailKey(job: MediaProcessingJob, channelId: string) {
    const ns = outputAttemptNamespace(job, channelId);
    return ns.outputAttemptId
      ? outputAttemptAddresses({ ...ns, outputAttemptId: ns.outputAttemptId }).thumbnailR2ObjectKey
      : autoThumbnailObjectKey(channelId, job.videoId);
  }
  async function waitForBlockedQuery(pattern: string) {
    const deadline = Date.now() + 1800;
    while (Date.now() < deadline) {
      const rows = await prisma.$queryRaw<
        Array<{ blocked: boolean }>
      >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE ${pattern}) AS blocked`;
      if (rows[0]?.blocked) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Expected blocked PostgreSQL query ${pattern}`);
  }
  async function fixture(
    suffix = "source",
    enqueue = true,
    byteLength?: number,
    adminInitiator = false,
    ownerlessPlatform = false,
  ) {
    const bytes = byteLength
      ? Buffer.alloc(byteLength, 67)
      : Buffer.from(`actual-selected-file-${suffix}`);
    const identity = await hashUploadFileIdentity(
      (async function* () {
        yield bytes;
      })(),
      bytes.length,
    );
    const account = await prisma.account.create({
      data: { email: `${suffix}@integrity.invalid`, displayName: "Integrity owner" },
    });
    const initiator = adminInitiator
      ? await prisma.account.create({
          data: {
            email: `${suffix}-admin@integrity.invalid`,
            displayName: "Former upload administrator",
          },
        })
      : account;
    const channel = await prisma.channel.create({
      data: {
        handle: suffix,
        name: "Integrity channel",
        status: "ACTIVE",
        isPlatformOwned: ownerlessPlatform,
        ...(ownerlessPlatform
          ? {}
          : { members: { create: { accountId: account.id, role: "OWNER" } } }),
      },
    });
    const video = await prisma.video.create({
      data: { channelId: channel.id, slug: suffix, title: "Integrity video", status: "VALIDATING" },
    });
    const asset = await prisma.mediaAsset.create({
      data: {
        channelId: channel.id,
        videoId: video.id,
        kind: "SOURCE_VIDEO",
        status: "UPLOADED",
        mimeType: "video/mp4",
        sizeBytes: BigInt(bytes.length),
        r2ObjectKey: `channels/${channel.id}/media/${video.id}/source.mp4`,
      },
    });
    const session = await prisma.mediaUploadSession.create({
      data: {
        sourceAssetId: asset.id,
        initiatingAccountId: initiator.id,
        channelId: channel.id,
        videoId: video.id,
        authority: adminInitiator ? "ADMIN" : "OWNER",
        mode: "SINGLE",
        objectKey: asset.r2ObjectKey,
        sizeBytes: asset.sizeBytes,
        mimeType: asset.mimeType,
        partSizeBytes: asset.sizeBytes,
        contentIdentityAlgorithm: identity.algorithm,
        contentIdentityDigest: identity.rootSha256,
        state: "COMPLETED",
        hardExpiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const job = enqueue ? await lifecycle.enqueueUploadedAsset(asset.id) : null;
    return { bytes, identity, account, initiator, channel, video, asset, session, job: job! };
  }
  async function claim(f: Awaited<ReturnType<typeof fixture>>) {
    const job = await queue.claimNext("integrity-worker");
    expect(job?.id).toBe(f.job.id);
    return job!;
  }
  async function verify(f: Awaited<ReturnType<typeof fixture>>, job: MediaProcessingJob) {
    expect(
      await lifecycle.recordInputVerification({
        jobId: job.id,
        workerId: job.leaseOwner!,
        ...capturedMediaClaim(job),
        identity: f.identity,
      }),
    ).toBe(true);
    const canonicalBytes = Buffer.from(`normalized-canonical-${f.video.id}`);
    const canonicalIdentity = await hashUploadFileIdentity(
      (async function* () {
        yield canonicalBytes;
      })(),
      canonicalBytes.length,
    );
    expect(
      await lifecycle.recordCanonicalVerification({
        jobId: job.id,
        workerId: job.leaseOwner!,
        ...capturedMediaClaim(job),
        identity: canonicalIdentity,
      }),
    ).toBe(true);
    return canonicalIdentity;
  }
  const metadata = (sizeBytes: number) => ({
    sizeBytes,
    durationMs: 1000,
    width: 640,
    height: 360,
  });

  it("copies immutable declarations and refuses detached/deleted sidecars before enqueue", async () => {
    const f = await fixture("detached", false);
    expect(
      (await prisma.mediaAsset.findUniqueOrThrow({ where: { id: f.asset.id } }))
        .uploadIntegrityRequired,
    ).toBe(true);
    await prisma.mediaUploadSession.update({
      where: { id: f.session.id },
      data: { sourceAssetId: null },
    });
    await expect(lifecycle.enqueueUploadedAsset(f.asset.id)).rejects.toThrow(
      /required upload integrity/i,
    );
    await prisma.mediaUploadSession.delete({ where: { id: f.session.id } });
    await expect(lifecycle.enqueueUploadedAsset(f.asset.id)).rejects.toThrow(
      /required upload integrity/i,
    );
    expect(await prisma.mediaProcessingJob.count()).toBe(0);
    await expect(
      prisma.mediaAsset.update({
        where: { id: f.asset.id },
        data: { uploadIntegrityRequired: false },
      }),
    ).rejects.toThrow();
  });
  it("keeps required declaration after sidecar deletion and never permits a downgrade or READY", async () => {
    const f = await fixture();
    const job = await claim(f);
    await prisma.mediaUploadSession.delete({ where: { id: f.session.id } });
    const current = await prisma.mediaProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(current.inputIntegrityDigest).toBe(f.identity.rootSha256);
    await expect(
      prisma.mediaProcessingJob.update({
        where: { id: job.id },
        data: { inputIntegrityVersion: 0, inputIntegrityDigest: null },
      }),
    ).rejects.toThrow();
    expect(
      await lifecycle.finalizeReady({
        jobId: job.id,
        workerId: job.leaseOwner!,
        ...capturedMediaClaim(job),
        metadata: metadata(f.bytes.length),
      }),
    ).toBeNull();
    expect(
      await lifecycle.recordInputVerification({
        jobId: job.id,
        workerId: job.leaseOwner!,
        ...capturedMediaClaim(job),
        identity: f.identity,
      }),
    ).toBe(false);
    expect(await prisma.mediaAsset.count({ where: { status: "VALIDATED" } })).toBe(0);
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: f.asset.id } })).status).toBe(
      "UPLOADED",
    );
  });
  it("lets old selectors keep claiming legacy jobs and rejects incompatible durable claims", async () => {
    const f = await fixture();
    expect(f.job.status).toBe("INTEGRITY_QUEUED");
    expect(publicMediaProcessingJob(f.job)?.status).toBe("QUEUED");
    const legacy = await prisma.mediaProcessingJob.create({
      data: {
        videoId: f.video.id,
        generation: 2,
        status: "QUEUED",
        sourceMimeType: "video/mp4",
        sourceSizeBytes: 1n,
        stagingKey: "legacy-source",
        inputR2ObjectKey: "legacy-source",
        outputR2ObjectKey: "legacy-output",
        queuedAt: new Date(),
      },
    });
    expect((await prisma.mediaProcessingJob.findFirst({ where: { status: "QUEUED" } }))?.id).toBe(
      legacy.id,
    );
    await expect(
      prisma.mediaProcessingJob.update({
        where: { id: f.job.id },
        data: {
          status: "PROCESSING",
          leaseOwner: "old-worker",
          leaseExpiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow();
    await prisma.mediaProcessingJob.update({
      where: { id: legacy.id },
      data: {
        status: "PROCESSING",
        leaseOwner: "old-worker",
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(
      (await prisma.mediaProcessingJob.findUniqueOrThrow({ where: { id: legacy.id } })).leaseOwner,
    ).toBe("old-worker");
    await prisma.mediaProcessingJob.update({
      where: { id: f.job.id },
      data: { status: "QUEUED", stage: "OLD_RETRY" },
    });
    expect(
      (await prisma.mediaProcessingJob.findUniqueOrThrow({ where: { id: f.job.id } })).status,
    ).toBe("INTEGRITY_QUEUED");
  });
  it("requires current verification at canonical, fallback, rendition, master and adaptive READY boundaries", async () => {
    const f = await fixture();
    const job = await claim(f);
    // Generation fixtures are legal PLANNED metadata; READY remains fenced.
    const generation = await prisma.mediaPlaybackGeneration.create({
      data: {
        videoId: job.videoId,
        generation: job.generation,
        processingJobId: job.id,
        processingVersion: 2,
        fallbackR2ObjectKey: job.outputR2ObjectKey,
        outputAttemptId: job.currentOutputAttemptId,
        hlsMasterR2ObjectKey: hlsMasterObjectKey(outputAttemptNamespace(job, f.channel.id)),
        renditions: {
          create: {
            identity: "360p",
            width: 640,
            height: 360,
            videoBitrateKbps: 800,
            audioBitrateKbps: 96,
            playlistR2ObjectKey: hlsRenditionPlaylistObjectKey(
              outputAttemptNamespace(job, f.channel.id),
              "360p",
            ),
            segmentR2Prefix: hlsRenditionSegmentPrefix(
              outputAttemptNamespace(job, f.channel.id),
              "360p",
            ),
          },
        },
      },
      include: { renditions: true },
    });
    const owned = {
      jobId: job.id,
      workerId: job.leaseOwner!,
      ...capturedMediaClaim(job),
      generationId: generation.id,
    };
    expect(await adaptive.markFallbackReadyIfOwned(owned)).toBe(false);
    expect(
      await adaptive.setRenditionStatusIfOwned({
        ...owned,
        renditionId: generation.renditions[0]!.id,
        status: "READY",
      }),
    ).toBe(false);
    expect(await adaptive.setMasterStatusIfOwned({ ...owned, status: "READY" })).toBe(false);
    expect(await adaptive.markReadyIfCompleteIfOwned(owned)).toBeNull();
    expect(
      await lifecycle.finalizeReady({
        jobId: job.id,
        workerId: job.leaseOwner!,
        ...capturedMediaClaim(job),
        metadata: metadata(f.bytes.length),
      }),
    ).toBeNull();
    await expect(
      prisma.mediaPlaybackGeneration.update({
        where: { id: generation.id },
        data: { fallbackStatus: "READY" },
      }),
    ).rejects.toThrow();
    await verify(f, job);
    expect(await adaptive.markFallbackReadyIfOwned(owned)).toBe(true);
    expect(
      await adaptive.setRenditionStatusIfOwned({
        ...owned,
        renditionId: generation.renditions[0]!.id,
        status: "READY",
      }),
    ).toBe(true);
    expect(await adaptive.setMasterStatusIfOwned({ ...owned, status: "READY" })).toBe(true);
    expect((await adaptive.markReadyIfCompleteIfOwned(owned))?.status).toBe("READY");
    // Privacy must be able to tombstone a previously READY generation after
    // cancellation; a readiness guard may never veto eligibility removal.
    await prisma.$transaction(async (tx) => {
      await tx.mediaProcessingJob.update({
        where: { id: job.id },
        data: { status: "CANCELLED", leaseOwner: null, leaseExpiresAt: null },
      });
      await redactCancelledInputIntegrityInTransaction(tx, [job.videoId], new Date());
      await tx.mediaPlaybackGeneration.update({
        where: { id: generation.id },
        data: { fallbackStatus: "REMOVED", hlsMasterStatus: "REMOVED" },
      });
      await tx.mediaPlaybackRendition.updateMany({
        where: { playbackGenerationId: generation.id },
        data: { status: "REMOVED" },
      });
    });
    expect(
      (await prisma.mediaPlaybackGeneration.findUniqueOrThrow({ where: { id: generation.id } }))
        .fallbackStatus,
    ).toBe("REMOVED");
  });
  it("persists READY and cleanup together, and derives reprocess identity from transformed canonical bytes", async () => {
    const f = await fixture();
    const job = await claim(f);
    const canonical = await verify(f, job);
    const ready = await lifecycle.finalizeReady({
      jobId: job.id,
      workerId: job.leaseOwner!,
      ...capturedMediaClaim(job),
      metadata: metadata(canonical.sizeBytes),
    });
    expect(ready?.job.status).toBe("READY");
    const cleanup = await prisma.privacyMediaDeletionJob.findUniqueOrThrow({
      where: { operationKey: `processing-source:${job.id}` },
    });
    expect(cleanup.target).toBe(f.asset.r2ObjectKey);
    expect(cleanup.status).toBe("PENDING");
    expect(
      (await prisma.mediaUploadSession.findUniqueOrThrow({ where: { id: f.session.id } }))
        .contentIdentityDigest,
    ).toBeNull();
    const next = await prisma.$transaction((tx) => lifecycle.createReprocessJob(tx, job.videoId));
    expect(next?.inputIntegrityDigest).toBe(canonical.rootSha256);
    expect(next?.inputIntegrityDigest).not.toBe(f.identity.rootSha256);
    expect(next?.inputIntegrityParentJobId).toBe(job.id);
    expect(next?.inputIntegritySourceAssetId).toBe(ready?.asset.id);
    expect(next?.inputR2ObjectKey).toBe(job.outputR2ObjectKey);
  });
  it("forgets old claim evidence on crash recovery and fences late verification", async () => {
    const f = await fixture();
    const first = await claim(f);
    await verify(f, first);
    await prisma.mediaProcessingJob.update({
      where: { id: first.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    const next = await queue.claimNext("replacement");
    expect(next?.id).toBe(first.id);
    expect(next?.inputVerifiedAt).toBeNull();
    expect(next?.outputIntegrityDigest).toBeNull();
    expect(
      await lifecycle.recordInputVerification({
        jobId: first.id,
        workerId: first.leaseOwner!,
        ...capturedMediaClaim(first),
        identity: f.identity,
      }),
    ).toBe(false);
    expect(
      await lifecycle.finalizeReady({
        jobId: first.id,
        workerId: next!.leaseOwner!,
        ...capturedMediaClaim(next!),
        metadata: metadata(f.bytes.length),
      }),
    ).toBeNull();
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: f.asset.id } })).status).toBe(
      "UPLOADED",
    );
    expect(await prisma.privacyMediaDeletionJob.count()).toBe(0);
  });
  it("rejects verification after source privacy removal or a newer generation", async () => {
    const f = await fixture();
    const job = await claim(f);
    await prisma.mediaAsset.update({
      where: { id: f.asset.id },
      data: { status: "REMOVED", removedAt: new Date() },
    });
    expect(
      await lifecycle.recordInputVerification({
        jobId: job.id,
        workerId: job.leaseOwner!,
        ...capturedMediaClaim(job),
        identity: f.identity,
      }),
    ).toBe(false);
    await prisma.mediaAsset.update({
      where: { id: f.asset.id },
      data: { status: "UPLOADED", removedAt: null },
    });
    await prisma.mediaPlaybackGeneration.create({
      data: {
        videoId: job.videoId,
        generation: 2,
        processingVersion: 2,
        fallbackR2ObjectKey: "newer-fallback",
        hlsMasterR2ObjectKey: "newer-master",
      },
    });
    expect(
      await lifecycle.recordInputVerification({
        jobId: job.id,
        workerId: job.leaseOwner!,
        ...capturedMediaClaim(job),
        identity: f.identity,
      }),
    ).toBe(false);
  });
  it("serializes privacy revocation against an in-flight READY transaction", async () => {
    const f = await fixture();
    const job = await claim(f);
    const canonical = await verify(f, job);
    let locked!: () => void;
    const lockReached = new Promise<void>((resolve) => {
      locked = resolve;
    });
    let release!: () => void;
    const releasePrivacy = new Promise<void>((resolve) => {
      release = resolve;
    });
    const privacy = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${f.account.id}::uuid FOR UPDATE`;
      locked();
      await releasePrivacy;
      await tx.account.update({ where: { id: f.account.id }, data: { status: "CLOSED" } });
      await tx.mediaAsset.update({
        where: { id: f.asset.id },
        data: { status: "REMOVED", removedAt: new Date() },
      });
      await tx.mediaProcessingJob.update({
        where: { id: job.id },
        data: { status: "CANCELLED", leaseOwner: null, leaseExpiresAt: null },
      });
    });
    await lockReached;
    const finishing = lifecycle.finalizeReady({
      jobId: job.id,
      workerId: job.leaseOwner!,
      ...capturedMediaClaim(job),
      metadata: metadata(canonical.sizeBytes),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await privacy;
    expect(await finishing).toBeNull();
    expect(await prisma.mediaAsset.count({ where: { status: "VALIDATED" } })).toBe(0);
  });
  it("rejects forged READY at the database fence even when a compatible worker omits verification", async () => {
    const f = await fixture();
    const job = await claim(f);
    await expect(
      prisma.$transaction(async (tx) => {
        await declareCompatibleIntegrityWorker(tx);
        await tx.mediaProcessingJob.update({
          where: { id: job.id },
          data: { status: "READY", leaseOwner: null, leaseExpiresAt: null },
        });
      }),
    ).rejects.toThrow();
    expect(
      (await prisma.mediaProcessingJob.findUniqueOrThrow({ where: { id: job.id } })).status,
    ).toBe("PROCESSING");
  });
  it("runs actual bytes through the executor with real PostgreSQL and rejects same-size source corruption despite an existing canonical", async () => {
    const f = await fixture("executor");
    const job = await claim(f);
    const directory = await mkdtemp(join(tmpdir(), "ayin-pg-integrity-"));
    const executable = join(directory, "fixture-transcode.cjs");
    await writeFile(
      executable,
      `#!${process.execPath}\nconst fs = require('node:fs'); const args = process.argv.slice(2); fs.writeFileSync(args[args.length - 1], Buffer.from('normalized-fixture-video'));\n`,
    );
    await chmod(executable, 0o700);
    vi.stubEnv("MEDIA_PROCESSING_WORKDIR", directory);
    vi.stubEnv("FFMPEG_PATH", executable);
    const corrupted = Buffer.from(f.bytes);
    corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 1;
    const objects = new Map([
      [f.asset.r2ObjectKey, corrupted],
      [job.outputR2ObjectKey, Buffer.from("unproven-canonical")],
    ]);
    const storage = {
      headObject: vi.fn(async (key: string) => {
        const bytes = objects.get(key);
        if (!bytes) throw new Error("not found");
        return { sizeBytes: bytes.length, contentType: "video/mp4" };
      }),
      downloadToFile: vi.fn(async (key: string, path: string) => {
        await writeFile(path, objects.get(key)!);
      }),
      uploadFile: vi.fn(async (key: string, path: string) => {
        objects.set(key, await readFile(path));
      }),
      deleteObject: vi.fn(),
    };
    const subject = new MediaProcessingExecutorService(
      queue,
      lifecycle,
      storage as never,
      { process: vi.fn() } as never,
      { ensureForCanonical: vi.fn().mockResolvedValue({ created: false }) } as never,
      new PlatformSettingsService(database),
    );
    const probe = vi
      .spyOn(subject as unknown as { probe(path: string): Promise<MediaProbeMetadata> }, "probe")
      .mockResolvedValue({
        durationMs: 1000,
        width: 640,
        height: 360,
        encodedWidth: 640,
        encodedHeight: 360,
        rotationDegrees: 0,
        videoCodec: "h264",
        audioCodec: "aac",
        hasAudio: true,
      });
    try {
      await subject.process(job, job.leaseOwner!);
      expect(probe).not.toHaveBeenCalled();
      expect(
        (await prisma.mediaProcessingJob.findUniqueOrThrow({ where: { id: job.id } })).status,
      ).toBe("INTEGRITY_QUEUED");
      expect(await prisma.mediaAsset.count({ where: { status: "VALIDATED" } })).toBe(0);
      objects.set(f.asset.r2ObjectKey, f.bytes);
      await prisma.mediaProcessingJob.update({
        where: { id: job.id },
        data: { queuedAt: new Date(0) },
      });
      const retry = await queue.claimNext("executor-retry");
      expect(retry?.id).toBe(job.id);
      await subject.process(retry!, retry!.leaseOwner!);
      const ready = await prisma.mediaProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(ready.status).toBe("READY");
      expect(ready.inputIntegrityDigest).toBe(f.identity.rootSha256);
      expect(ready.outputIntegrityDigest).not.toBe(f.identity.rootSha256);
      expect(
        await prisma.privacyMediaDeletionJob.count({
          where: { processingJobId: job.id, status: "PENDING" },
        }),
      ).toBe(1);
      expect(storage.deleteObject).not.toHaveBeenCalled();
      expect(objects.has(f.asset.r2ObjectKey)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("allows one-way cancellation fingerprint redaction but never a legacy downgrade or restart", async () => {
    const f = await fixture("redaction");
    const job = await claim(f);
    await verify(f, job);
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.mediaProcessingJob.update({
        where: { id: job.id },
        data: { status: "CANCELLED", leaseOwner: null, leaseExpiresAt: null },
      });
      await redactCancelledInputIntegrityInTransaction(tx, [job.videoId], now);
    });
    const redacted = await prisma.mediaProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(redacted.inputIntegrityVersion).toBe(1);
    expect(redacted.inputIntegrityDigest).toBeNull();
    expect(redacted.inputIntegrityRedactedAt).toEqual(now);
    expect(redacted.inputR2ObjectKey).toBe(job.inputR2ObjectKey);
    expect(redacted.outputIntegrityDigest).toBeNull();
    await expect(
      prisma.mediaProcessingJob.update({ where: { id: job.id }, data: { status: "QUEUED" } }),
    ).rejects.toThrow();
    await expect(
      prisma.mediaProcessingJob.update({
        where: { id: job.id },
        data: { inputIntegrityDigest: f.identity.rootSha256, inputIntegrityRedactedAt: null },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.mediaProcessingJob.update({
        where: { id: job.id },
        data: { inputIntegrityVersion: 0 },
      }),
    ).rejects.toThrow();
  });
  it("resets unproven unbound READY generation metadata when claiming its required job", async () => {
    const f = await fixture("unbound", false);
    // This preexisting namespace predates processing-job association.
    const generation = await prisma.mediaPlaybackGeneration.create({
      data: {
        videoId: f.video.id,
        generation: 1,
        status: "READY",
        fallbackStatus: "READY",
        hlsMasterStatus: "READY",
        fallbackR2ObjectKey: "unbound-fallback",
        hlsMasterR2ObjectKey: "unbound-master",
        readyAt: new Date(),
      },
    });
    // A valid, explicit fixture binds the existing namespace. The public
    // enqueue path intentionally advances beyond any prior playback generation.
    f.job = await prisma.mediaProcessingJob.create({
      data: {
        videoId: f.video.id,
        generation: 1,
        status: "INTEGRITY_QUEUED",
        sourceMimeType: f.asset.mimeType,
        sourceSizeBytes: f.asset.sizeBytes,
        stagingKey: f.asset.r2ObjectKey,
        inputR2ObjectKey: f.asset.r2ObjectKey,
        outputR2ObjectKey: "unbound-fallback",
        queuedAt: new Date(),
        inputIntegrityVersion: 1,
        inputIntegritySessionId: f.session.id,
        inputIntegritySourceAssetId: f.asset.id,
        inputIntegrityAccountId: f.account.id,
        inputIntegrityAlgorithm: f.identity.algorithm,
        inputIntegrityDigest: f.identity.rootSha256,
      },
    });
    await claim(f);
    const current = await prisma.mediaPlaybackGeneration.findUniqueOrThrow({
      where: { id: generation.id },
    });
    expect(current.status).toBe("BUILDING");
    expect(current.fallbackStatus).toBe("PLANNED");
    expect(current.hlsMasterStatus).toBe("PLANNED");
    await expect(
      prisma.mediaPlaybackGeneration.update({
        where: { id: generation.id },
        data: { status: "READY" },
      }),
    ).rejects.toThrow();
  });
  it("rejects FINALIZING enqueue and blocks revoked original sessions at verification/readiness", async () => {
    const f = await fixture("revoked", false);
    await prisma.mediaUploadSession.update({
      where: { id: f.session.id },
      data: { state: "FINALIZING" },
    });
    await expect(lifecycle.enqueueUploadedAsset(f.asset.id)).rejects.toThrow(
      /integrity declaration/i,
    );
    expect(await prisma.mediaProcessingJob.count()).toBe(0);
    await prisma.mediaUploadSession.update({
      where: { id: f.session.id },
      data: { state: "COMPLETED" },
    });
    f.job = (await lifecycle.enqueueUploadedAsset(f.asset.id))!;
    const job = await claim(f);
    const canonical = await verify(f, job);
    await prisma.mediaUploadSession.update({
      where: { id: f.session.id },
      data: { state: "REVOKED", contentIdentityDigest: null },
    });
    expect(
      await lifecycle.recordInputVerification({
        jobId: job.id,
        workerId: job.leaseOwner!,
        ...capturedMediaClaim(job),
        identity: f.identity,
      }),
    ).toBe(false);
    expect(
      await lifecycle.finalizeReady({
        jobId: job.id,
        workerId: job.leaseOwner!,
        ...capturedMediaClaim(job),
        metadata: metadata(canonical.sizeBytes),
      }),
    ).toBeNull();
    await expect(
      prisma.$transaction(async (tx) => {
        await declareCompatibleIntegrityWorker(tx);
        await tx.mediaProcessingJob.update({
          where: { id: job.id },
          data: {
            status: "READY",
            outputSizeBytes: BigInt(canonical.sizeBytes),
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
      }),
    ).rejects.toThrow();
  });
  it("rejects a different video/generation sidecar bound to an otherwise fully verified job", async () => {
    const f = await fixture("wrong-binding");
    const job = await claim(f);
    await verify(f, job);
    const other = await prisma.video.create({
      data: { channelId: f.channel.id, slug: "other-video", title: "Other video" },
    });
    const generation = await prisma.mediaPlaybackGeneration.create({
      data: {
        videoId: other.id,
        generation: 99,
        processingJobId: job.id,
        fallbackR2ObjectKey: job.outputR2ObjectKey,
        hlsMasterR2ObjectKey: `channels/${f.channel.id}/videos/${other.id}/playback/g99/hls/master.m3u8`,
      },
    });
    const owned = {
      jobId: job.id,
      workerId: job.leaseOwner!,
      ...capturedMediaClaim(job),
      generationId: generation.id,
    };
    expect(await adaptive.markFallbackReadyIfOwned(owned)).toBe(false);
    expect(await adaptive.setMasterStatusIfOwned({ ...owned, status: "READY" })).toBe(false);
    expect(await adaptive.markReadyIfCompleteIfOwned(owned)).toBeNull();
    await expect(
      prisma.$transaction(async (tx) => {
        await declareCompatibleIntegrityWorker(tx);
        await tx.mediaPlaybackGeneration.update({
          where: { id: generation.id },
          data: { fallbackStatus: "READY" },
        });
      }),
    ).rejects.toThrow();
  });
  it("reserves the thumbnail before upload and prevents resurrection after privacy wins", async () => {
    const f = await fixture("thumb-privacy");
    const job = await claim(f);
    await verify(f, job);
    const directory = await mkdtemp(join(tmpdir(), "ayin-pg-thumbnail-"));
    let reached!: () => void;
    const uploading = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release!: () => void;
    const finishUpload = new Promise<void>((resolve) => {
      release = resolve;
    });
    const storage = {
      uploadFile: vi.fn(async () => {
        reached();
        await finishUpload;
      }),
      deleteObject: vi.fn(),
    };
    const service = new MediaAutoThumbnailService(database, storage as never);
    vi.spyOn(
      service as unknown as { extractFrame(source: string, target: string): Promise<void> },
      "extractFrame",
    ).mockImplementation(async (_source, target) => {
      await writeFile(target, "jpeg");
    });
    try {
      const result = service
        .ensureForCanonical({
          jobId: job.id,
          workerId: job.leaseOwner!,
          ...capturedMediaClaim(job),
          videoId: job.videoId,
          canonicalPath: join(directory, "canonical.mp4"),
          durationMs: 1000,
        })
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      await uploading;
      const reserved = await prisma.mediaAsset.findUniqueOrThrow({
        where: { r2ObjectKey: thumbnailKey(job, f.channel.id) },
      });
      expect(reserved.status).toBe("PENDING");
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${f.account.id}::uuid FOR UPDATE`;
        await tx.account.update({ where: { id: f.account.id }, data: { status: "CLOSED" } });
        await tx.mediaAsset.updateMany({
          where: { videoId: job.videoId },
          data: { status: "REMOVED", removedAt: new Date() },
        });
        await tx.mediaProcessingJob.update({
          where: { id: job.id },
          data: { status: "CANCELLED", leaseOwner: null, leaseExpiresAt: null },
        });
        await redactCancelledInputIntegrityInTransaction(tx, [job.videoId], new Date());
      });
      release();
      expect(await result).toHaveProperty("error");
      expect(
        (await prisma.mediaAsset.findUniqueOrThrow({ where: { id: reserved.id } })).status,
      ).toBe("REMOVED");
      expect(
        await prisma.mediaAsset.count({ where: { videoId: job.videoId, status: "VALIDATED" } }),
      ).toBe(0);
      expect(storage.deleteObject).not.toHaveBeenCalled();
    } finally {
      release?.();
      vi.restoreAllMocks();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("lets a replacement claim recover a pending thumbnail while the stale upload cannot commit", async () => {
    const f = await fixture("thumb-retry");
    const first = await claim(f);
    await verify(f, first);
    const directory = await mkdtemp(join(tmpdir(), "ayin-pg-thumb-retry-"));
    let reached!: () => void;
    const uploading = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release!: () => void;
    const finishOldUpload = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const storage = {
      uploadFile: vi.fn(async () => {
        if (++calls === 1) {
          reached();
          await finishOldUpload;
        }
      }),
      deleteObject: vi.fn(),
    };
    const service = new MediaAutoThumbnailService(database, storage as never);
    const extract = vi
      .spyOn(
        service as unknown as { extractFrame(source: string, target: string): Promise<void> },
        "extractFrame",
      )
      .mockImplementation(async (_source, target) => {
        await writeFile(target, "jpeg");
      });
    try {
      const old = service
        .ensureForCanonical({
          jobId: first.id,
          workerId: first.leaseOwner!,
          ...capturedMediaClaim(first),
          videoId: first.videoId,
          canonicalPath: join(directory, "old.mp4"),
          durationMs: 1000,
        })
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      await uploading;
      const reserved = await prisma.mediaAsset.findUniqueOrThrow({
        where: { r2ObjectKey: thumbnailKey(first, f.channel.id) },
      });
      await prisma.mediaProcessingJob.update({
        where: { id: first.id },
        data: { leaseExpiresAt: new Date(Date.now() - 1000) },
      });
      const next = (await queue.claimNext("thumbnail-replacement"))!;
      await verify(f, next);
      const ownedInput = {
        jobId: next.id,
        workerId: next.leaseOwner!,
        ...capturedMediaClaim(next),
        videoId: next.videoId,
        canonicalPath: join(directory, "new.mp4"),
        durationMs: 1000,
      };
      const replacement = await service.ensureForCanonical(ownedInput);
      expect(replacement.created).toBe(true);
      expect(replacement.assetId).not.toBe(reserved.id);
      release();
      expect(await old).toHaveProperty("error");
      expect(
        (await prisma.mediaAsset.findUniqueOrThrow({ where: { id: reserved.id } })).status,
      ).toBe("PENDING");
      const ready = await prisma.mediaAsset.findUniqueOrThrow({
        where: { id: replacement.assetId },
      });
      expect(ready.status).toBe("VALIDATED");
      extract.mockClear();
      storage.uploadFile.mockClear();
      expect(await service.ensureForCanonical(ownedInput)).toMatchObject({
        created: false,
        assetId: replacement.assetId,
        reason: "existing-thumbnail",
      });
      expect(extract).not.toHaveBeenCalled();
      expect(storage.uploadFile).not.toHaveBeenCalled();
      expect(
        (await prisma.mediaAsset.findUniqueOrThrow({ where: { id: replacement.assetId } }))
          .updatedAt,
      ).toEqual(ready.updatedAt);
      expect(storage.deleteObject).not.toHaveBeenCalled();
    } finally {
      release?.();
      vi.restoreAllMocks();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("keeps legacy auto-thumbnail generation working through the same owned reservation path", async () => {
    const f = await fixture("legacy-thumb", false);
    const video = await prisma.video.create({
      data: { channelId: f.channel.id, slug: "legacy-thumb-video", title: "Legacy thumbnail" },
    });
    const source = await prisma.mediaAsset.create({
      data: {
        videoId: video.id,
        channelId: f.channel.id,
        kind: "SOURCE_VIDEO",
        status: "UPLOADED",
        r2ObjectKey: "legacy-thumbnail-source",
        sizeBytes: 100n,
        mimeType: "video/mp4",
      },
    });
    const queued = (await lifecycle.enqueueUploadedAsset(source.id))!;
    expect(queued.inputIntegrityVersion).toBe(0);
    const job = (await queue.claimNext("legacy-thumbnail"))!;
    expect(job.id).toBe(queued.id);
    const directory = await mkdtemp(join(tmpdir(), "ayin-pg-legacy-thumb-"));
    const storage = { uploadFile: vi.fn() };
    const service = new MediaAutoThumbnailService(database, storage as never);
    vi.spyOn(
      service as unknown as { extractFrame(source: string, target: string): Promise<void> },
      "extractFrame",
    ).mockImplementation(async (_source, target) => {
      await writeFile(target, "legacy-jpeg");
    });
    try {
      const result = await service.ensureForCanonical({
        jobId: job.id,
        workerId: job.leaseOwner!,
        ...capturedMediaClaim(job),
        videoId: job.videoId,
        canonicalPath: join(directory, "canonical.mp4"),
        durationMs: 1000,
      });
      expect(result.created).toBe(true);
      expect(
        (await prisma.mediaAsset.findUniqueOrThrow({ where: { id: result.assetId } })).status,
      ).toBe("VALIDATED");
    } finally {
      vi.restoreAllMocks();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("rechecks thumbnail lease after a session-lock wait before making it eligible", async () => {
    const f = await fixture("thumb-expiry");
    const job = await claim(f);
    await verify(f, job);
    const directory = await mkdtemp(join(tmpdir(), "ayin-pg-thumb-expiry-"));
    let uploaded!: () => void;
    const uploadReached = new Promise<void>((resolve) => {
      uploaded = resolve;
    });
    let finishUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
      finishUpload = resolve;
    });
    let releaseSession!: () => void;
    const sessionGate = new Promise<void>((resolve) => {
      releaseSession = resolve;
    });
    let sessionLocked!: () => void;
    const lockReached = new Promise<void>((resolve) => {
      sessionLocked = resolve;
    });
    const storage = {
      uploadFile: vi.fn(async () => {
        uploaded();
        await uploadGate;
      }),
    };
    const service = new MediaAutoThumbnailService(database, storage as never);
    vi.spyOn(
      service as unknown as { extractFrame(source: string, target: string): Promise<void> },
      "extractFrame",
    ).mockImplementation(async (_source, target) => {
      await writeFile(target, "jpeg");
    });
    let holder: Promise<void> | undefined;
    try {
      const outcome = service
        .ensureForCanonical({
          jobId: job.id,
          workerId: job.leaseOwner!,
          ...capturedMediaClaim(job),
          videoId: job.videoId,
          canonicalPath: join(directory, "canonical.mp4"),
          durationMs: 1000,
        })
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      await uploadReached;
      holder = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "MediaUploadSession" WHERE id = ${f.session.id}::uuid FOR UPDATE`;
        sessionLocked();
        await sessionGate;
      });
      await lockReached;
      const expires = new Date(Date.now() + 1000);
      await prisma.mediaProcessingJob.update({
        where: { id: job.id },
        data: { leaseExpiresAt: expires },
      });
      finishUpload();
      let blocked = false;
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline) {
        const rows = await prisma.$queryRaw<
          Array<{ blocked: boolean }>
        >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE '%ayin-worker-input-session-lock%') AS blocked`;
        if (rows[0]?.blocked) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, expires.getTime() - Date.now()) + 50),
      );
      releaseSession();
      await holder;
      expect(await outcome).toHaveProperty("error");
      expect(
        (
          await prisma.mediaAsset.findUniqueOrThrow({
            where: { r2ObjectKey: thumbnailKey(job, f.channel.id) },
          })
        ).status,
      ).toBe("PENDING");
    } finally {
      finishUpload?.();
      releaseSession?.();
      await holder?.catch(() => undefined);
      vi.restoreAllMocks();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("never retrofits recovery identity onto queued legacy input or a READY legacy canonical", async () => {
    const f = await fixture("legacy-attachment", false);
    const legacy = await prisma.mediaAsset.create({
      data: {
        videoId: f.video.id,
        channelId: f.channel.id,
        kind: "SOURCE_VIDEO",
        status: "UPLOADED",
        r2ObjectKey: "legacy-attachment-source",
        sizeBytes: f.asset.sizeBytes,
        mimeType: "video/mp4",
      },
    });
    const job = await prisma.mediaProcessingJob.create({
      data: {
        videoId: f.video.id,
        generation: 1,
        status: "QUEUED",
        sourceMimeType: "video/mp4",
        sourceSizeBytes: legacy.sizeBytes,
        stagingKey: legacy.r2ObjectKey,
        inputR2ObjectKey: legacy.r2ObjectKey,
        outputR2ObjectKey: "legacy-attachment-canonical",
        queuedAt: new Date(),
      },
    });
    const attach = (sourceAssetId: string, objectKey: string) =>
      prisma.mediaUploadSession.create({
        data: {
          sourceAssetId,
          objectKey,
          initiatingAccountId: f.account.id,
          channelId: f.channel.id,
          videoId: f.video.id,
          authority: "OWNER",
          mode: "SINGLE",
          sizeBytes: legacy.sizeBytes,
          partSizeBytes: legacy.sizeBytes,
          mimeType: "video/mp4",
          contentIdentityAlgorithm: f.identity.algorithm,
          contentIdentityDigest: f.identity.rootSha256,
          state: "COMPLETED",
          hardExpiresAt: new Date(Date.now() + 3600000),
        },
      });
    await expect(attach(legacy.id, legacy.r2ObjectKey)).rejects.toThrow();
    const canonical = await prisma.mediaAsset.create({
      data: {
        videoId: f.video.id,
        channelId: f.channel.id,
        kind: "SOURCE_VIDEO",
        status: "VALIDATED",
        r2ObjectKey: job.outputR2ObjectKey,
        sizeBytes: legacy.sizeBytes,
        mimeType: "video/mp4",
      },
    });
    await prisma.mediaProcessingJob.update({
      where: { id: job.id },
      data: { status: "READY", finalAssetId: canonical.id },
    });
    await expect(attach(canonical.id, canonical.r2ObjectKey)).rejects.toThrow();
    expect(
      (await prisma.mediaProcessingJob.findUniqueOrThrow({ where: { id: job.id } }))
        .inputIntegrityVersion,
    ).toBe(0);
    expect(
      (await prisma.mediaAsset.findUniqueOrThrow({ where: { id: legacy.id } }))
        .uploadIntegrityRequired,
    ).toBe(false);
    expect(
      (await prisma.mediaAsset.findUniqueOrThrow({ where: { id: canonical.id } }))
        .uploadIntegrityRequired,
    ).toBe(false);
  });
  it.each(["session-first", "job-first"] as const)(
    "serializes legacy processing versus recovery attachment: %s",
    async (order) => {
      const f = await fixture(`attach-race-${order}`, false);
      const source = await prisma.mediaAsset.create({
        data: {
          videoId: f.video.id,
          channelId: f.channel.id,
          kind: "SOURCE_VIDEO",
          status: "UPLOADED",
          r2ObjectKey: `attachment-race-${order}`,
          sizeBytes: f.asset.sizeBytes,
          mimeType: "video/mp4",
        },
      });
      const jobData = {
        videoId: f.video.id,
        generation: 1,
        status: "QUEUED" as const,
        sourceMimeType: source.mimeType,
        sourceSizeBytes: source.sizeBytes,
        stagingKey: source.r2ObjectKey,
        inputR2ObjectKey: source.r2ObjectKey,
        outputR2ObjectKey: `attachment-race-output-${order}`,
        queuedAt: new Date(),
      };
      const sessionData = {
        sourceAssetId: source.id,
        objectKey: source.r2ObjectKey,
        initiatingAccountId: f.account.id,
        channelId: f.channel.id,
        videoId: f.video.id,
        authority: "OWNER" as const,
        mode: "SINGLE" as const,
        sizeBytes: source.sizeBytes,
        partSizeBytes: source.sizeBytes,
        mimeType: source.mimeType,
        contentIdentityAlgorithm: f.identity.algorithm,
        contentIdentityDigest: f.identity.rootSha256,
        state: "COMPLETED" as const,
        hardExpiresAt: new Date(Date.now() + 3600000),
      };
      let locked!: () => void;
      const lockReached = new Promise<void>((resolve) => {
        locked = resolve;
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const first = prisma.$transaction(async (tx) => {
        if (order === "session-first") await tx.mediaUploadSession.create({ data: sessionData });
        else await tx.mediaProcessingJob.create({ data: jobData });
        locked();
        await gate;
      });
      try {
        await lockReached;
        const second = (
          order === "session-first"
            ? prisma.mediaProcessingJob.create({ data: jobData })
            : prisma.mediaUploadSession.create({ data: sessionData })
        ).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        let blocked = false;
        const deadline = Date.now() + 1500;
        while (Date.now() < deadline) {
          const rows = await prisma.$queryRaw<
            Array<{ blocked: boolean }>
          >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND (query LIKE '%MediaUploadSession%' OR query LIKE '%MediaProcessingJob%')) AS blocked`;
          if (rows[0]?.blocked) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
        release();
        await first;
        expect(await second).toHaveProperty("error");
        expect(
          (await prisma.mediaAsset.findUniqueOrThrow({ where: { id: source.id } }))
            .uploadIntegrityRequired,
        ).toBe(order === "session-first");
        expect(
          await prisma.mediaProcessingJob.count({
            where: { inputR2ObjectKey: source.r2ObjectKey },
          }),
        ).toBe(order === "job-first" ? 1 : 0);
      } finally {
        release?.();
        await first.catch(() => undefined);
      }
    },
  );
  it.each(["lease", "privacy"] as const)(
    "rejects authority loss during actual chunk hashing: %s",
    async (loss) => {
      const f = await fixture(`hash-time-${loss}`, true, 4 * 1024 * 1024 + 17);
      const job = await claim(f);
      const directory = await mkdtemp(join(tmpdir(), "ayin-pg-hash-race-"));
      vi.stubEnv("MEDIA_PROCESSING_WORKDIR", directory);
      let reached!: () => void;
      const hashReached = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let release!: () => void;
      const hashGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const originalDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
      let paused = false;
      vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(async (algorithm, bytes) => {
        const value = await originalDigest(algorithm, bytes);
        if (!paused) {
          paused = true;
          reached();
          await hashGate;
        }
        return value;
      });
      const storage = {
        downloadToFile: vi.fn(async (_key: string, path: string) => {
          await writeFile(path, f.bytes);
        }),
        headObject: vi.fn().mockResolvedValue({ sizeBytes: 99, contentType: "video/mp4" }),
        uploadFile: vi.fn(),
        deleteObject: vi.fn(),
      };
      const adaptiveWork = { process: vi.fn() };
      const subject = new MediaProcessingExecutorService(
        queue,
        lifecycle,
        storage as never,
        adaptiveWork as never,
        { ensureForCanonical: vi.fn() } as never,
        new PlatformSettingsService(database),
      );
      const probe = vi.spyOn(
        subject as unknown as { probe(path: string): Promise<MediaProbeMetadata> },
        "probe",
      );
      try {
        const processing = subject.process(job, job.leaseOwner!);
        await hashReached;
        if (loss === "lease") {
          await prisma.mediaProcessingJob.update({
            where: { id: job.id },
            data: { leaseExpiresAt: new Date(Date.now() - 1000) },
          });
          expect((await queue.claimNext("hash-replacement"))?.id).toBe(job.id);
        } else {
          await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${f.account.id}::uuid FOR UPDATE`;
            await tx.account.update({ where: { id: f.account.id }, data: { status: "CLOSED" } });
            await tx.mediaAsset.update({
              where: { id: f.asset.id },
              data: { status: "REMOVED", removedAt: new Date() },
            });
            await tx.mediaProcessingJob.update({
              where: { id: job.id },
              data: { status: "CANCELLED", leaseOwner: null, leaseExpiresAt: null },
            });
            await redactCancelledInputIntegrityInTransaction(tx, [job.videoId], new Date());
          });
        }
        release();
        await processing;
        const current = await prisma.mediaProcessingJob.findUniqueOrThrow({
          where: { id: job.id },
        });
        expect(current.status).toBe(loss === "lease" ? "PROCESSING" : "CANCELLED");
        expect(current.inputVerifiedAt).toBeNull();
        expect(probe).not.toHaveBeenCalled();
        expect(storage.uploadFile).not.toHaveBeenCalled();
        expect(storage.deleteObject).not.toHaveBeenCalled();
        expect(adaptiveWork.process).not.toHaveBeenCalled();
        expect(
          await prisma.mediaAsset.count({ where: { videoId: job.videoId, status: "VALIDATED" } }),
        ).toBe(0);
      } finally {
        release?.();
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
  it("keeps accepted foreign-owner media valid after the initiating admin closes and its provenance FK disappears", async () => {
    const f = await fixture("former-admin", true, undefined, true);
    await prisma.account.update({ where: { id: f.initiator.id }, data: { status: "CLOSED" } });
    const job = await claim(f);
    expect(
      await lifecycle.recordInputVerification({
        jobId: job.id,
        workerId: job.leaseOwner!,
        ...capturedMediaClaim(job),
        identity: f.identity,
      }),
    ).toBe(true);
    await prisma.account.delete({ where: { id: f.initiator.id } });
    expect(
      (await prisma.mediaUploadSession.findUniqueOrThrow({ where: { id: f.session.id } }))
        .initiatingAccountId,
    ).toBeNull();
    const canonical = await verify(f, job);
    const ready = await lifecycle.finalizeReady({
      jobId: job.id,
      workerId: job.leaseOwner!,
      ...capturedMediaClaim(job),
      metadata: metadata(canonical.sizeBytes),
    });
    expect(ready?.job.status).toBe("READY");
    expect(ready?.job.inputIntegrityAccountId).toBe(f.initiator.id);
    const cleanup = await prisma.privacyMediaDeletionJob.findUniqueOrThrow({
      where: { operationKey: `processing-source:${job.id}` },
    });
    expect(cleanup.channelId).toBe(f.channel.id);
    expect(cleanup.accountId).toBeNull();
    const reprocess = (await prisma.$transaction((tx) =>
      lifecycle.createReprocessJob(tx, job.videoId),
    ))!;
    const next = (await queue.claimNext("foreign-channel-reprocess"))!;
    expect(next.id).toBe(reprocess.id);
    expect(
      await lifecycle.recordInputVerification({
        jobId: next.id,
        workerId: next.leaseOwner!,
        ...capturedMediaClaim(next),
        identity: canonical,
      }),
    ).toBe(true);
    await prisma.account.update({ where: { id: f.account.id }, data: { status: "CLOSED" } });
    expect(
      await lifecycle.recordCanonicalVerification({
        jobId: next.id,
        workerId: next.leaseOwner!,
        ...capturedMediaClaim(next),
        identity: canonical,
      }),
    ).toBe(false);
  });
  it("blocks accepted media when its actual owner closes even while the initiating administrator remains active", async () => {
    const f = await fixture("actual-owner-privacy", true, undefined, true);
    const job = await claim(f);
    await prisma.account.update({ where: { id: f.account.id }, data: { status: "CLOSED" } });
    expect((await prisma.account.findUniqueOrThrow({ where: { id: f.initiator.id } })).status).toBe(
      "ACTIVE",
    );
    expect(
      await lifecycle.recordInputVerification({
        jobId: job.id,
        workerId: job.leaseOwner!,
        ...capturedMediaClaim(job),
        identity: f.identity,
      }),
    ).toBe(false);
    expect(
      await lifecycle.finalizeReady({
        jobId: job.id,
        workerId: job.leaseOwner!,
        ...capturedMediaClaim(job),
        metadata: metadata(f.bytes.length),
      }),
    ).toBeNull();
  });
  it("preserves shared channel processing while one current owner remains active", async () => {
    const f = await fixture("shared-owner");
    const remaining = await prisma.account.create({
      data: { email: "remaining-owner@integrity.invalid", displayName: "Remaining channel owner" },
    });
    await prisma.channelMember.create({
      data: { channelId: f.channel.id, accountId: remaining.id, role: "OWNER" },
    });
    await prisma.account.update({ where: { id: f.account.id }, data: { status: "CLOSED" } });
    const job = await claim(f);
    expect(
      await lifecycle.recordInputVerification({
        jobId: job.id,
        workerId: job.leaseOwner!,
        ...capturedMediaClaim(job),
        identity: f.identity,
      }),
    ).toBe(true);
    await prisma.account.update({ where: { id: remaining.id }, data: { status: "CLOSED" } });
    expect(
      await lifecycle.recordInputVerification({
        jobId: job.id,
        workerId: job.leaseOwner!,
        ...capturedMediaClaim(job),
        identity: f.identity,
      }),
    ).toBe(false);
  });
  it("never promotes member-owned acceptance after OWNER rows disappear, even with the platform flag", async () => {
    const f = await fixture("orphaned-member", false, undefined, true);
    await prisma.channel.update({ where: { id: f.channel.id }, data: { isPlatformOwned: true } });
    f.job = (await lifecycle.enqueueUploadedAsset(f.asset.id))!;
    expect(f.job.inputIntegrityOwnerlessPlatform).toBe(false);
    await prisma.channelMember.deleteMany({ where: { channelId: f.channel.id, role: "OWNER" } });
    expect(await queue.claimNext("orphaned-member-worker")).toBeNull();
    expect(await prisma.mediaProcessingOutputAttempt.count()).toBe(0);
    await expect(
      prisma.mediaProcessingJob.update({
        where: { id: f.job.id },
        data: { inputIntegrityOwnerlessPlatform: true },
      }),
    ).rejects.toThrow();
  });
  it("preserves accepted ownerless platform processing and blocks removal of platform classification", async () => {
    const f = await fixture("ownerless-platform", true, undefined, true, true);
    expect(f.job.inputIntegrityOwnerlessPlatform).toBe(true);
    await prisma.account.update({ where: { id: f.initiator.id }, data: { status: "CLOSED" } });
    const job = await claim(f);
    expect(
      await lifecycle.recordInputVerification({
        jobId: job.id,
        workerId: job.leaseOwner!,
        ...capturedMediaClaim(job),
        identity: f.identity,
      }),
    ).toBe(true);
    await prisma.channel.update({ where: { id: f.channel.id }, data: { isPlatformOwned: false } });
    expect(
      await lifecycle.recordInputVerification({
        jobId: job.id,
        workerId: job.leaseOwner!,
        ...capturedMediaClaim(job),
        identity: f.identity,
      }),
    ).toBe(false);
  });
  it("captures current legitimate custody only for a new explicit canonical reprocess", async () => {
    const f = await fixture("reprocess-custody");
    const job = await claim(f);
    const canonical = await verify(f, job);
    const ready = await lifecycle.finalizeReady({
      jobId: job.id,
      workerId: job.leaseOwner!,
      ...capturedMediaClaim(job),
      metadata: metadata(canonical.sizeBytes),
    });
    expect(ready?.job.inputIntegrityOwnerlessPlatform).toBe(false);
    await prisma.channelMember.deleteMany({ where: { channelId: f.channel.id, role: "OWNER" } });
    await prisma.channel.update({ where: { id: f.channel.id }, data: { isPlatformOwned: true } });
    const next = (await prisma.$transaction((tx) =>
      lifecycle.createReprocessJob(tx, job.videoId),
    ))!;
    expect(next.inputIntegrityOwnerlessPlatform).toBe(true);
    expect(next.inputIntegrityParentJobId).toBe(job.id);
    expect(next.inputIntegrityDigest).toBe(canonical.rootSha256);
    const claimed = (await queue.claimNext("platform-reprocess"))!;
    expect(
      await lifecycle.recordInputVerification({
        jobId: claimed.id,
        workerId: claimed.leaseOwner!,
        ...capturedMediaClaim(claimed),
        identity: canonical,
      }),
    ).toBe(true);
  });
  it("rejects staging-only legacy aliases on insert/update and later session attachment", async () => {
    const f = await fixture("staging-only", false);
    const data = {
      videoId: f.video.id,
      generation: 1,
      status: "QUEUED" as const,
      sourceMimeType: f.asset.mimeType,
      sourceSizeBytes: f.asset.sizeBytes,
      inputR2ObjectKey: null,
      stagingKey: f.asset.r2ObjectKey,
      outputR2ObjectKey: "staging-only-output",
      queuedAt: new Date(),
    };
    await expect(prisma.mediaProcessingJob.create({ data })).rejects.toThrow();
    const legacy = await prisma.mediaProcessingJob.create({
      data: { ...data, stagingKey: "legacy-staging-placeholder" },
    });
    await expect(
      prisma.mediaProcessingJob.update({
        where: { id: legacy.id },
        data: { stagingKey: f.asset.r2ObjectKey },
      }),
    ).rejects.toThrow();
    const source = await prisma.mediaAsset.create({
      data: {
        videoId: f.video.id,
        channelId: f.channel.id,
        kind: "SOURCE_VIDEO",
        status: "UPLOADED",
        r2ObjectKey: "legacy-staging-placeholder",
        sizeBytes: f.asset.sizeBytes,
        mimeType: f.asset.mimeType,
      },
    });
    await expect(
      prisma.mediaUploadSession.create({
        data: {
          sourceAssetId: source.id,
          objectKey: source.r2ObjectKey,
          initiatingAccountId: f.account.id,
          channelId: f.channel.id,
          videoId: f.video.id,
          authority: "OWNER",
          mode: "SINGLE",
          sizeBytes: source.sizeBytes,
          partSizeBytes: source.sizeBytes,
          mimeType: source.mimeType,
          contentIdentityAlgorithm: f.identity.algorithm,
          contentIdentityDigest: f.identity.rootSha256,
          state: "COMPLETED",
          hardExpiresAt: new Date(Date.now() + 3600000),
        },
      }),
    ).rejects.toThrow();
    expect(
      (await prisma.mediaAsset.findUniqueOrThrow({ where: { id: source.id } }))
        .uploadIntegrityRequired,
    ).toBe(false);
    expect(
      (await prisma.mediaProcessingJob.findUniqueOrThrow({ where: { id: legacy.id } }))
        .inputIntegrityVersion,
    ).toBe(0);
  });
  it.each(["canonical.mp4", "thumbnail.jpg", "segment-000001.ts", "master.m3u8"])(
    "an already-issued losing %s PUT completes after winner READY without changing winning bytes or addresses",
    async (heldSuffix) => {
      const f = await fixture(`late-${heldSuffix.replaceAll(".", "-")}`);
      const first = await claim(f);
      const directory = await mkdtemp(join(tmpdir(), "ayin-pg-late-put-"));
      const executable = join(directory, "transcode.cjs");
      const versionFile = join(directory, "version");
      await writeFile(versionFile, "old-attempt-canonical-bytes");
      await writeFile(
        executable,
        `#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync(process.argv.at(-1),fs.readFileSync(${JSON.stringify(versionFile)}));\n`,
      );
      await chmod(executable, 0o700);
      vi.stubEnv("FFMPEG_PATH", executable);
      vi.stubEnv("MEDIA_PROCESSING_WORKDIR", directory);
      const objects = new Map<string, Buffer>([[f.asset.r2ObjectKey, f.bytes]]);
      let issued!: () => void, release!: () => void;
      const alreadyIssued = new Promise<void>((resolve) => {
        issued = resolve;
      });
      const providerGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let heldKey = "";
      const storage = {
        downloadToFile: vi.fn(async (key: string, path: string) => {
          await writeFile(path, objects.get(key)!);
        }),
        uploadFile: vi.fn(async (key: string, path: string) => {
          // Read the request body before losing ownership, exactly like an
          // already-issued provider PUT. It may settle after the caller's lease.
          const payload = await readFile(path);
          if (key.includes(first.currentOutputAttemptId!) && key.endsWith(heldSuffix)) {
            heldKey = key;
            issued();
            await providerGate;
          }
          objects.set(key, payload);
        }),
        headObject: vi.fn(async (key: string) => {
          const bytes = objects.get(key);
          if (!bytes) throw new Error("missing object");
          return {
            sizeBytes: bytes.length,
            contentType: key.endsWith(".mp4")
              ? "video/mp4"
              : key.endsWith(".ts")
                ? "video/mp2t"
                : "application/vnd.apple.mpegurl",
          };
        }),
        downloadText: vi.fn(async (key: string) => objects.get(key)!.toString("utf8")),
        deleteObject: vi.fn(),
      };
      const thumbnails = new MediaAutoThumbnailService(database, storage as never);
      vi.spyOn(
        thumbnails as unknown as { extractFrame(source: string, target: string): Promise<void> },
        "extractFrame",
      ).mockImplementation(async (source, target) => {
        await writeFile(target, Buffer.concat([Buffer.from("jpeg:"), await readFile(source)]));
      });
      const hls = new MediaAdaptiveProcessingService(
        {
          resolve: async () => ({
            enabled: true,
            allowedIdentities: ["360p"],
            maxOutputHeight: 360,
            videoBitrateKbps: { "360p": 800 },
            audioBitrateKbps: { "360p": 96 },
            scratchMaxBytesPerJob: 1024 * 1024,
            ffmpegThreadsPerJob: 1,
            ffmpegPreset: "medium",
            segmentDurationSeconds: 6,
          }),
        } as never,
        adaptive,
        lifecycle,
        storage as never,
        {
          transcode: async ({
            canonicalPath,
            outputDirectory,
          }: {
            canonicalPath: string;
            outputDirectory: string;
          }) => {
            await mkdir(outputDirectory, { recursive: true });
            const playlistText =
              "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:1.000,\nsegment-000001.ts\n#EXT-X-ENDLIST\n";
            const playlistPath = join(outputDirectory, "index.m3u8"),
              filePath = join(outputDirectory, "segment-000001.ts");
            const bytes = Buffer.concat([Buffer.from("segment:"), await readFile(canonicalPath)]);
            await writeFile(playlistPath, playlistText);
            await writeFile(filePath, bytes);
            return {
              playlistText,
              playlistPath,
              playlistSizeBytes: Buffer.byteLength(playlistText),
              segments: [{ sequence: 1, filePath, sizeBytes: bytes.length }],
            };
          },
        } as never,
      );
      const executor = new MediaProcessingExecutorService(
        queue,
        lifecycle,
        storage as never,
        hls,
        thumbnails,
        new PlatformSettingsService(database),
      );
      vi.spyOn(
        executor as unknown as { probe(path: string): Promise<MediaProbeMetadata> },
        "probe",
      ).mockResolvedValue({
        durationMs: 1000,
        width: 640,
        height: 360,
        encodedWidth: 640,
        encodedHeight: 360,
        rotationDegrees: 0,
        videoCodec: "h264",
        audioCodec: "aac",
        hasAudio: true,
      });
      let old: Promise<void> | undefined;
      try {
        old = executor.process(first, first.leaseOwner!);
        await Promise.race([
          alreadyIssued,
          old.then(() => {
            throw new Error("Old worker ended before its PUT was issued");
          }),
        ]);
        expect(objects.has(heldKey)).toBe(false);
        await prisma.mediaProcessingJob.update({
          where: { id: first.id },
          data: { leaseExpiresAt: new Date(0) },
        });
        const next = (await queue.claimNext("integrity-worker"))!; // same instance, new captured token
        expect(next.id).toBe(first.id);
        expect(next.leaseOwner).not.toBe(first.leaseOwner);
        expect(next.currentOutputAttemptId).not.toBe(first.currentOutputAttemptId);
        expect(next.outputR2ObjectKey).not.toBe(first.outputR2ObjectKey);
        await writeFile(versionFile, "new-winning-canonical-bytes");
        await executor.process(next, next.leaseOwner!);
        const winner = await prisma.mediaProcessingJob.findUniqueOrThrow({
          where: { id: first.id },
          include: { finalAsset: true },
        });
        expect(winner.status).toBe("READY");
        expect(winner.finalAsset?.r2ObjectKey).toBe(next.outputR2ObjectKey);
        const generation = await prisma.mediaPlaybackGeneration.findUniqueOrThrow({
          where: { videoId_generation: { videoId: first.videoId, generation: first.generation } },
          include: { renditions: true },
        });
        expect(generation.status).toBe("READY");
        expect(generation.outputAttemptId).toBe(next.currentOutputAttemptId);
        const keys = [
          winner.finalAsset!.r2ObjectKey,
          generation.fallbackR2ObjectKey,
          generation.hlsMasterR2ObjectKey,
          ...generation.renditions.flatMap((r) => [
            r.playlistR2ObjectKey,
            `${r.segmentR2Prefix}000001.ts`,
          ]),
        ];
        const thumbnail = await prisma.mediaAsset.findFirstOrThrow({
          where: {
            videoId: first.videoId,
            kind: "THUMBNAIL",
            status: "VALIDATED",
            removedAt: null,
          },
        });
        keys.push(thumbnail.r2ObjectKey);
        const snapshot = keys.map((key) => [key, Buffer.from(objects.get(key)!)] as const);
        expect(keys).not.toContain(heldKey);
        release();
        await old;
        expect(objects.has(heldKey)).toBe(true); // actual late provider settlement
        for (const [key, bytes] of snapshot) expect(objects.get(key)).toEqual(bytes);
        expect(
          await prisma.mediaProcessingJob.findUniqueOrThrow({ where: { id: first.id } }),
        ).toMatchObject({
          status: "READY",
          currentOutputAttemptId: next.currentOutputAttemptId,
          outputIntegrityDigest: winner.outputIntegrityDigest,
          finalAssetId: winner.finalAssetId,
        });
        expect(
          (await prisma.mediaPlaybackGeneration.findUniqueOrThrow({ where: { id: generation.id } }))
            .hlsMasterR2ObjectKey,
        ).toBe(generation.hlsMasterR2ObjectKey);
        const attempts = await prisma.mediaProcessingOutputAttempt.findMany({
          where: { processingJobId: first.id },
        });
        expect(attempts).toHaveLength(2);
        expect(attempts.map((a) => a.id)).toEqual(
          expect.arrayContaining([first.currentOutputAttemptId, next.currentOutputAttemptId]),
        );
        expect(storage.deleteObject).not.toHaveBeenCalled();
        // Transformed reprocess accepts the winning digest but allocates its own
        // namespace, never writing into the recorded canonical input address.
        const reprocess = await prisma.$transaction((tx) =>
          lifecycle.createReprocessJob(tx, f.video.id),
        );
        expect(reprocess?.inputR2ObjectKey).toBe(winner.outputR2ObjectKey);
        const reprocessClaim = (await queue.claimNext("integrity-worker"))!;
        expect(reprocessClaim.outputR2ObjectKey).not.toBe(reprocessClaim.inputR2ObjectKey);
        expect(reprocessClaim.outputR2ObjectKey).not.toBe(first.outputR2ObjectKey);
        expect(reprocessClaim.inputIntegrityDigest).toBe(winner.outputIntegrityDigest);
      } finally {
        release?.();
        await old;
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
  it("retains immutable attempt addresses, rejects absent or mismatched captured identity, and preserves orphan evidence", async () => {
    const f = await fixture("attempt-ledger");
    const job = await claim(f);
    const attempt = await prisma.mediaProcessingOutputAttempt.findUniqueOrThrow({
      where: { id: job.currentOutputAttemptId! },
    });
    expect(attempt).toMatchObject({
      processingJobId: job.id,
      videoId: job.videoId,
      channelId: f.channel.id,
      generation: job.generation,
      attempt: job.attempt,
      claimToken: job.leaseOwner,
      canonicalR2ObjectKey: job.outputR2ObjectKey,
    });
    expect(attempt.prefix).toContain(`/attempts/${attempt.id}/`);
    expect(
      await lifecycle.recordInputVerification({
        jobId: job.id,
        workerId: job.leaseOwner!,
        identity: f.identity,
      }),
    ).toBe(false);
    expect(
      await lifecycle.recordInputVerification({
        jobId: job.id,
        workerId: job.leaseOwner!,
        attempt: job.attempt + 1,
        outputAttemptId: attempt.id,
        identity: f.identity,
      }),
    ).toBe(false);
    expect(
      await lifecycle.recordInputVerification({
        jobId: job.id,
        workerId: job.leaseOwner!,
        attempt: job.attempt,
        outputAttemptId: "88888888-8888-4888-8888-888888888888",
        identity: f.identity,
      }),
    ).toBe(false);
    expect(
      await lifecycle.setOwnedStage({
        jobId: job.id,
        workerId: job.leaseOwner!,
        status: "VERIFYING",
        stage: "MISSING_CAPTURE",
      }),
    ).toBe(false);
    await expect(
      prisma.mediaProcessingOutputAttempt.update({
        where: { id: attempt.id },
        data: { canonicalR2ObjectKey: "forged" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.mediaProcessingOutputAttempt.delete({ where: { id: attempt.id } }),
    ).rejects.toThrow();
    await expect(
      prisma.mediaProcessingJob.update({
        where: { id: job.id },
        data: { outputR2ObjectKey: "forged" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.mediaProcessingJob.update({
        where: { id: job.id },
        data: { currentOutputAttemptId: null },
      }),
    ).rejects.toThrow();
    await verify(f, job);
    await prisma.video.delete({ where: { id: job.videoId } });
    expect(
      await prisma.mediaProcessingOutputAttempt.findUnique({ where: { id: attempt.id } }),
    ).toEqual(attempt);
  });
  it("retains old attempt addresses when an existing operator retry resets the numeric retry budget", async () => {
    const f = await fixture("attempt-admin-retry");
    const first = await claim(f);
    await prisma.mediaProcessingJob.update({
      where: { id: first.id },
      data: { status: "FAILED", leaseOwner: null, leaseExpiresAt: null },
    });
    await prisma.mediaProcessingJob.update({
      where: { id: first.id },
      data: { status: "QUEUED", stage: "ADMIN_RETRY_QUEUED", attempt: 0, queuedAt: new Date(0) },
    });
    const next = (await queue.claimNext("integrity-worker"))!;
    expect(next.attempt).toBe(1);
    expect(next.outputR2ObjectKey).not.toBe(first.outputR2ObjectKey);
    expect(next.currentOutputAttemptId).not.toBe(first.currentOutputAttemptId);
    expect(
      await prisma.mediaProcessingOutputAttempt.findMany({ where: { processingJobId: first.id } }),
    ).toHaveLength(2);
    expect(
      await lifecycle.recordInputVerification({
        jobId: first.id,
        workerId: next.leaseOwner!,
        ...capturedMediaClaim(first),
        identity: f.identity,
      }),
    ).toBe(false);
    await verify(f, next);
  });
  it("skips a closed required candidate without starving eligible legacy or required jobs", async () => {
    const closed = await fixture("closed-queue");
    await prisma.mediaProcessingJob.update({
      where: { id: closed.job.id },
      data: { priority: 100 },
    });
    await prisma.account.update({ where: { id: closed.account.id }, data: { status: "CLOSED" } });
    const eligible = await fixture("eligible-queue");
    const legacyFixture = await fixture("legacy-queue", false);
    const legacy = await prisma.mediaProcessingJob.create({
      data: {
        videoId: legacyFixture.video.id,
        generation: 1,
        status: "QUEUED",
        sourceMimeType: "video/mp4",
        sourceSizeBytes: 7n,
        stagingKey: "ordinary-legacy-input",
        outputR2ObjectKey: "ordinary-legacy-output",
        priority: 10,
        queuedAt: new Date(0),
      },
    });
    const first = (await queue.claimNext("queue-progress"))!;
    expect(first.id).toBe(legacy.id);
    await prisma.mediaProcessingJob.update({
      where: { id: first.id },
      data: { status: "FAILED", leaseOwner: null, leaseExpiresAt: null },
    });
    expect((await queue.claimNext("queue-progress"))?.id).toBe(eligible.job.id);
    expect(
      await prisma.mediaProcessingOutputAttempt.count({
        where: { processingJobId: closed.job.id },
      }),
    ).toBe(0);
  });
  it.each(["privacy-first", "claim-first"])(
    "serializes %s so privacy covers every reserved output attempt",
    async (order) => {
      const f = await fixture(order);
      const request = await prisma.accountDeletionRequest.create({
        data: {
          accountId: f.account.id,
          state: "DEACTIVATED",
          deactivatedAt: new Date(Date.now() - 2 * 86400000),
        },
      });
      let reached!: () => void, release!: () => void;
      const paused = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const proceed = new Promise<void>((resolve) => {
        release = resolve;
      });
      const hookedDatabase = {
        client: new Proxy(prisma, {
          get(target, property) {
            if (property === "$transaction")
              return (fn: (tx: unknown) => unknown) =>
                prisma.$transaction(async (tx) =>
                  fn(
                    new Proxy(tx, {
                      get(inner, key) {
                        if (key === "mediaProcessingOutputAttempt")
                          return new Proxy(inner.mediaProcessingOutputAttempt, {
                            get(delegate, method) {
                              if (method === (order === "privacy-first" ? "findMany" : "create"))
                                return async (...args: unknown[]) => {
                                  const result = await (
                                    Reflect.get(delegate, method) as (...args: unknown[]) => unknown
                                  ).apply(delegate, args);
                                  reached();
                                  await proceed;
                                  return result;
                                };
                              const value = Reflect.get(delegate, method);
                              return typeof value === "function" ? value.bind(delegate) : value;
                            },
                          });
                        const value = Reflect.get(inner, key);
                        return typeof value === "function" ? value.bind(inner) : value;
                      },
                    }),
                  ),
                );
            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      } as never;
      const privacy = new PrivacyLifecycleService(
        order === "privacy-first" ? hookedDatabase : database,
        {} as never,
        {} as never,
        {} as never,
      );
      const claimant =
        order === "claim-first"
          ? new MediaProcessingQueueService(hookedDatabase, new PlatformSettingsService(database))
          : queue;
      let privacyRun: Promise<unknown> | undefined,
        claimRun: Promise<{ job?: MediaProcessingJob | null; error?: unknown }> | undefined;
      try {
        if (order === "privacy-first") privacyRun = privacy.advanceDue(new Date(), 1);
        else
          claimRun = claimant.claimNext("ordered-claim").then(
            (job) => ({ job }),
            (error) => ({ error }),
          );
        await paused;
        if (order === "privacy-first")
          claimRun = claimant.claimNext("ordered-claim").then(
            (job) => ({ job }),
            (error) => ({ error }),
          );
        else privacyRun = privacy.advanceDue(new Date(), 1);
        await waitForBlockedQuery(
          order === "privacy-first"
            ? "%ayin-media-owner-account-lock%"
            : "%ayin-deletion-anonymize-account-lock%",
        );
        release();
        const result = await claimRun!;
        await privacyRun;
        const attempts = await prisma.mediaProcessingOutputAttempt.findMany({
          where: { processingJobId: f.job.id },
        });
        expect(attempts).toHaveLength(order === "privacy-first" ? 0 : 1);
        if (order === "privacy-first") expect(result.job ?? null).toBeNull();
        else expect(result.job?.currentOutputAttemptId).toBe(attempts[0]!.id);
        const barrier = await prisma.privacyMediaDeletionJob.findUniqueOrThrow({
          where: { operationKey: `processing-outputs:${f.job.id}` },
        });
        expect(barrier.requestId).toBe(request.id);
        const addresses = barrier.outputAddresses as {
          attempts: Array<{ id: string }>;
          prefixes: string[];
        };
        expect(addresses.attempts.map((attempt) => attempt.id)).toEqual(
          attempts.map((attempt) => attempt.id),
        );
        for (const attempt of attempts) expect(addresses.prefixes).toContain(attempt.prefix);
        expect(
          (await prisma.mediaProcessingJob.findUniqueOrThrow({ where: { id: f.job.id } })).status,
        ).toBe("CANCELLED");
      } finally {
        release?.();
        await privacyRun;
        await claimRun;
      }
    },
  );
  it("commits stale recovery before required ownership locks while an expired completion loses its session wait", async () => {
    const f = await fixture("stale-completion-race");
    const first = await claim(f);
    const canonical = await verify(f, first);
    let locked!: () => void, release!: () => void;
    const held = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const proceed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "MediaUploadSession" WHERE id=${f.session.id}::uuid FOR UPDATE`;
      locked();
      await proceed;
    });
    let finishing: ReturnType<typeof lifecycle.finalizeReady> | undefined,
      reclaim: ReturnType<typeof queue.claimNext> | undefined;
    try {
      await held;
      const expires = new Date(Date.now() + 900);
      await prisma.mediaProcessingJob.update({
        where: { id: first.id },
        data: { leaseExpiresAt: expires },
      });
      finishing = lifecycle.finalizeReady({
        jobId: first.id,
        workerId: first.leaseOwner!,
        ...capturedMediaClaim(first),
        metadata: metadata(canonical.sizeBytes),
      });
      await waitForBlockedQuery("%ayin-worker-input-session-lock%");
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, expires.getTime() - Date.now()) + 30),
      );
      reclaim = queue.claimNext("replacement-after-completion");
      await waitForBlockedQuery("%UPDATE%MediaProcessingJob%");
      release();
      await holder;
      expect(await finishing).toBeNull();
      const next = (await reclaim)!;
      expect(next.id).toBe(first.id);
      expect(next.currentOutputAttemptId).not.toBe(first.currentOutputAttemptId);
      expect(
        await prisma.mediaProcessingOutputAttempt.count({ where: { processingJobId: first.id } }),
      ).toBe(2);
      expect(
        await prisma.mediaAsset.count({ where: { videoId: first.videoId, status: "VALIDATED" } }),
      ).toBe(0);
      await verify(f, next);
    } finally {
      release?.();
      await holder;
      await finishing;
      await reclaim;
    }
  });
  it("matches the historical starts_with oracle using exact, index-eligible attempt prefix equality", async () => {
    const f = await fixture("attempt-prefix-oracle");
    const job = await claim(f);
    const attempt = await prisma.mediaProcessingOutputAttempt.findUniqueOrThrow({
      where: { id: job.currentOutputAttemptId! },
    });
    const prefix = attempt.prefix;
    const cases: Array<string | null> = [
      prefix,
      `${prefix}canonical.mp4`,
      `${prefix}canonical.mp4#reprocess-g2`,
      `${prefix}thumbnail.jpg`,
      `${prefix}hls/master.m3u8`,
      `${prefix}hls/360p/segment-000001.ts`,
      `${prefix}/extra/separator`,
      `${prefix}../suffix-is-not-normalized`,
      `${prefix}%2Fencoded-suffix`,
      `${prefix}UPPERCASE-SUFFIX`,
      prefix.slice(0, -1),
      prefix.replace("/attempts/", "/attempts//"),
      prefix.replace("channels/", "channels//"),
      prefix.replace("/videos/", "/Videos/"),
      prefix.toUpperCase(),
      prefix.replace("playback/g1/", "playback/g01/"),
      prefix.replace("playback/g1/", "playback/g0/"),
      prefix.replace("playback/g1/", "playback/g-1/"),
      prefix.replace(job.currentOutputAttemptId!, job.currentOutputAttemptId!.slice(0, -1)),
      prefix.replace(job.currentOutputAttemptId!, `${job.currentOutputAttemptId!}x`),
      prefix.replace(job.currentOutputAttemptId!, job.currentOutputAttemptId!.replace(/-4/, "-1")),
      `extra/${prefix}`,
      prefix.replace("/videos/", "%2Fvideos/"),
      "ordinary-legacy-source",
      "",
      null,
    ];
    for (const key of cases) {
      const [row] = await prisma.$queryRaw<
        Array<{ old: boolean; indexed: boolean; extracted: string | null }>
      >`SELECT COALESCE(starts_with(${key}::text, ${prefix}), false) AS old, COALESCE(${prefix} = ayin_output_attempt_prefix(${key}::text), false) AS indexed, ayin_output_attempt_prefix(${key}::text) AS extracted`;
      expect(row!.indexed, `prefix oracle: ${key}`).toBe(row!.old);
      if (row!.old) expect(row!.extracted).toBe(prefix);
    }
    // This is an access-path eligibility probe, not a production latency claim.
    // On a one-row fixture the unforced planner may rationally prefer a scan.
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
      return tx.$queryRaw<
        Array<{ "QUERY PLAN": unknown }>
      >`EXPLAIN (FORMAT JSON) SELECT EXISTS(SELECT 1 FROM "MediaProcessingOutputAttempt" WHERE prefix IN (ayin_output_attempt_prefix(${`${prefix}canonical.mp4`}::text), ayin_output_attempt_prefix(${"legacy-input"}::text)))`;
    });
    const json = JSON.stringify(plan);
    expect(json).toMatch(/Index (Only )?Scan/);
    expect(json).toContain("MediaProcessingOutputAttempt_prefix_key");
    expect(json).toContain("Index Cond");
    expect(json).not.toContain("starts_with");
  });
  it("allows privacy after retry-budget reset while retaining the original immutable attempt count and addresses", async () => {
    const f = await fixture("retry-reset-privacy");
    const first = await claim(f);
    const original = await prisma.mediaProcessingOutputAttempt.findUniqueOrThrow({
      where: { id: first.currentOutputAttemptId! },
    });
    await prisma.mediaProcessingJob.update({
      where: { id: first.id },
      data: { status: "FAILED", leaseOwner: null, leaseExpiresAt: null },
    });
    await prisma.mediaProcessingJob.update({
      where: { id: first.id },
      data: { status: "QUEUED", stage: "ADMIN_RETRY_QUEUED", attempt: 0, queuedAt: new Date(0) },
    });
    const request = await prisma.accountDeletionRequest.create({
      data: {
        accountId: f.account.id,
        state: "DEACTIVATED",
        deactivatedAt: new Date(Date.now() - 2 * 86400000),
      },
    });
    const privacy = new PrivacyLifecycleService(database, {} as never, {} as never, {} as never);
    expect(await privacy.advanceDue(new Date(), 1)).toBe(1);
    expect(
      await prisma.mediaProcessingJob.findUniqueOrThrow({ where: { id: first.id } }),
    ).toMatchObject({
      status: "CANCELLED",
      attempt: 0,
      currentOutputAttemptId: first.currentOutputAttemptId,
      inputIntegrityDigest: null,
      inputIntegrityRedactedAt: expect.any(Date),
    });
    expect(
      await prisma.mediaProcessingOutputAttempt.findUniqueOrThrow({ where: { id: original.id } }),
    ).toEqual(original);
    const barrier = await prisma.privacyMediaDeletionJob.findUniqueOrThrow({
      where: { operationKey: `processing-outputs:${first.id}` },
    });
    expect(barrier).toMatchObject({
      requestId: request.id,
      status: "PENDING",
      kind: "OUTPUT_SETTLEMENT",
    });
    const addresses = barrier.outputAddresses as {
      attempts: Array<{ id: string; attempt: number }>;
      prefixes: string[];
    };
    expect(addresses.attempts).toEqual([
      { id: original.id, attempt: original.attempt, prefix: original.prefix },
    ]);
    expect(addresses.prefixes).toContain(original.prefix);
    expect(await queue.claimNext("cannot-restart-redacted")).toBeNull();
  });
});
