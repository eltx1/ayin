import { describe, expect, it, vi } from "vitest";

import { ClipsService } from "./clips.service.js";

describe("ClipsService", () => {
  const settings = (enabled = true, adsEnabled = false) => ({
    get: vi.fn(async (key: string) => {
      if (key === "clipsEnabled") return enabled;
      if (key === "clipsAdFrequency") return 6;
      if (key === "clipsAdsEnabled") return adsEnabled;
      return true;
    }),
  });

  it("returns no catalog rows when the global Clips switch is disabled", async () => {
    const database = { client: { $queryRaw: vi.fn(), video: { findMany: vi.fn() } } };
    const policy = { filterAvailableVideoIds: vi.fn() };
    const service = new ClipsService(database as never, settings(false) as never, policy as never);
    const result = await service.feed({ take: 12 });
    expect(result.enabled).toBe(false);
    expect(result.viewer).toEqual({ isKids: false });
    expect(database.client.$queryRaw).not.toHaveBeenCalled();
    expect(database.client.video.findMany).not.toHaveBeenCalled();
  });

  it("selects the policy-aware page before hydrating public playable Clip rows", async () => {
    const first = "00000000-0000-4000-8000-000000000001";
    const second = "00000000-0000-4000-8000-000000000002";
    const third = "00000000-0000-4000-8000-000000000003";
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ id: first }, { id: second }, { id: third }])
      .mockResolvedValueOnce([{ assetId: "first-source" }, { assetId: "second-source" }]);
    const findMany = vi.fn(async () => [
      {
        id: second,
        slug: "second",
        title: "Second",
        description: null,
        durationMs: 20_000,
        publishedAt: new Date(),
        channel: { id: "channel", handle: "creator", name: "Creator" },
        mediaAssets: [{ id: "second-source", kind: "SOURCE_VIDEO", r2ObjectKey: "second.mp4" }],
        _count: { reactions: 0 },
      },
      {
        id: first,
        slug: "first",
        title: "First",
        description: null,
        durationMs: 20_000,
        publishedAt: new Date(),
        channel: { id: "channel", handle: "creator", name: "Creator" },
        mediaAssets: [{ id: "first-source", kind: "SOURCE_VIDEO", r2ObjectKey: "first.mp4" }],
        _count: { reactions: 1 },
      },
    ]);
    const database = { client: { $queryRaw: queryRaw, video: { findMany } } };
    const policy = {
      filterAvailableVideoIds: vi.fn(async (ids: string[]) => new Set(ids)),
    };
    const service = new ClipsService(database as never, settings() as never, policy as never);

    const result = await service.feed({ take: 2, countryCode: "JP" });

    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [first, second] },
          videoForm: "CLIP",
          status: "PUBLISHED",
          visibility: "PUBLIC",
          channel: { status: "ACTIVE", removedAt: null },
        }),
      }),
    );
    expect(policy.filterAvailableVideoIds).toHaveBeenCalledWith([second, first], {
      countryCode: "JP",
      isKidsProfile: false,
      now: expect.any(Date),
    });
    expect(result.items.map((item: { id: string }) => item.id)).toEqual([first, second]);
    expect(result.nextCursor).toBe(second);
    expect(result.viewer).toEqual({ isKids: false });
    expect(result.items[0]?.mediaAssets).toEqual([
      { kind: "SOURCE_VIDEO", r2ObjectKey: "first.mp4" },
    ]);
  });

  it("keeps the disabled response truthful without returning an ad-enabled shell", async () => {
    const database = { client: { $queryRaw: vi.fn(), video: { findMany: vi.fn() } } };
    const policy = { filterAvailableVideoIds: vi.fn() };
    const result = await new ClipsService(
      database as never,
      settings(false) as never,
      policy as never,
    ).feed({
      take: 1,
      countryCode: "JP",
    });
    expect(result).toMatchObject({
      enabled: false,
      items: [],
      nextCursor: null,
      autoplayEnabled: false,
      adPolicy: { enabled: false, minimumOrganicClips: 6 },
      viewer: { isKids: false },
    });
  });

  it.each([false, true])(
    "keeps audience and ads authoritative in empty feeds (%s)",
    async (isKids) => {
      for (const enabled of [false, true]) {
        const database = {
          client: { $queryRaw: vi.fn(async () => []), video: { findMany: vi.fn() } },
        };
        const result = await new ClipsService(
          database as never,
          settings(enabled, true) as never,
          { filterAvailableVideoIds: vi.fn() } as never,
        ).feed({ take: 2, isKidsProfile: isKids });
        expect(result.viewer).toEqual({ isKids });
        expect(result.adPolicy.enabled).toBe(enabled && !isKids);
        expect(result.items).toEqual([]);
        expect(result.nextCursor).toBeNull();
      }
    },
  );

  it("enforces Kids in SQL before pagination, hydration and final disclosure with a fresh time", async () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const finish = new Date("2026-01-01T00:01:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(start);
    try {
      const id = "00000000-0000-4000-8000-000000000001";
      const queryRaw = vi
        .fn()
        .mockResolvedValueOnce([{ id }])
        .mockResolvedValueOnce([{ assetId: "source" }]);
      const filterAvailableVideoIds = vi.fn(async () => {
        vi.setSystemTime(finish);
        return new Set([id]);
      });
      const database = {
        client: {
          $queryRaw: queryRaw,
          video: {
            findMany: vi.fn(async () => [
              {
                id,
                mediaAssets: [{ id: "source", kind: "SOURCE_VIDEO", r2ObjectKey: "source.mp4" }],
              },
            ]),
          },
        },
      };
      const result = await new ClipsService(
        database as never,
        settings(true, true) as never,
        { filterAvailableVideoIds } as never,
      ).feed({ take: 1, countryCode: "JP", isKidsProfile: true });

      expect(result.viewer).toEqual({ isKids: true });
      expect(result.adPolicy.enabled).toBe(false);
      expect(result.items).toHaveLength(1);
      expect(filterAvailableVideoIds).toHaveBeenCalledExactlyOnceWith([id], {
        countryCode: "JP",
        isKidsProfile: true,
        now: start,
      });
      const initial = queryRaw.mock.calls[0]![0];
      const final = queryRaw.mock.calls[1]![0];
      expect(initial.sql.indexOf('p."kidsEligible" = TRUE')).toBeLessThan(
        initial.sql.indexOf("LIMIT"),
      );
      expect(final.sql).toContain('m.id = selected."assetId"');
      expect(final.sql).toContain('m."r2ObjectKey" = selected."objectKey"');
      expect(final.sql).toContain('p."kidsEligible" = TRUE');
      expect(final.values).toContainEqual(finish);
      expect(final.values).not.toContainEqual(start);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the selected revoked source even when another playable source survives", async () => {
    const first = "00000000-0000-4000-8000-000000000001";
    const second = "00000000-0000-4000-8000-000000000002";
    const database = {
      client: {
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([{ id: first }, { id: second }])
          .mockResolvedValueOnce([{ assetId: "alternate" }]),
        video: {
          findMany: vi.fn(async () => [
            {
              id: first,
              mediaAssets: [
                { id: "selected", kind: "SOURCE_VIDEO", r2ObjectKey: "revoked.mp4" },
                { id: "alternate", kind: "SOURCE_VIDEO", r2ObjectKey: "alternate.mp4" },
              ],
            },
          ]),
        },
      },
    };
    const result = await new ClipsService(
      database as never,
      settings() as never,
      { filterAvailableVideoIds: vi.fn(async () => new Set([first])) } as never,
    ).feed({ take: 1 });
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBe(first);
  });

  it("does not disclose a hydrated clip rejected by the final audience policy", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const database = {
      client: {
        $queryRaw: vi.fn(async () => [{ id }]),
        video: {
          findMany: vi.fn(async () => [
            {
              id,
              mediaAssets: [{ id: "source", kind: "SOURCE_VIDEO", r2ObjectKey: "secret.mp4" }],
            },
          ]),
        },
      },
    };
    const result = await new ClipsService(
      database as never,
      settings(true, true) as never,
      { filterAvailableVideoIds: vi.fn(async () => new Set()) } as never,
    ).feed({ take: 1, isKidsProfile: true });
    expect(result.items).toEqual([]);
    expect(result.viewer).toEqual({ isKids: true });
    expect(database.client.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
