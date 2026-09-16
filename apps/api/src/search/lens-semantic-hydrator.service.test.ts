import { describe, expect, it, vi } from "vitest";

import { LensSemanticHydratorService } from "./lens-semantic-hydrator.service.js";

const candidates = [
  { id: "video-private", type: "VIDEO" as const, slug: "video-private", similarity: 0.91 },
  { id: "movie-geo", type: "MOVIE" as const, slug: "movie-geo", similarity: 0.9 },
  { id: "series-blocked", type: "SERIES" as const, slug: "series-blocked", similarity: 0.89 },
];

describe("LensSemanticHydratorService policy boundary", () => {
  it("never lets semantic candidates bypass public, moderation, or geo eligibility", async () => {
    const videoFindMany = vi.fn(async () => [
      {
        id: "video-private",
        slug: "video-private",
        title: "Candidate",
        channel: { name: "Creator" },
        mediaAssets: [],
      },
    ]);
    const database = {
      client: {
        video: { findMany: videoFindMany },
        trendingScoreSnapshot: { findMany: vi.fn(async () => []) },
      },
    };
    const videoPolicy = {
      // Simulates a moderation/rights block after the public DB predicate.
      filterAvailableVideoIds: vi.fn(async () => new Set<string>()),
    };
    const movieCatalog = { getPublicBySlug: vi.fn(async () => null) };
    const seriesCatalog = { getPublicBySlug: vi.fn(async () => null) };
    const service = new LensSemanticHydratorService(
      database as never,
      videoPolicy as never,
      movieCatalog as never,
      seriesCatalog as never,
    );

    const result = await service.hydrate(candidates, { countryCode: "DE" });

    expect(result).toEqual([]);
    expect(videoFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "PUBLISHED",
          visibility: "PUBLIC",
          removedAt: null,
          channel: { status: "ACTIVE", removedAt: null },
        }),
      }),
    );
    expect(videoPolicy.filterAvailableVideoIds).toHaveBeenCalledWith(["video-private"], {
      countryCode: "DE",
    });
    expect(movieCatalog.getPublicBySlug).toHaveBeenCalledWith("movie-geo", "DE");
    expect(seriesCatalog.getPublicBySlug).toHaveBeenCalledWith("series-blocked", "DE");
  });
});
