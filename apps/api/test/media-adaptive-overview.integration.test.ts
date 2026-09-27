import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createPrismaClient } from "@ayin/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import { PlatformSettingsService } from "../src/platform-config/platform-settings.service.js";
import { MediaAdaptiveRolloutService } from "../src/media/media-adaptive-rollout.service.js";

const databaseDescribe = process.env.TEST_DATABASE_URL ? describe : describe.skip;
databaseDescribe("adaptive overview database aggregation", () => {
  const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
  const rawResults: unknown[] = [];
  const bounded = prisma.$extends({
    query: {
      $allOperations: async ({ model, operation, args, query }) => {
        // The old implementation transferred every eligible video and an
        // unbounded generation-ID list. Keep that cost from returning.
        if (model === "Video" && operation === "findMany")
          throw new Error("Overview must not materialize catalog videos");
        if (model === "MediaPlaybackGeneration" && operation === "findMany")
          expect((args as { take?: number }).take).toBeLessThanOrEqual(1000);
        const result = await query(args);
        if (operation === "$queryRaw") rawResults.push(result);
        return result;
      },
    },
  });
  const db = { client: bounded } as unknown as DatabaseService;
  const rollout = new MediaAdaptiveRolloutService(
    db,
    new PlatformSettingsService(db),
    { isEnabled: async () => false } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const clean = () =>
    prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Channel", "MediaPlaybackGeneration", "PlatformSetting", "AnalyticsEvent" CASCADE',
    );
  beforeEach(async () => {
    await clean();
    rawResults.length = 0;
  });
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });
  async function video(publishedAt: Date | null = new Date("2026-01-01T00:00:00Z")) {
    const id = randomUUID();
    const channel = await prisma.channel.create({
      data: { handle: id, name: "Overview", status: "ACTIVE" },
    });
    const row = await prisma.video.create({
      data: {
        channelId: channel.id,
        slug: id,
        title: "Overview",
        status: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt,
      },
    });
    const source = await prisma.mediaAsset.create({
      data: {
        channelId: channel.id,
        videoId: row.id,
        kind: "SOURCE_VIDEO",
        status: "VALIDATED",
        mimeType: "video/mp4",
        sizeBytes: 1024n,
        r2ObjectKey: `${row.id}/source.mp4`,
      },
    });
    return { ...row, source, channel };
  }
  async function ready(videoId: string, generation = 1, protocol: "HLS" | "PROGRESSIVE" = "HLS") {
    return prisma.mediaPlaybackGeneration.create({
      data: {
        videoId,
        generation,
        status: "READY",
        fallbackStatus: "READY",
        hlsMasterStatus: "READY",
        fallbackR2ObjectKey: `${videoId}/g${generation}.mp4`,
        hlsMasterR2ObjectKey: `${videoId}/g${generation}.m3u8`,
        renditions: {
          create: {
            identity: "360p",
            width: 640,
            height: 360,
            videoBitrateKbps: 800,
            audioBitrateKbps: 96,
            playlistR2ObjectKey: `${videoId}/g${generation}/index.m3u8`,
            segmentR2Prefix: `${videoId}/g${generation}/`,
            status: "READY",
            protocol,
          },
        },
      },
    });
  }
  it("returns an empty summary without catalog-sized reads", async () => {
    expect((await rollout.overview()).catalog).toEqual({
      eligible: 0,
      queued: 0,
      processing: 0,
      adaptiveReady: 0,
      failed: 0,
      fallbackOnly: 0,
      oldestPending: null,
    });
    expect(rawResults).toHaveLength(1);
    expect(rawResults[0]).toHaveLength(1);
  });
  it("counts videos once and preserves source, channel and adaptive-readiness eligibility", async () => {
    const healthy = await video();
    await ready(healthy.id);
    await ready(healthy.id, 2);
    const pending = await video();
    await ready(pending.id, 1, "PROGRESSIVE");
    const privateVideo = await video();
    await prisma.video.update({ where: { id: privateVideo.id }, data: { visibility: "PRIVATE" } });
    const draft = await video();
    await prisma.video.update({ where: { id: draft.id }, data: { status: "DRAFT" } });
    const removed = await video();
    await prisma.video.update({ where: { id: removed.id }, data: { removedAt: new Date() } });
    const noChannel = await video();
    await prisma.channel.update({
      where: { id: noChannel.channelId },
      data: { status: "SUSPENDED" },
    });
    const noSource = await video();
    await prisma.mediaAsset.update({
      where: { id: noSource.source.id },
      data: { removedAt: new Date() },
    });
    // Multiple validated source assets must not multiply the catalog count.
    await prisma.mediaAsset.create({
      data: {
        channelId: pending.channelId,
        videoId: pending.id,
        kind: "SOURCE_VIDEO",
        status: "VALIDATED",
        mimeType: "video/mp4",
        sizeBytes: 1n,
        r2ObjectKey: `${pending.id}/second.mp4`,
      },
    });
    expect((await rollout.overview()).catalog).toMatchObject({
      eligible: 1,
      fallbackOnly: 1,
      adaptiveReady: 1,
      oldestPending: { videoId: pending.id, publishedAt: pending.publishedAt },
    });
  });
  it("preserves published-date ordering and falls back to creation date for null dates", async () => {
    const undated = await video(null);
    const newer = await video(new Date("2026-02-01T00:00:00Z"));
    const older = await video(new Date("2026-01-01T00:00:00Z"));
    expect((await rollout.overview()).catalog.oldestPending?.videoId).toBe(older.id);
    await ready(older.id);
    await ready(newer.id);
    expect((await rollout.overview()).catalog.oldestPending).toEqual({
      videoId: undated.id,
      publishedAt: undated.createdAt,
    });
    await ready(undated.id);
    expect((await rollout.overview()).catalog.oldestPending).toBeNull();
  });
  it("returns one summary row for a larger catalog and records fixture timing", async () => {
    const first = await video();
    const ids = Array.from({ length: 511 }, () => randomUUID());
    await prisma.video.createMany({
      data: ids.map((id) => ({
        id,
        channelId: first.channelId,
        slug: id,
        title: "Overview bulk",
        status: "PUBLISHED" as const,
        visibility: "PUBLIC" as const,
        publishedAt: new Date("2026-02-01T00:00:00Z"),
      })),
    });
    await prisma.mediaAsset.createMany({
      data: ids.map((id) => ({
        videoId: id,
        channelId: first.channelId,
        kind: "SOURCE_VIDEO" as const,
        status: "VALIDATED" as const,
        mimeType: "video/mp4",
        sizeBytes: 1024n,
        r2ObjectKey: `${id}/source.mp4`,
      })),
    });
    const started = performance.now();
    const result = await rollout.overview();
    const elapsedMs = performance.now() - started;
    expect(result.catalog).toMatchObject({
      eligible: 512,
      fallbackOnly: 512,
      adaptiveReady: 0,
      oldestPending: { videoId: first.id },
    });
    expect(rawResults).toHaveLength(1);
    expect(rawResults[0]).toHaveLength(1);
    console.info(
      JSON.stringify({
        measurement: "adaptive_overview_fixture",
        catalogVideos: 512,
        catalogRowsTransferred: 1,
        elapsedMs: Math.round(elapsedMs),
      }),
    );
  });
});
