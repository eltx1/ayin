import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({ locale: "ar", seasonTitle: null as string | null }));
vi.mock("@/lib/i18n/server", () => ({ getRequestLocale: async () => context.locale }));
vi.mock("@/lib/trusted-region", () => ({ trustedApiRegionHeaders: async () => ({}) }));
vi.mock("@/lib/movie-catalog", () => ({
  buildMovieJsonLd: () => ({}),
  getPublicMovie: async () => ({
    title: "Original movie",
    slug: "original",
    synopsis: "Original editorial synopsis",
    releaseYear: 2026,
    runtimeMinutes: 118,
    maturityRating: "PG",
    originalLanguage: "en",
    genres: [{ name: "Authored genre" }],
    poster: null,
    backdrop: null,
    primaryVideo: { slug: "movie-video" },
    trailerVideo: { slug: "movie-trailer" },
  }),
}));
vi.mock("@/lib/series-catalog", () => ({
  buildSeriesJsonLd: () => ({}),
  getPublicSeries: async () => ({
    title: "Original series",
    slug: "original",
    synopsis: "Original series synopsis",
    releaseYear: null,
    maturityRating: "TV-G",
    originalLanguage: "en",
    genres: ["Authored genre"],
    artwork: [],
    episodeCount: 1,
    firstEpisode: { video: { href: "/watch/episode-one" } },
    seasons: [
      {
        id: "s1",
        seasonNumber: 1,
        title: context.seasonTitle,
        episodes: [
          {
            id: "e1",
            episodeNumber: 1,
            title: "Original episode",
            synopsis: "Original episode synopsis",
            video: { href: "/watch/episode-one" },
          },
        ],
      },
    ],
  }),
}));
import MoviePage from "./movies/[slug]/page";
import SeriesPage from "./series/[slug]/page";

beforeEach(() => {
  context.locale = "ar";
  context.seasonTitle = null;
});

describe("catalog detail locale rendering", () => {
  it("localizes movie controls/runtime while preserving authored title, genre and synopsis", async () => {
    const html = renderToStaticMarkup(
      await MoviePage({ params: Promise.resolve({ slug: "original" }) }),
    );
    for (const text of [
      "شاهد الفيلم",
      "شاهد الإعلان التشويقي",
      "١١٨ دقيقة",
      "Original movie",
      "Original editorial synopsis",
      "Authored genre",
    ])
      expect(html).toContain(text);
    expect(html).toContain('href="/ar/watch/movie-video"');
    expect(html).not.toContain("Watch movie");
  });
  it("localizes season/episode defaults and native navigation labels", async () => {
    const html = renderToStaticMarkup(
      await SeriesPage({
        params: Promise.resolve({ slug: "original" }),
        searchParams: Promise.resolve({}),
      }),
    );
    for (const text of [
      "ابدأ المشاهدة",
      "من إنتاج AYIN",
      "حلقة واحدة",
      "الموسم ١",
      "الحلقة ١",
      "Original episode",
      "Original series synopsis",
    ])
      expect(html).toContain(text);
    expect(html).toContain('aria-label="اختيار الموسم"');
    expect(html).toContain('href="/ar/series/original?season=1"');
    expect(html).toContain('href="/ar/watch/episode-one"');
  });
  it("never replaces an authored season title with a translated default", async () => {
    context.seasonTitle = "Creator’s own season title";
    const html = renderToStaticMarkup(
      await SeriesPage({
        params: Promise.resolve({ slug: "original" }),
        searchParams: Promise.resolve({ season: "1" }),
      }),
    );
    expect(html).toContain(context.seasonTitle);
    expect(html).not.toContain("الموسم ١");
  });
  it("retains the original English controls and canonical unprefixed links", async () => {
    context.locale = "en";
    const movie = renderToStaticMarkup(
      await MoviePage({ params: Promise.resolve({ slug: "original" }) }),
    );
    const series = renderToStaticMarkup(
      await SeriesPage({
        params: Promise.resolve({ slug: "original" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(movie).toContain("118 min");
    expect(movie).toContain('href="/watch/movie-video"');
    expect(series).toContain("Start watching");
    expect(series).toContain("1 episode");
    expect(series).toContain('aria-label="Season selector"');
  });
});
