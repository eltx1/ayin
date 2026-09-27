import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import { PlatformSettingsService } from "../src/platform-config/platform-settings.service.js";
import { MediaProcessingQueueService } from "../src/media/media-processing-queue.service.js";
import { MediaProcessingLifecycleService } from "../src/media/media-processing-lifecycle.service.js";
import { MediaAdaptiveRolloutService } from "../src/media/media-adaptive-rollout.service.js";
import { ADAPTIVE_BACKFILL_MARKER } from "../src/media/media-adaptive-rollout.js";

const databaseDescribe = process.env.TEST_DATABASE_URL ? describe : describe.skip;
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

databaseDescribe("bounded recovery and durable rollout controls", () => {
  const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
  const database = { client: prisma } as unknown as DatabaseService;
  const settings = new PlatformSettingsService(database);
  const queue = new MediaProcessingQueueService(database, settings);
  const lifecycle = new MediaProcessingLifecycleService(database);
  const rollout = new MediaAdaptiveRolloutService(
    database,
    settings,
    { isEnabled: async () => false } as never,
    lifecycle,
    queue,
    { headObject: async () => ({ sizeBytes: 0 }) } as never,
  );
  beforeEach(async () => {
    vi.restoreAllMocks();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Account", "Channel", "PlatformSetting", "MediaProcessingWorker" CASCADE',
    );
    await prisma.$transaction(async (tx) => {
      await settings.setInTransaction(tx, "mediaHlsEnabled", true);
      await settings.setInTransaction(tx, "mediaHlsBackfillEnabled", true);
      await settings.setInTransaction(tx, "mediaHlsBackfillPaused", false);
      await settings.setInTransaction(tx, "mediaHlsBackfillMaxInFlight", 4);
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function fixture(status: "READY" | "FAILED" | "PROCESSING" = "READY") {
    const suffix = randomUUID();
    const actor = await prisma.account.create({
      data: { email: `${suffix}@test.invalid`, displayName: "Recovery operator" },
    });
    const channel = await prisma.channel.create({
      data: { handle: suffix, name: "Recovery", status: "ACTIVE" },
    });
    const video = await prisma.video.create({
      data: {
        channelId: channel.id,
        slug: suffix,
        title: "Recovery",
        status: "PUBLISHED",
        visibility: "PUBLIC",
      },
    });
    const key = `test/${video.id}/g1.mp4`;
    await prisma.mediaAsset.create({
      data: {
        videoId: video.id,
        channelId: channel.id,
        kind: "SOURCE_VIDEO",
        status: "VALIDATED",
        r2ObjectKey: key,
        mimeType: "video/mp4",
        sizeBytes: 1024n,
      },
    });
    const job = await prisma.mediaProcessingJob.create({
      data: {
        videoId: video.id,
        generation: 1,
        status,
        sourceMimeType: "video/mp4",
        sourceSizeBytes: 1024n,
        stagingKey: `${key}${ADAPTIVE_BACKFILL_MARKER}1`,
        inputR2ObjectKey: key,
        outputR2ObjectKey: key,
        ...(status === "PROCESSING"
          ? {
              attempt: 1,
              leaseOwner: "old-owner",
              leaseWorkerId: "old-worker",
              leaseExpiresAt: new Date(Date.now() - 60_000),
            }
          : {}),
      },
    });
    return { actor, video, job };
  }

  it("limits the actual stale-job scope, separates failed/requeued, and audits only committed results", async () => {
    const rows = await Promise.all(Array.from({ length: 4 }, () => fixture("PROCESSING")));
    const oldest = rows[0]!;
    await prisma.mediaProcessingJob.update({
      where: { id: oldest.job.id },
      data: { attempt: 999, leaseExpiresAt: new Date(Date.now() - 120_000) },
    });
    const first = await rollout.recover("STALE_PROCESSING", 2, oldest.actor.id);
    expect(first).toEqual({ mode: "STALE_PROCESSING", recovered: 2, requeued: 1, failed: 1 });
    expect(await prisma.mediaProcessingJob.count({ where: { status: "PROCESSING" } })).toBe(2);
    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { actorAccountId: oldest.actor.id, action: "media_adaptive.recovery" },
    });
    expect(audit.metadata).toMatchObject({
      requestedBatchSize: 2,
      recovered: 2,
      requeued: 1,
      failed: 1,
    });
    const rest = await queue.recoverStale(); // Existing automatic, unbounded semantics retained.
    expect(rest).toEqual({ recovered: 2, requeued: 2, failed: 0 });
  });

  it("serializes concurrent bounded recoveries without counting a job twice", async () => {
    await Promise.all(Array.from({ length: 3 }, () => fixture("PROCESSING")));
    const results = await Promise.all([
      queue.recoverStale(undefined, 1),
      queue.recoverStale(undefined, 1),
    ]);
    expect(results).toEqual([
      { recovered: 1, requeued: 1, failed: 0 },
      { recovered: 1, requeued: 1, failed: 0 },
    ]);
    expect(await prisma.mediaProcessingJob.count({ where: { status: "PROCESSING" } })).toBe(1);
    expect(await prisma.mediaProcessingJob.count({ where: { status: "QUEUED" } })).toBe(2);
  });

  it("does not count or overwrite a lease renewed after selection", async () => {
    const { job } = await fixture("PROCESSING");
    const selected = gate();
    const proceed = gate();
    const extended = prisma.$extends({
      query: {
        mediaProcessingJob: {
          async findMany({ args, query }) {
            const rows = await query(args);
            selected.open();
            await proceed.promise;
            return rows;
          },
        },
      },
    });
    const racingQueue = new MediaProcessingQueueService(
      { client: extended } as unknown as DatabaseService,
      settings,
    );
    const pending = racingQueue.recoverStale(undefined, 1);
    await selected.promise;
    await prisma.mediaProcessingJob.update({
      where: { id: job.id },
      data: { leaseOwner: "renewed-owner", leaseExpiresAt: new Date(Date.now() + 60_000) },
    });
    proceed.open();
    expect(await pending).toEqual({ recovered: 0, requeued: 0, failed: 0 });
    expect(await prisma.mediaProcessingJob.findUnique({ where: { id: job.id } })).toMatchObject({
      status: "PROCESSING",
      leaseOwner: "renewed-owner",
    });
  });

  it("rolls back recovered jobs if the transactional audit fails", async () => {
    const { job } = await fixture("PROCESSING");
    await expect(rollout.recover("STALE_PROCESSING", 1, randomUUID())).rejects.toMatchObject({
      code: "P2003",
    });
    expect(await prisma.mediaProcessingJob.findUnique({ where: { id: job.id } })).toMatchObject({
      status: "PROCESSING",
      leaseOwner: "old-owner",
    });
  });

  it.each(["enqueue", "FAILED_BACKFILL"] as const)(
    "rechecks committed pause after a stale %s preflight",
    async (mode) => {
      const { actor } = await fixture(mode === "enqueue" ? "READY" : "FAILED");
      const read = gate();
      const proceed = gate();
      const real = rollout.controls.bind(rollout);
      vi.spyOn(rollout, "controls").mockImplementationOnce(async () => {
        const old = await real();
        read.open();
        await proceed.promise;
        return old;
      });
      const pending =
        mode === "enqueue" ? rollout.enqueueBatch(1, actor.id) : rollout.recover(mode, 1, actor.id);
      await read.promise;
      await rollout.setPaused(true, actor.id);
      proceed.open();
      expect(await pending).toMatchObject({ reason: "BACKFILL_DISABLED_OR_PAUSED" });
      expect(await prisma.mediaProcessingJob.count({ where: { status: "QUEUED" } })).toBe(0);
      expect(
        await prisma.adminAuditLog.count({ where: { action: "media_adaptive.backfill_pause" } }),
      ).toBe(1);
      await rollout.setPaused(false, actor.id);
      expect(
        mode === "enqueue"
          ? (await rollout.enqueueBatch(1, actor.id)).enqueued
          : (await rollout.recover(mode, 1, actor.id)).recovered,
      ).toBe(1);
    },
  );

  it("serializes a settings-page pause behind a batch already inside its mutation boundary", async () => {
    const { actor } = await fixture();
    const entered = gate();
    const proceed = gate();
    const real = lifecycle.createAdaptiveBackfillJob.bind(lifecycle);
    vi.spyOn(lifecycle, "createAdaptiveBackfillJob").mockImplementationOnce(async (tx, id) => {
      entered.open();
      await proceed.promise;
      return real(tx, id);
    });
    const batch = rollout.enqueueBatch(1, actor.id);
    await entered.promise;
    const pause = prisma.$transaction((tx) =>
      settings.setInTransaction(tx, "mediaHlsBackfillPaused", true),
    );
    try {
      await vi.waitFor(
        async () => {
          const waiting = await prisma.$queryRaw<
            Array<{ count: bigint }>
          >`SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = 86192042 AND NOT granted`;
          expect(Number(waiting[0]?.count)).toBeGreaterThan(0);
        },
        { timeout: 2000, interval: 10 },
      );
    } finally {
      proceed.open();
    }
    expect((await batch).enqueued).toBe(1);
    await pause;
    expect(await rollout.enqueueBatch(1, actor.id)).toMatchObject({
      enqueued: 0,
      reason: "BACKFILL_DISABLED_OR_PAUSED",
    });
    expect(await prisma.mediaProcessingJob.count({ where: { status: "QUEUED" } })).toBe(1);
  });
});
