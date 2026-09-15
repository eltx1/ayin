import { describe, expect, it, vi } from "vitest";

import type { DatabaseService } from "../database/database.service.js";
import {
  REGIONAL_DISCOVERY_MIN_COHORT,
  RegionalDiscoveryService,
} from "./regional-discovery.service.js";

function createService(rows: Array<{ entityKey: string; score: number }> = []) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const database = {
    client: { regionalDiscoveryAggregate: { findMany } },
  } as unknown as DatabaseService;
  return { service: new RegionalDiscoveryService(database), findMany };
}

const videos = [
  { id: "video-a", type: "VIDEO" },
  { id: "video-b", type: "VIDEO" },
  { id: "video-c", type: "VIDEO" },
];

describe("RegionalDiscoveryService", () => {
  it("uses a known coarse region as an optional ranking input", async () => {
    const { service, findMany } = createService([
      { entityKey: "video:video-c", score: 100 },
      { entityKey: "video:video-a", score: 1 },
    ]);

    const ranked = await service.rankItems("de", "POPULAR_CONTENT", videos);

    expect(ranked.map((item) => item.id)).toEqual(["video-c", "video-a", "video-b"]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          regionCode: "DE",
          cohortSize: { gte: REGIONAL_DISCOVERY_MIN_COHORT },
        }),
      }),
    );
  });

  it("keeps global order for an unknown region without querying regional data", async () => {
    const { service, findMany } = createService([{ entityKey: "video:video-c", score: 100 }]);

    const ranked = await service.rankItems(undefined, "POPULAR_CONTENT", videos);

    expect(ranked).toEqual(videos);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("falls back to global order when the privacy-safe cohort has no qualifying data", async () => {
    const { service } = createService([]);

    const ranked = await service.rankItems("BR", "CATALOG", videos);

    expect(ranked).toEqual(videos);
  });

  it("exposes category affinity only from privacy-safe regional aggregates", async () => {
    const { service, findMany } = createService([
      { entityKey: "category:science-fiction", score: 0.9 },
    ]);

    const affinity = await service.categoryAffinity("jp", ["Science Fiction", "Drama"]);

    expect(affinity.get("science-fiction")).toBe(0.9);
    expect(findMany).toHaveBeenCalledWith(
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
