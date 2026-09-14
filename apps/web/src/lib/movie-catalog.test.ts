import { describe, expect, it } from "vitest";

import { buildMovieJsonLd, buildMovieMetadata, type PublicMovie } from "./movie-catalog";

const movie: PublicMovie = {
  id: "00000000-0000-0000-0000-000000000001",
  title: "Ayin Feature",
  slug: "ayin-feature",
  synopsis: "A first-class movie catalog entry with a separate playable video.",
  releaseDate: "2026-09-01T00:00:00.000Z",
  releaseYear: 2026,
  runtimeMinutes: 104,
  maturityRating: "PG-13",
  originalLanguage: "en",
  genres: [{ name: "Drama", slug: "drama" }],
  poster: null,
  backdrop: null,
  primaryVideo: {
    id: "00000000-0000-0000-0000-000000000002",
    slug: "ayin-feature-playable",
    durationMs: 6_240_000,
  },
  trailerVideo: null,
  localizations: [],
};

describe("movie SEO", () => {
  it("uses the movie catalog URL as canonical rather than the raw video URL", () => {
    const metadata = buildMovieMetadata(movie);
    expect(metadata.alternates?.canonical).toBe("https://ayin.stream/movies/ayin-feature");
    expect(metadata.title).toContain("Ayin Feature");
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });

  it("emits Movie JSON-LD and keeps playback as a WatchAction", () => {
    const jsonLd = buildMovieJsonLd(movie);
    expect(jsonLd["@type"]).toBe("Movie");
    expect(jsonLd.url).toBe("https://ayin.stream/movies/ayin-feature");
    expect(jsonLd.duration).toBe("PT104M");
    expect(jsonLd.potentialAction).toMatchObject({
      "@type": "WatchAction",
      target: "https://ayin.stream/watch/ayin-feature-playable",
    });
  });
});
