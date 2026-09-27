import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import { PlatformSettingsService } from "../src/platform-config/platform-settings.service.js";
import { MediaProcessingLifecycleService } from "../src/media/media-processing-lifecycle.service.js";
import { MediaAdaptiveRolloutService } from "../src/media/media-adaptive-rollout.service.js";

const databaseDescribe = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const stale = () => new Date(Date.now() - 30 * 60_000);
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}
databaseDescribe("incomplete HLS bounded eligible selection", () => {
  const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
  const database = { client: prisma } as unknown as DatabaseService;
  const settings = new PlatformSettingsService(database);
  const makeService = (db = database) =>
    new MediaAdaptiveRolloutService(
      db,
      settings,
      { isEnabled: async () => false } as never,
      new MediaProcessingLifecycleService(db),
      {} as never,
      {} as never,
    );
  const rollout = makeService();
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Account", "Channel", "PlatformSetting", "MediaPlaybackGeneration" CASCADE',
    );
    await prisma.$transaction(async (tx) => {
      await settings.setInTransaction(tx, "mediaHlsEnabled", true);
      await settings.setInTransaction(tx, "mediaHlsBackfillEnabled", true);
      await settings.setInTransaction(tx, "mediaHlsBackfillPaused", false);
      await settings.setInTransaction(tx, "mediaHlsBackfillMaxInFlight", 4);
    });
  });
  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Account", "Channel", "PlatformSetting", "MediaPlaybackGeneration" CASCADE',
    );
    await prisma.$disconnect();
  });
  async function fixture() {
    const suffix = randomUUID();
    const actor = await prisma.account.create({
      data: { email: `${suffix}@test.invalid`, displayName: "Incomplete operator" },
    });
    const channel = await prisma.channel.create({
      data: { handle: suffix, name: "Incomplete", status: "ACTIVE" },
    });
    const video = await prisma.video.create({
      data: {
        channelId: channel.id,
        slug: suffix,
        title: "Incomplete",
        status: "PUBLISHED",
        visibility: "PUBLIC",
      },
    });
    await prisma.mediaAsset.create({
      data: {
        videoId: video.id,
        channelId: channel.id,
        kind: "SOURCE_VIDEO",
        status: "VALIDATED",
        r2ObjectKey: `${video.id}/source.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 1024n,
      },
    });
    const generation = await playback(video.id, 1);
    return { actor, channel, video, generation };
  }
  function playback(videoId: string, generation: number, updatedAt = stale()) {
    return prisma.mediaPlaybackGeneration.create({
      data: {
        videoId,
        generation,
        status: "FAILED",
        fallbackR2ObjectKey: `${videoId}/g${generation}.mp4`,
        hlsMasterR2ObjectKey: `${videoId}/g${generation}.m3u8`,
        updatedAt,
      },
    });
  }
  function job(videoId: string, generation: number, status: "READY" | "QUEUED") {
    return prisma.mediaProcessingJob.create({
      data: {
        videoId,
        generation,
        status,
        sourceMimeType: "video/mp4",
        sourceSizeBytes: 1024n,
        stagingKey: `${videoId}#test-g${generation}`,
        outputR2ObjectKey: `${videoId}/job-g${generation}.mp4`,
      },
    });
  }
  it("does not let many older ineligible rows hide a later eligible video", async () => {
    const blocked = await fixture();
    await prisma.video.update({ where: { id: blocked.video.id }, data: { visibility: "PRIVATE" } });
    for (let generation = 2; generation <= 30; generation++)
      await playback(blocked.video.id, generation);
    const eligible = await fixture();
    const result = await rollout.recover("INCOMPLETE_HLS", 1, eligible.actor.id);
    expect(result).toEqual({ mode: "INCOMPLETE_HLS", detected: 1, requeued: 1 });
    expect(
      await prisma.mediaProcessingJob.findMany({ select: { videoId: true, generation: true } }),
    ).toEqual([{ videoId: eligible.video.id, generation: 2 }]);
    expect(
      await prisma.mediaPlaybackGeneration.findUnique({ where: { id: eligible.generation.id } }),
    ).toMatchObject({ status: "SUPERSEDED", supersededAt: expect.any(Date) });
    expect(
      await prisma.mediaPlaybackGeneration.count({
        where: { videoId: blocked.video.id, status: "FAILED" },
      }),
    ).toBe(30);
  });
  it("deduplicates before the bound and makes progress across explicit batches", async () => {
    const first = await fixture();
    for (let generation = 2; generation <= 25; generation++)
      await playback(first.video.id, generation);
    const second = await fixture();
    const third = await fixture();
    expect(await rollout.recover("INCOMPLETE_HLS", 2, first.actor.id)).toMatchObject({
      detected: 2,
      requeued: 2,
    });
    expect(await rollout.recover("INCOMPLETE_HLS", 2, first.actor.id)).toMatchObject({
      detected: 1,
      requeued: 1,
    });
    const queued = await prisma.mediaProcessingJob.findMany({
      where: { status: "QUEUED" },
      select: { videoId: true, generation: true },
    });
    expect(queued).toHaveLength(3);
    expect(queued).toEqual(
      expect.arrayContaining([
        { videoId: first.video.id, generation: 26 },
        { videoId: second.video.id, generation: 2 },
        { videoId: third.video.id, generation: 2 },
      ]),
    );
    expect(
      await prisma.mediaPlaybackGeneration.count({
        where: { videoId: first.video.id, status: "SUPERSEDED" },
      }),
    ).toBe(1);
  });
  it("excludes newer, fresh, active, healthy and unavailable sources before selection", async () => {
    const newerPlayback = await fixture();
    await playback(newerPlayback.video.id, 2, new Date());
    const newerJob = await fixture();
    await job(newerJob.video.id, 2, "READY");
    const active = await fixture();
    await job(active.video.id, 1, "QUEUED");
    const noSource = await fixture();
    await prisma.mediaAsset.updateMany({
      where: { videoId: noSource.video.id },
      data: { status: "REMOVED" },
    });
    const noChannel = await fixture();
    await prisma.channel.update({
      where: { id: noChannel.channel.id },
      data: { removedAt: new Date() },
    });
    const unpublished = await fixture();
    await prisma.video.update({ where: { id: unpublished.video.id }, data: { status: "DRAFT" } });
    const healthy = await fixture();
    await prisma.mediaPlaybackGeneration.update({
      where: { id: healthy.generation.id },
      data: {
        status: "READY",
        fallbackStatus: "READY",
        hlsMasterStatus: "READY",
        renditions: {
          create: {
            identity: "360p",
            width: 640,
            height: 360,
            videoBitrateKbps: 800,
            audioBitrateKbps: 96,
            playlistR2ObjectKey: `${healthy.video.id}/index.m3u8`,
            segmentR2Prefix: `${healthy.video.id}/segments/`,
            status: "READY",
          },
        },
      },
    });
    await playback(healthy.video.id, 2);
    const eligible = await fixture();
    expect(await rollout.recover("INCOMPLETE_HLS", 1, eligible.actor.id)).toMatchObject({
      detected: 1,
      requeued: 1,
    });
    expect(
      await prisma.mediaProcessingJob.count({
        where: { videoId: eligible.video.id, status: "QUEUED" },
      }),
    ).toBe(1);
    expect(await prisma.mediaPlaybackGeneration.count({ where: { status: "SUPERSEDED" } })).toBe(1);
  });
  it("serializes concurrent recovery against one capacity slot and audits actual results", async () => {
    const first = await fixture();
    await fixture();
    await prisma.$transaction((tx) =>
      settings.setInTransaction(tx, "mediaHlsBackfillMaxInFlight", 1),
    );
    const results = await Promise.all([
      rollout.recover("INCOMPLETE_HLS", 2, first.actor.id),
      rollout.recover("INCOMPLETE_HLS", 2, first.actor.id),
    ]);
    expect(results).toEqual(
      expect.arrayContaining([
        { mode: "INCOMPLETE_HLS", detected: 1, requeued: 1 },
        { mode: "INCOMPLETE_HLS", detected: 0, requeued: 0, reason: "IN_FLIGHT_LIMIT" },
      ]),
    );
    expect(await prisma.mediaProcessingJob.count({ where: { status: "QUEUED" } })).toBe(1);
    const audits = await prisma.adminAuditLog.findMany({ select: { metadata: true } });
    expect(audits).toHaveLength(2);
    expect(audits.map((row) => row.metadata)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mode: "INCOMPLETE_HLS", requeued: 1 }),
        expect.objectContaining({ mode: "INCOMPLETE_HLS", requeued: 0 }),
      ]),
    );
  });
  it.each(["touched", "newer"] as const)(
    "does not supersede a %s candidate after selection",
    async (kind) => {
      const row = await fixture();
      const selected = gate(),
        proceed = gate();
      let intercepted = false;
      const extended = prisma.$extends({
        query: {
          $allOperations: async ({ operation, args, query }) => {
            const result = await query(args);
            if (
              !intercepted &&
              operation === "$queryRaw" &&
              Array.isArray(result) &&
              result.some((item) => item?.videoId === row.video.id)
            ) {
              intercepted = true;
              selected.open();
              await proceed.promise;
            }
            return result;
          },
        },
      });
      const pending = makeService({ client: extended } as unknown as DatabaseService).recover(
        "INCOMPLETE_HLS",
        1,
        row.actor.id,
      );
      await selected.promise;
      try {
        if (kind === "touched")
          await prisma.mediaPlaybackGeneration.update({
            where: { id: row.generation.id },
            data: { updatedAt: new Date() },
          });
        else await playback(row.video.id, 2);
      } finally {
        proceed.open();
      }
      expect(await pending).toMatchObject({ detected: 1, requeued: 0 });
      expect(await prisma.mediaProcessingJob.count()).toBe(0);
      expect(
        await prisma.mediaPlaybackGeneration.findUnique({ where: { id: row.generation.id } }),
      ).toMatchObject({ status: "FAILED" });
    },
  );
  it("rolls back queued and superseded state when the audit cannot commit", async () => {
    const row = await fixture();
    await expect(rollout.recover("INCOMPLETE_HLS", 1, randomUUID())).rejects.toMatchObject({
      code: "P2003",
    });
    expect(await prisma.mediaProcessingJob.count()).toBe(0);
    expect(
      await prisma.mediaPlaybackGeneration.findUnique({ where: { id: row.generation.id } }),
    ).toMatchObject({ status: "FAILED", supersededAt: null });
  });
});
