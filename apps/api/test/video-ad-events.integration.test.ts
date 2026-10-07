import { randomUUID } from "node:crypto";

import { createPrismaClient, type Prisma } from "@ayin/db";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { VideoAdService, type VideoAdEventInput } from "../src/ads/video-ad.service.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)("Concurrent video-ad event persistence", () => {
  const prisma = createPrismaClient(databaseUrl);
  const peer = createPrismaClient(databaseUrl);
  const services = [prisma, peer].map(
    (client) =>
      new VideoAdService(
        { client } as ConstructorParameters<typeof VideoAdService>[0],
        {} as ConstructorParameters<typeof VideoAdService>[1],
        {} as ConstructorParameters<typeof VideoAdService>[2],
        {} as ConstructorParameters<typeof VideoAdService>[3],
      ),
  );
  const service = services[0]!;
  let videoId: string;

  beforeEach(async () => {
    // This suite requires the explicit disposable TEST_DATABASE_URL, matching
    // the existing advertising integration fixtures. No DATABASE_URL fallback.
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS ayin_video_event_init_delay ON "AdPlacement"',
    );
    await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS ayin_video_event_init_delay()");
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Channel", "AdPlacement" CASCADE');
    const channel = await prisma.channel.create({
      data: { name: "Synthetic ad-event owner", handle: `ad-events-${randomUUID()}` },
    });
    const video = await prisma.video.create({
      data: {
        channelId: channel.id,
        title: "Synthetic ad-event video",
        slug: `ad-events-${randomUUID()}`,
        status: "PUBLISHED",
        visibility: "PUBLIC",
      },
    });
    videoId = video.id;
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS ayin_video_event_init_delay ON "AdPlacement"',
    );
    await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS ayin_video_event_init_delay()");
  });
  afterAll(() => Promise.all([prisma.$disconnect(), peer.$disconnect()]));

  function event(overrides: Partial<VideoAdEventInput> = {}): VideoAdEventInput {
    return {
      videoId,
      slot: "PRE_ROLL",
      provider: "GOOGLE_IMA",
      eventType: "REQUEST",
      requestId: randomUUID(),
      sessionId: "synthetic-concurrent-session",
      ...overrides,
    };
  }

  it("persists every concurrent event while initializing one previously absent placement", async () => {
    // Delay only insertion into this isolated fixture to deterministically
    // expose the existing SELECT/INSERT upsert race, not change uniqueness.
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ayin_video_event_init_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key = 'player_pre_roll' THEN PERFORM pg_sleep(0.05); END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER ayin_video_event_init_delay BEFORE INSERT ON "AdPlacement" FOR EACH ROW EXECUTE FUNCTION ayin_video_event_init_delay()',
    );
    const inputs = Array.from({ length: 32 }, () => event());
    const results = await Promise.allSettled(
      inputs.map((input, index) => services[index % 2]!.recordEvent(input)),
    );
    const failures = results
      .filter((result) => result.status === "rejected")
      .map((result) => {
        const error = result.reason as Prisma.PrismaClientKnownRequestError;
        return { name: error.name, code: error.code, meta: error.meta };
      });
    expect(failures).toEqual([]);
    const placements = await prisma.adPlacement.findMany({ where: { key: "player_pre_roll" } });
    expect(placements).toHaveLength(1);
    const rows = await prisma.adEvent.findMany({
      where: { videoId },
      orderBy: { requestId: "asc" },
    });
    expect(rows).toHaveLength(inputs.length);
    expect(new Set(rows.map((row) => row.id)).size).toBe(inputs.length);
    expect(rows.every((row) => row.placementId === placements[0]!.id)).toBe(true);
    expect(rows.map((row) => row.requestId).sort()).toEqual(
      inputs.map((input) => input.requestId).sort(),
    );
  });

  it("retains existing placement metadata and updatedAt while preserving existing event semantics", async () => {
    const placement = await prisma.adPlacement.create({
      data: {
        key: "player_pre_roll",
        name: "Reviewed existing placement",
        inventoryFamily: "IN_PLAYER_VIDEO",
        format: "PRE_ROLL",
        enabled: false,
        config: { reviewed: true, note: "Do not rewrite while recording events" },
        createdAt: new Date("2020-01-01T00:00:00Z"),
        updatedAt: new Date("2035-01-01T00:00:00Z"),
      },
    });
    const input = event({
      eventType: "ERROR",
      source: "EXTERNAL_VAST",
      errorCode: "SYNTHETIC_ERROR",
    });
    const results = await Promise.all([service.recordEvent(input), service.recordEvent(input)]);
    expect(new Set(results.map((result) => result.id)).size).toBe(2);
    expect(await prisma.adPlacement.findUniqueOrThrow({ where: { id: placement.id } })).toEqual(
      placement,
    );
    const events = await prisma.adEvent.findMany({ where: { videoId } });
    expect(events).toHaveLength(2);
    for (const row of events)
      expect(row).toMatchObject({
        placementId: placement.id,
        eventType: "ERROR",
        requestId: input.requestId,
        sessionId: input.sessionId,
        metadata: { provider: "GOOGLE_IMA", source: "EXTERNAL_VAST", errorCode: "SYNTHETIC_ERROR" },
      });
  });

  it("surfaces an unrelated actual event foreign-key failure without claiming persistence", async () => {
    await expect(service.recordEvent(event({ videoId: randomUUID() }))).rejects.toMatchObject({
      code: "P2003",
    });
    expect(await prisma.adEvent.count()).toBe(0);
  });
});
