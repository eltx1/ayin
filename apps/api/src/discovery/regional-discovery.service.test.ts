import { describe, expect, it, vi } from "vitest";

import type { DatabaseService } from "../database/database.service.js";
import { evaluatePolicy } from "../video-policy/video-policy.service.js";
import {
  REGIONAL_DISCOVERY_MIN_COHORT,
  RegionalDiscoveryService,
} from "./regional-discovery.service.js";

interface TargetConfig {
  key: string;
  regions: string[];
}

function createService(
  aggregateRows: Array<{ entityKey: string; score: number }> = [],
  targetConfigs: TargetConfig[] = [],
) {
  const aggregateFindMany = vi.fn().mockResolvedValue(aggregateRows);
  const homeRowFindMany = vi.fn().mockResolvedValue(
    targetConfigs.map((config) => ({
      key: config.key,
      regionTargets: config.regions.map((regionCode) => ({ regionCode })),
    })),
  );
  const homeRowFindUnique = vi.fn().mockImplementation(
    ({ where }: { where: { key: string } }) => {
      const config = targetConfigs.find((item) => item.key === where.key);
      return Promise.resolve(
        config
          ? { regionTargets: config.regions.map((regionCode) => ({ regionCode })) }
          : null,
      );
    },
  );
  const database = {
    client: {
      regionalDiscoveryAggregate: { findMany: aggregateFindMany },
      homeRowConfig: {
        findMany: homeRowFindMany,
        findUnique: homeRowFindUnique,
      },
    },
  } as unknown as DatabaseService;
  return {
    service: new RegionalDiscoveryService(database),
    aggregateFindMany,
    homeRowFindMany,
    homeRowFindUnique,
  };
}

const videos = [
  { id: "video-a", type: "VIDEO" },
  { id: "video-b", type: "VIDEO" },
  { id: "video-c", type: "VIDEO" },
];

describe("RegionalDiscoveryService", () => {
  it("uses a known coarse region as an optional ranking input", async () => {
    const { service, aggregateFindMany } = createService([
      { entityKey: "video:video-c", score: 100 },
      { entityKey: "video:video-a", score: 1 },
    ]);

    const ranked = await service.rankItems("de", "POPULAR_CONTENT", videos);

    expect(ranked.map((item) => item.id)).toEqual([
      "video-c",
      "video-a",
      "video-b",
    ]);
    expect(aggregateFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          regionCode: "DE",
          cohortSize: { gte: REGIONAL_DISCOVERY_MIN_COHORT },
        }),
      }),
    );
  });

  it("keeps global order for an unknown region without querying regional data", async () => {
    const { service, aggregateFindMany } = createService([
      { entityKey: "video:video-c", score: 100 },
    ]);

    const ranked = await service.rankItems(undefined, "POPULAR_CONTENT", videos);

    expect(ranked).toEqual(videos);
    expect(aggregateFindMany).not.toHaveBeenCalled();
  });

  it("falls back to global order when the privacy-safe cohort has no qualifying data", async () => {
    const { service } = createService([]);

    const ranked = await service.rankItems("BR", "CATALOG", videos);

    expect(ranked).toEqual(videos);
  });

  it("keeps rights filtering authoritative over regional ranking", async () => {
    const { service } = createService([
      { entityKey: "video:video-a", score: 1_000 },
      { entityKey: "video:video-b", score: 10 },
      { entityKey: "video:video-c", score: 5 },
    ]);
    const blocked = evaluatePolicy(
      {
        videoId: "video-a",
        maturityLevel: "GENERAL",
        kidsEligible: false,
        allowedTerritories: [],
        blockedTerritories: ["DE"],
        rightsExpiresAt: null,
        ageRestriction: "NONE",
      },
      null,
      { countryCode: "DE" },
    );
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe("REGION_BLOCKED");

    const rightsFiltered = videos.filter((video) => video.id !== "video-a");
    const ranked = await service.rankItems(
      "DE",
      "POPULAR_CONTENT",
      rightsFiltered,
    );

    expect(ranked.map((item) => item.id)).not.toContain("video-a");
  });

  it("supports an Admin regional row while keeping untargeted rows global", async () => {
    const { service } = createService([], [
      { key: "regional-picks", regions: ["DE"] },
      { key: "global-picks", regions: [] },
    ]);
    const rows = [
      {
        key: "regional-picks",
        source: "EDITOR_PICKS",
        items: videos.slice(0, 1),
      },
      {
        key: "global-picks",
        source: "EDITOR_PICKS",
        items: videos.slice(1, 2),
      },
    ];

    const knownRegion = await service.rankAndTargetRows("DE", true, rows);
    expect(knownRegion.map((row) => row.key)).toEqual([
      "regional-picks",
      "global-picks",
    ]);

    const differentRegion = await service.rankAndTargetRows("JP", true, rows);
    expect(differentRegion.map((row) => row.key)).toEqual(["global-picks"]);

    const unknownRegion = await service.rankAndTargetRows(undefined, true, rows);
    expect(unknownRegion.map((row) => row.key)).toEqual(["global-picks"]);
  });

  it("exposes category affinity only from privacy-safe regional aggregates", async () => {
    const { service, aggregateFindMany } = createService([
      { entityKey: "category:science-fiction", score: 0.9 },
    ]);

    const affinity = await service.categoryAffinity("jp", [
      "Science Fiction",
      "Drama",
    ]);

    expect(affinity.get("science-fiction")).toBe(0.9);
    expect(aggregateFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          regionCode: "JP",
          signal: "CATEGORY_AFFINITY",
          cohortSize: { gte: REGIONAL_DISCOVERY_MIN_COHORT },
        }),
      }),
    );
  });
});
