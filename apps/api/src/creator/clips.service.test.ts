import { describe, expect, it, vi } from "vitest";

import { ClipsService } from "./clips.service.js";

describe("ClipsService", () => {
  const settings = (enabled = true) => ({
    get: vi.fn(async (key: string) => {
      if (key === "clipsEnabled") return enabled;
      if (key === "clipsAdFrequency") return 6;
      if (key === "clipsAdsEnabled") return false;
      return true;
    }),
  });

  it("returns no catalog rows when the global Clips switch is disabled", async () => {
    const database = { client: { $queryRaw: vi.fn(), video: { findMany: vi.fn() } } };
    const policy = { filterAvailableVideoIds: vi.fn() };
    const service = new ClipsService(database as never, settings(false) as never, policy as never);
    const result = await service.feed({ take: 12 });
    expect(result.enabled).toBe(false);
    expect(database.client.$queryRaw).not.toHaveBeenCalled();
    expect(database.client.video.findMany).not.toHaveBeenCalled();
  });

  it("selects the policy-aware page before hydrating public playable Clip rows", async () => {
    const first = "00000000-0000-4000-8000-000000000001";
    const second = "00000000-0000-4000-8000-000000000002";
    const third = "00000000-0000-4000-8000-000000000003";
    const queryRaw = vi.fn(async () => [{ id: first }, { id: second }, { id: third }]);
    const findMany = vi.fn(async () => [
      {
        id: second,
        slug: "second",
        title: "Second",
        description: null,
        durationMs: 20_000,
        publishedAt: new Date(),
        channel: { id: "channel", handle: "creator", name: "Creator" },
        mediaAssets: [],
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
        mediaAssets: [],
        _count: { reactions: 1 },
      },
    ]);
    const database = { client: { $queryRaw: queryRaw, video: { findMany } } };
    const policy = {
      filterAvailableVideoIds: vi.fn(async (ids: string[]) => new Set(ids)),
    };
    const service = new ClipsService(database as never, settings() as never, policy as never);

    const result = await service.feed({ take: 2, countryCode: "JP" });

    expect(queryRaw).toHaveBeenCalledTimes(1);
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
      now: expect.any(Date),
    });
    expect(result.items.map((item: { id: string }) => item.id)).toEqual([first, second]);
    expect(result.nextCursor).toBe(second);
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
    });
  });
});
