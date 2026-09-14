import { describe, expect, it } from "vitest";

import {
  compareCatalogEpisodes,
  nextCatalogEpisode,
  normalizeSeriesSlug,
  seriesPublishIssues,
  type OrderedEpisode,
} from "./series-catalog.policy.js";

const episodes: OrderedEpisode[] = [
  {
    id: "s2e1",
    seasonId: "s2",
    seasonNumber: 2,
    seasonSortOrder: 20,
    episodeNumber: 1,
    sortOrder: 10,
    videoId: "v3",
    status: "PUBLISHED",
  },
  {
    id: "s1e2",
    seasonId: "s1",
    seasonNumber: 1,
    seasonSortOrder: 10,
    episodeNumber: 2,
    sortOrder: 20,
    videoId: "v2",
    status: "PUBLISHED",
  },
  {
    id: "s1e1",
    seasonId: "s1",
    seasonNumber: 1,
    seasonSortOrder: 10,
    episodeNumber: 1,
    sortOrder: 10,
    videoId: "v1",
    status: "PUBLISHED",
  },
];

describe("series catalog policy", () => {
  it("normalizes safe canonical series slugs", () => {
    expect(normalizeSeriesSlug("  ÀYIN: First Series! ")).toBe("ayin-first-series");
  });

  it("orders seasons and episodes deterministically and crosses season boundaries", () => {
    expect(episodes.toSorted(compareCatalogEpisodes).map((episode) => episode.id)).toEqual([
      "s1e1",
      "s1e2",
      "s2e1",
    ]);
    expect(nextCatalogEpisode(episodes, "s1e1")?.id).toBe("s1e2");
    expect(nextCatalogEpisode(episodes, "s1e2")?.id).toBe("s2e1");
    expect(nextCatalogEpisode(episodes, "s2e1")).toBeNull();
  });

  it("skips draft, unassigned and future episodes in watch-next", () => {
    const candidates: OrderedEpisode[] = [
      episodes[2]!,
      { ...episodes[1]!, status: "DRAFT" },
      { ...episodes[0]!, releaseDate: new Date("2999-01-01T00:00:00Z") },
    ];
    expect(nextCatalogEpisode(candidates, "s1e1")).toBeNull();
  });

  it("requires a ready poster and an explicitly published playable episode", () => {
    const issues = seriesPublishIssues({
      title: "Series",
      slug: "series",
      synopsis: "Synopsis",
      maturityRating: "TV-14",
      originalLanguage: "en",
      genres: ["Drama"],
      artwork: [{ type: "POSTER", assetReady: true }],
      episodes: [
        {
          status: "PUBLISHED",
          video: { status: "PUBLISHED", visibility: "PUBLIC" },
        },
      ],
    });
    expect(issues).toEqual([]);
  });
});
