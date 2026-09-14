import { describe, expect, it } from "vitest";

import { buildSeriesJsonLd, buildSeriesMetadata, type PublicSeries } from "./series-catalog.js";

const series: PublicSeries = {
  id: "series-1",
  title: "AYIN Series",
  slug: "ayin-series",
  synopsis: "A first-class series catalog test.",
  releaseYear: 2026,
  maturityRating: "TV-14",
  originalLanguage: "en",
  publishedAt: "2026-09-15T00:00:00.000Z",
  updatedAt: "2026-09-15T00:00:00.000Z",
  genres: ["Drama"],
  artwork: [],
  seasons: [
    {
      id: "season-1",
      seasonNumber: 1,
      title: "Season One",
      sortOrder: 0,
      artwork: [],
      episodes: [
        {
          id: "episode-1",
          episodeNumber: 1,
          title: "Pilot",
          synopsis: "Pilot episode",
          sortOrder: 0,
          releaseDate: null,
          publishedAt: "2026-09-15T00:00:00.000Z",
          video: {
            id: "video-1",
            slug: "pilot-video",
            title: "Pilot video",
            durationMs: 1_800_000,
            href: "/watch/pilot-video",
          },
        },
      ],
    },
  ],
  episodeCount: 1,
  firstEpisode: null,
};

describe("series catalog SEO", () => {
  it("uses a canonical series URL and TVSeries structured data", () => {
    const metadata = buildSeriesMetadata(series);
    const jsonLd = buildSeriesJsonLd(series);

    expect(metadata.alternates?.canonical).toBe("https://ayin.tv/series/ayin-series");
    expect(jsonLd["@type"]).toBe("TVSeries");
    expect(jsonLd.containsSeason[0]?.["@type"]).toBe("TVSeason");
    expect(jsonLd.containsSeason[0]?.episode[0]?.["@type"]).toBe("TVEpisode");
    expect(jsonLd.containsSeason[0]?.episode[0]?.potentialAction.target).toBe(
      "https://ayin.tv/watch/pilot-video",
    );
  });
});
