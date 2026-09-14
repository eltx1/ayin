import { describe, expect, it, vi } from "vitest";

import {
  AnalyticsService,
  normalizeAnalyticsBreakdown,
  normalizeRetention,
} from "./analytics.service.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const channelId = "22222222-2222-4222-8222-222222222222";
const videoId = "33333333-3333-4333-8333-333333333333";

describe("creator analytics aggregation", () => {
  it("normalizes measured breakdown counts and coverage without inventing missing rows", () => {
    expect(
      normalizeAnalyticsBreakdown(
        [
          { value: "DIRECT", count: 6n },
          { value: "SEARCH", count: 2n },
          { value: null, count: 5n },
        ],
        10,
      ),
    ).toEqual({
      available: true,
      coverage: 0.8,
      items: [
        { value: "DIRECT", count: 6 },
        { value: "SEARCH", count: 2 },
      ],
    });
  });

  it("computes retention rates against only duration-backed measured sessions", () => {
    expect(
      normalizeRetention(
        [
          { bucket: "Start", threshold: 0, reached: 8n, total: 8n },
          { bucket: "50%", threshold: 0.5, reached: 4n, total: 8n },
          { bucket: "90%+", threshold: 0.9, reached: 2n, total: 8n },
        ],
        10,
      ),
    ).toEqual({
      available: true,
      coverage: 0.8,
      buckets: [
        { bucket: "Start", threshold: 0, viewers: 8, rate: 1 },
        { bucket: "50%", threshold: 0.5, viewers: 4, rate: 0.5 },
        { bucket: "90%+", threshold: 0.9, viewers: 2, rate: 0.25 },
      ],
    });
  });

  it("counts all buffer events while treating only non-null devices as measured", async () => {
    const analyticsCount = vi.fn().mockResolvedValue(0);
    const analyticsAggregate = vi.fn().mockResolvedValue({
      _sum: { durationDeltaMs: null },
      _avg: { durationDeltaMs: null },
      _count: { durationDeltaMs: 0 },
    });
    const analyticsGroupBy = vi.fn().mockResolvedValue([]);
    const database = {
      client: {
        analyticsEvent: {
          count: analyticsCount,
          aggregate: analyticsAggregate,
          groupBy: analyticsGroupBy,
        },
        subscription: { count: vi.fn().mockResolvedValue(0) },
        video: { findMany: vi.fn().mockResolvedValue([]) },
        adEvent: { groupBy: vi.fn().mockResolvedValue([]) },
        $queryRaw: vi.fn().mockResolvedValue([]),
      },
    };
    const service = new AnalyticsService(database as never);

    const result = await service.channelMetrics(channelId, 28);

    const bufferQuery = analyticsCount.mock.calls.find(
      ([query]) => query.where?.eventName === "VIDEO_BUFFER",
    )?.[0];
    expect(bufferQuery?.where).toEqual(
      expect.objectContaining({
        channelId,
        eventName: "VIDEO_BUFFER",
      }),
    );
    expect(bufferQuery?.where).not.toHaveProperty("durationDeltaMs");

    const deviceQuery = analyticsGroupBy.mock.calls.find(
      ([query]) => query.by?.[0] === "deviceClass",
    )?.[0];
    expect(deviceQuery?.where?.deviceClass).toEqual({ not: null });
    expect(result.playbackQuality.buffering).toMatchObject({
      events: 0,
      measuredDurationSamples: 0,
      averageDurationMs: null,
    });
    expect(result.devices).toMatchObject({
      available: false,
      coverage: 0,
      items: [],
    });
  });
});

describe("creator analytics access control", () => {
  it("returns no analytics when the account has no creator-role channel membership", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const database = { client: { channelMember: { findFirst } } };
    const service = new AnalyticsService(database as never);

    await expect(service.creatorMetrics(accountId, 28)).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accountId,
          role: { in: ["OWNER", "ADMIN", "EDITOR"] },
        }),
      }),
    );
  });

  it("routes an authorized creator only to the channel resolved from membership", async () => {
    const database = {
      client: {
        channelMember: { findFirst: vi.fn().mockResolvedValue({ channelId }) },
      },
    };
    const service = new AnalyticsService(database as never);
    const metrics = { views: 7 } as never;
    const channelMetrics = vi.spyOn(service, "channelMetrics").mockResolvedValue(metrics);

    await expect(service.creatorMetrics(accountId, 7)).resolves.toBe(metrics);
    expect(channelMetrics).toHaveBeenCalledWith(channelId, 7);
  });
});

describe("analytics privacy", () => {
  it("stores pseudonymous ids and strips raw IP/location metadata while retaining coarse country", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const database = {
      client: {
        video: {
          findMany: vi.fn().mockResolvedValue([{ id: videoId, channelId }]),
        },
        channel: { findMany: vi.fn().mockResolvedValue([]) },
        analyticsEvent: { createMany },
      },
    };
    const service = new AnalyticsService(database as never);

    await service.ingest(
      [
        {
          clientEventId: "44444444-4444-4444-8444-444444444444",
          schemaVersion: 1,
          eventName: "VIDEO_START",
          occurredAt: new Date().toISOString(),
          sessionId: "session-1234567890abcdef",
          videoId,
          source: "WEB",
          metadata: {
            trafficSource: "DIRECT",
            ipAddress: "203.0.113.10",
            latitude: 30.0444,
            longitude: 31.2357,
          },
        },
      ],
      { countryCode: "us" },
    );

    const written = createMany.mock.calls[0]?.[0]?.data?.[0];
    expect(written.sessionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(written.metadata).toEqual({
      trafficSource: "DIRECT",
      countryCode: "US",
    });
    expect(JSON.stringify(written)).not.toContain("203.0.113.10");
  });
});
