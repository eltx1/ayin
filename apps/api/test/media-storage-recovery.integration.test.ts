import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ayin/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import { PlatformSettingsService } from "../src/platform-config/platform-settings.service.js";
import { MediaProcessingLifecycleService } from "../src/media/media-processing-lifecycle.service.js";
import { MediaAdaptiveRolloutService } from "../src/media/media-adaptive-rollout.service.js";
import { R2HttpError } from "../src/media/r2-sigv4.js";

const databaseDescribe = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const absent = () => new R2HttpError(404, "HEAD");

databaseDescribe("storage recovery verification and bounded continuation", () => {
  let queryCount = 0;
  const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
  const measured = prisma.$extends({
    query: {
      async $allOperations({ args, query }) {
        queryCount += 1;
        return query(args);
      },
    },
  });
  const database = { client: measured } as unknown as DatabaseService;
  const settings = new PlatformSettingsService(database);
  const headObject = vi.fn();
  const rollout = new MediaAdaptiveRolloutService(
    database,
    settings,
    { isEnabled: async () => false } as never,
    new MediaProcessingLifecycleService(database),
    {} as never,
    { headObject } as never,
  );
  beforeEach(async () => {
    headObject.mockReset();
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
    await prisma.$disconnect();
  });

  async function fixture(n = 1, playback = true) {
    const suffix = randomUUID();
    const actor = await prisma.account.create({
      data: { email: `${suffix}@test.invalid`, displayName: "Storage operator" },
    });
    const channel = await prisma.channel.create({
      data: { handle: suffix, name: "Storage", status: "ACTIVE" },
    });
    const video = await prisma.video.create({
      data: {
        id: id(n),
        channelId: channel.id,
        slug: suffix,
        title: "Storage",
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
    await prisma.mediaProcessingJob.create({
      data: {
        videoId: video.id,
        generation: 1,
        status: "READY",
        sourceMimeType: "video/mp4",
        sourceSizeBytes: 1024n,
        stagingKey: `${key}#source`,
        inputR2ObjectKey: key,
        outputR2ObjectKey: key,
      },
    });
    const generation = playback
      ? await prisma.mediaPlaybackGeneration.create({
          data: {
            id: id(n),
            videoId: video.id,
            generation: 1,
            status: "READY",
            fallbackStatus: "READY",
            hlsMasterStatus: "READY",
            fallbackR2ObjectKey: key,
            hlsMasterR2ObjectKey: `${video.id}/g1.m3u8`,
            renditions: {
              create: {
                identity: "360p",
                width: 640,
                height: 360,
                videoBitrateKbps: 800,
                audioBitrateKbps: 96,
                playlistR2ObjectKey: `${video.id}/360/index.m3u8`,
                segmentR2Prefix: `${video.id}/360/`,
                status: "READY",
              },
            },
          },
        })
      : null;
    return { actor, video, generation };
  }

  it.each([
    new R2HttpError(403, "HEAD"),
    new R2HttpError(503, "HEAD"),
    new Error("timeout"),
    new TypeError("network unavailable"),
  ])("preserves healthy playback on uncertain storage: %s", async (failure) => {
    const { actor } = await fixture();
    headObject.mockRejectedValue(failure);
    await expect(rollout.recover("DB_MANIFEST_MISSING", 1, actor.id)).rejects.toBe(failure);
    expect(await prisma.mediaPlaybackGeneration.count({ where: { status: "READY" } })).toBe(1);
    expect(await prisma.mediaProcessingJob.count({ where: { status: "QUEUED" } })).toBe(0);
    expect(await prisma.adminAuditLog.count()).toBe(0);
  });

  it("does not commit earlier missing findings when a later storage check fails", async () => {
    const { actor } = await fixture(1);
    await fixture(2);
    headObject.mockRejectedValueOnce(absent()).mockRejectedValueOnce(new R2HttpError(500, "HEAD"));
    await expect(rollout.recover("DB_MANIFEST_MISSING", 2, actor.id)).rejects.toMatchObject({
      status: 500,
    });
    expect(await prisma.mediaPlaybackGeneration.count({ where: { status: "READY" } })).toBe(2);
    expect(await prisma.adminAuditLog.count()).toBe(0);
  });

  it("continues a short page after each bounded result even when the previous anchor is removed", async () => {
    const { actor } = await fixture(1);
    await fixture(2);
    await fixture(3);
    headObject.mockRejectedValue(absent());
    const first = await rollout.recover("DB_MANIFEST_MISSING", 1, actor.id);
    expect(first).toMatchObject({ detected: 1, requeued: 1, scanned: 1, nextCursor: id(1) });
    if (!("nextCursor" in first)) throw new Error("Expected a manifest scan result");
    await prisma.mediaPlaybackGeneration.delete({ where: { id: id(1) } });
    const second = await rollout.recover("DB_MANIFEST_MISSING", 1, actor.id, first.nextCursor!);
    expect(second).toMatchObject({ detected: 1, requeued: 1, scanned: 1, nextCursor: id(2) });
    if (!("nextCursor" in second)) throw new Error("Expected a manifest scan result");
    const third = await rollout.recover("DB_MANIFEST_MISSING", 1, actor.id, second.nextCursor!);
    expect(third).toMatchObject({ detected: 1, requeued: 1, scanned: 1, nextCursor: null });
    expect(await prisma.adminAuditLog.count({ where: { action: "media_adaptive.recovery" } })).toBe(
      3,
    );
    expect(await prisma.mediaProcessingJob.count({ where: { status: "QUEUED" } })).toBe(3);
  });

  it("does not downgrade a generation whose manifest changed after verification began", async () => {
    const { actor, generation } = await fixture();
    headObject.mockImplementationOnce(async () => {
      await prisma.mediaPlaybackGeneration.update({
        where: { id: generation!.id },
        data: { hlsMasterR2ObjectKey: "replacement/master.m3u8" },
      });
      throw absent();
    });
    expect(await rollout.recover("DB_MANIFEST_MISSING", 1, actor.id)).toMatchObject({
      detected: 0,
      requeued: 0,
    });
    expect(
      await prisma.mediaPlaybackGeneration.findUnique({ where: { id: generation!.id } }),
    ).toMatchObject({ status: "READY", hlsMasterR2ObjectKey: "replacement/master.m3u8" });
  });

  it("retains unqueued orphan candidates when capacity fills within a scan", async () => {
    const { actor } = await fixture(1, false);
    await fixture(2, false);
    await fixture(3, false);
    await prisma.$transaction((tx) =>
      settings.setInTransaction(tx, "mediaHlsBackfillMaxInFlight", 1),
    );
    headObject.mockResolvedValue({ sizeBytes: 100 });
    const first = await rollout.recover("VERIFIED_HLS_MISSING_DB", 3, actor.id);
    expect(first).toMatchObject({ detected: 3, requeued: 1, nextCursor: null, hasMore: true });
    await prisma.mediaProcessingJob.updateMany({
      where: { status: "QUEUED" },
      data: { status: "READY" },
    });
    // The first video now has a durable playback row; the rescan filters it out.
    await prisma.mediaPlaybackGeneration.create({
      data: {
        videoId: id(1),
        generation: 2,
        fallbackR2ObjectKey: "done/g2.mp4",
        hlsMasterR2ObjectKey: "done/g2.m3u8",
      },
    });
    if (!("nextCursor" in first)) throw new Error("Expected an orphan scan result");
    const second = await rollout.recover(
      "VERIFIED_HLS_MISSING_DB",
      3,
      actor.id,
      first.nextCursor ?? undefined,
    );
    expect(second).toMatchObject({ detected: 2, requeued: 1, hasMore: true });
    expect(
      await prisma.mediaProcessingJob.count({
        where: { videoId: id(2), generation: 2, status: "QUEUED" },
      }),
    ).toBe(1);
  });

  it("filters before LIMIT and resumes through 260 eligible videos with bounded queries", async () => {
    const { actor, video } = await fixture(1, false);
    const data = Array.from({ length: 262 }, (_, i) => ({
      id: id(i + 2),
      channelId: video.channelId,
      slug: `bounded-${i}`,
      title: "Bounded",
      status: "PUBLISHED" as const,
      visibility: "PUBLIC" as const,
    }));
    await prisma.video.createMany({ data });
    await prisma.mediaAsset.createMany({
      data: data.map((row) => ({
        videoId: row.id,
        channelId: row.channelId,
        kind: "SOURCE_VIDEO" as const,
        status: "VALIDATED" as const,
        r2ObjectKey: `${row.id}/g1.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 1024n,
      })),
    });
    await prisma.mediaProcessingJob.createMany({
      data: data.map((row) => ({
        videoId: row.id,
        generation: 1,
        status: "READY" as const,
        sourceMimeType: "video/mp4",
        sourceSizeBytes: 1024n,
        stagingKey: `${row.id}/source`,
        outputR2ObjectKey: `${row.id}/g1.mp4`,
      })),
    });
    await prisma.video.update({ where: { id: id(1) }, data: { visibility: "PRIVATE" } });
    await prisma.video.update({ where: { id: id(2) }, data: { status: "DRAFT" } });
    await prisma.mediaProcessingJob.updateMany({
      where: { videoId: id(3) },
      data: { status: "INGESTING" },
    });
    headObject.mockRejectedValue(absent());
    queryCount = 0;
    const first = await rollout.recover("VERIFIED_HLS_MISSING_DB", 20, actor.id);
    const largeScanQueries = queryCount;
    expect(largeScanQueries).toBeLessThanOrEqual(15);
    expect(first).toMatchObject({ detected: 0, scanned: 250, nextCursor: id(253), hasMore: true });
    expect(headObject).toHaveBeenCalledTimes(250);
    queryCount = 0;
    if (!("nextCursor" in first)) throw new Error("Expected an orphan scan result");
    const second = await rollout.recover(
      "VERIFIED_HLS_MISSING_DB",
      20,
      actor.id,
      first.nextCursor!,
    );
    expect(second).toMatchObject({ detected: 0, scanned: 10, nextCursor: null, hasMore: false });
    expect(headObject).toHaveBeenCalledTimes(260);
    expect(queryCount).toBe(largeScanQueries);
  });
});
