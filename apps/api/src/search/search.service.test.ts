import { describe, expect, it, vi } from "vitest";

import type { SearchCandidate } from "./search-postgres.service.js";
import { SearchService } from "./search.service.js";

type Fixture = {
  candidates?: SearchCandidate[];
  suggestions?: SearchCandidate[];
  video?: unknown[];
  channel?: unknown[];
  playlist?: unknown[];
  creatorTvChannel?: unknown[];
  metadataMatches?: unknown[];
  metadata?: unknown[];
  snapshots?: unknown[];
  series?: unknown[];
  movies?: unknown[];
  locale?: string;
  localizeMovie?: (item: never, locale: string) => unknown;
  localizeSeries?: (item: never, locale: string) => unknown;
};

function serviceWith(fixture: Fixture = {}) {
  const videoFindMany = vi.fn(async () => fixture.video ?? []);
  const metadataFindMany = vi.fn(async (args: { where?: { OR?: unknown } }) =>
    args.where?.OR ? (fixture.metadataMatches ?? []) : (fixture.metadata ?? []),
  );
  const client = {
    video: { findMany: videoFindMany },
    channel: { findMany: vi.fn(async () => fixture.channel ?? []) },
    playlist: { findMany: vi.fn(async () => fixture.playlist ?? []) },
    creatorTvChannel: { findMany: vi.fn(async () => fixture.creatorTvChannel ?? []) },
    videoCreatorMetadata: { findMany: metadataFindMany },
    trendingScoreSnapshot: { findMany: vi.fn(async () => fixture.snapshots ?? []) },
  };
  const postgres = {
    searchCandidates: vi.fn<
      (query: string, limit: number, context: unknown) => Promise<SearchCandidate[]>
    >(async () => fixture.candidates ?? []),
    suggestCandidates: vi.fn(async () => fixture.suggestions ?? fixture.candidates ?? []),
  };
  const seriesCatalog = {
    getPublicSearchCards: vi.fn(async (ids: string[]) =>
      (fixture.series ?? []).filter((item) => ids.includes((item as { id: string }).id)),
    ),
  };
  const movieCatalog = {
    getPublicSearchCards: vi.fn(async (ids: string[]) =>
      (fixture.movies ?? []).filter((item) => ids.includes((item as { id: string }).id)),
    ),
  };
  const localization = {
    localizeMovies: vi.fn(async (items: never[], locale: string) =>
      items.map((item) => fixture.localizeMovie?.(item, locale) ?? item),
    ),
    localizeCatalogCards: vi.fn(async (_kind: string, items: never[], locale: string) =>
      items.map((item) => fixture.localizeSeries?.(item, locale) ?? item),
    ),
  };
  const videoPolicy = {
    filterAvailableVideoIds: vi.fn(async (ids: string[]) => new Set(ids)),
  };
  return {
    service: new SearchService(
      { client } as never,
      postgres as never,
      seriesCatalog as never,
      movieCatalog as never,
      videoPolicy as never,
      localization as never,
      { currentUiLocale: () => fixture.locale } as never,
    ),
    videoFindMany,
    postgres,
    seriesCatalog,
    movieCatalog,
    localization,
  };
}

const videoCandidate = (id: string, score: number): SearchCandidate => ({
  id,
  type: "VIDEO",
  slug: null,
  score,
});

const video = (id: string, title: string) => ({
  id,
  slug: id,
  title,
  channel: { name: "Nova" },
  mediaAssets: [],
});

describe("SearchService", () => {
  it("normalizes safe queries and returns unified typed results", async () => {
    const { service } = serviceWith({
      candidates: [
        videoCandidate("video-1", 140),
        { id: "channel-1", type: "CHANNEL", slug: "nova", score: 90 },
      ],
      video: [video("video-1", "A Film")],
      channel: [{ id: "channel-1", handle: "nova", name: "Nova" }],
    });
    const result = await service.search("  A   Film  ");
    expect(result.query).toBe("A Film");
    expect(result.items.map((item) => item.type)).toEqual(["VIDEO", "CHANNEL"]);
    expect(result.items[0]?.href).toBe("/watch/video-1");
  });

  it("requires a validated MP4 source for hydrated public video candidates", async () => {
    const { service, videoFindMany } = serviceWith({
      candidates: [videoCandidate("video-1", 100)],
    });
    await service.search("film");
    expect(videoFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              mediaAssets: {
                some: expect.objectContaining({
                  kind: "SOURCE_VIDEO",
                  status: "VALIDATED",
                  mimeType: "video/mp4",
                }),
              },
            }),
          ]),
        }),
      }),
    );
  });

  it("rejects undersized, abusive, very long queries and malformed cursors", async () => {
    const { service } = serviceWith();
    await expect(service.search("a")).rejects.toMatchObject({ code: "INVALID_SEARCH_QUERY" });
    await expect(service.search("x".repeat(101))).rejects.toMatchObject({
      code: "INVALID_SEARCH_QUERY",
    });
    await expect(
      service.search("one two three four five six seven eight nine ten eleven twelve thirteen"),
    ).rejects.toMatchObject({ code: "INVALID_SEARCH_QUERY" });
    await expect(service.search("film\u0000drop")).rejects.toMatchObject({
      code: "INVALID_SEARCH_QUERY",
    });
    await expect(service.search("film", "not-a-cursor")).rejects.toMatchObject({
      code: "INVALID_SEARCH_CURSOR",
    });
  });

  it("returns only the requested ranked page", async () => {
    const candidates = Array.from({ length: 4 }, (_, index) => ({
      id: `c-${index}`,
      type: "CHANNEL" as const,
      slug: `creator-${index}`,
      score: 100 - index,
    }));
    const { service } = serviceWith({
      candidates,
      channel: candidates.map((candidate, index) => ({
        id: candidate.id,
        handle: `creator-${index}`,
        name: `Creator ${index}`,
      })),
    });
    const first = await service.search("creator", undefined, 2);
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = await service.search("creator", first.nextCursor ?? undefined, 2);
    expect(second.items.map((item) => item.id)).toEqual(["c-2", "c-3"]);
  });

  it("keeps title relevance stronger than a large popularity signal", async () => {
    const { service } = serviceWith({
      candidates: [videoCandidate("exact", 140), videoCandidate("fuzzy", 45)],
      video: [video("exact", "Interstellar"), video("fuzzy", "Interstellar Explained")],
      snapshots: [{ videoId: "fuzzy", score: 1_000 }],
    });
    const result = await service.search("Interstellar");
    expect(result.items.map((item) => item.id)).toEqual(["exact", "fuzzy"]);
  });

  it("uses tags and categories as bounded ranking signals", async () => {
    const { service } = serviceWith({
      candidates: [videoCandidate("plain", 60), videoCandidate("tagged", 60)],
      video: [video("plain", "Plain"), video("tagged", "Tagged")],
      metadata: [{ videoId: "tagged", tags: ["space"], category: "SCIENCE_TECHNOLOGY" }],
    });
    const result = await service.search("space");
    expect(result.items[0]?.id).toBe("tagged");
  });

  it("returns Movie and Series catalog results with canonical public links", async () => {
    const { service } = serviceWith({
      candidates: [
        { id: "movie-1", type: "MOVIE", slug: "orbit", score: 132 },
        { id: "series-1", type: "SERIES", slug: "cosmos", score: 120 },
      ],
      movies: [
        {
          id: "movie-1",
          slug: "orbit",
          title: "Orbit",
          releaseYear: 2026,
          genres: [{ name: "Science", slug: "science" }],
          poster: { objectKey: "poster.jpg" },
          backdrop: null,
          primaryVideo: { id: "movie-video" },
        },
      ],
      series: [
        {
          id: "series-1",
          slug: "cosmos",
          title: "Cosmos",
          episodeCount: 4,
          artwork: [],
          firstEpisode: { video: { id: "episode-video" } },
        },
      ],
    });
    const result = await service.search("orbit");
    expect(result.items.map((item) => item.type)).toEqual(["MOVIE", "SERIES"]);
    expect(result.items[0]?.href).toBe("/movies/orbit");
    expect(result.items[1]?.href).toBe("/series/cosmos");
  });

  it("keeps autocomplete bounded and based on ranked public candidates", async () => {
    const { service, postgres } = serviceWith({
      suggestions: [
        { id: "channel-1", type: "CHANNEL", slug: "nova", score: 90 },
        { id: "channel-2", type: "CHANNEL", slug: "nova-two", score: 80 },
      ],
      channel: [
        { id: "channel-1", handle: "nova", name: "Nova" },
        { id: "channel-2", handle: "nova-two", name: "Nova Two" },
      ],
    });
    const result = await service.suggest("nov", 1);
    expect(postgres.suggestCandidates).toHaveBeenCalledWith("nov", 1, {});
    expect(result.suggestions).toEqual([
      { id: "channel-1", type: "CHANNEL", label: "Nova", href: "/c/nova" },
    ]);
  });
  it("localizes catalog copy and artwork consistently with the current request locale", async () => {
    const movie = {
      id: "movie",
      slug: "film",
      title: "Original",
      releaseYear: 2026,
      genres: [],
      poster: null,
      backdrop: null,
      primaryVideo: null,
    };
    const fixture = serviceWith({
      candidates: [{ id: "movie", type: "MOVIE", slug: "film", score: 100 }],
      movies: [movie],
      locale: "ar",
      localizeMovie: (item, locale) => ({
        ...(item as typeof movie),
        title: locale === "ar" ? "الرحلة" : "Original",
        poster: { objectKey: "localized-poster.jpg" },
      }),
    });
    const result = await fixture.service.search("الرحلة", undefined, 12, { countryCode: "JP" });
    expect(result.items[0]).toMatchObject({
      title: "الرحلة",
      artworkObjectKey: "localized-poster.jpg",
      href: "/movies/film",
    });
    expect(fixture.localization.localizeMovies).toHaveBeenCalledWith([movie], "ar");
    expect(fixture.postgres.searchCandidates).toHaveBeenCalledWith("الرحلة", expect.any(Number), {
      countryCode: "JP",
    });
    expect((await fixture.service.suggest("الرحلة")).suggestions[0]?.label).toBe("الرحلة");
  });
  it("paginates past 24 catalog candidates using fixed windows and batched hydration", async () => {
    const candidates = Array.from({ length: 110 }, (_, index) => ({
      id: `movie-${index}`,
      type: "MOVIE" as const,
      slug: `movie-${index}`,
      score: 200 - index,
    }));
    const fixture = serviceWith({
      candidates,
      movies: candidates.map((candidate) => ({
        id: candidate.id,
        slug: candidate.slug,
        title: candidate.slug,
        releaseYear: 2026,
        genres: [],
        poster: null,
        backdrop: null,
        primaryVideo: null,
      })),
    });
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await fixture.service.search("journey", cursor, 24);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
      expect(seen.length).toBeLessThanOrEqual(110);
    } while (cursor);
    expect(seen).toEqual(candidates.map((item) => item.id));
    expect(fixture.movieCatalog.getPublicSearchCards).toHaveBeenCalledTimes(5);
    expect(fixture.localization.localizeMovies).toHaveBeenCalledTimes(5);
    for (const call of fixture.postgres.searchCandidates.mock.calls) expect(call[1]).toBe(64);
  });
  it("omits a newly unavailable series but reports an operational failure instead of false empty results", async () => {
    const fixture = serviceWith({
      candidates: [{ id: "series", type: "SERIES", slug: "show", score: 100 }],
    });
    fixture.seriesCatalog.getPublicSearchCards.mockResolvedValueOnce([]);
    expect((await fixture.service.search("show")).items).toEqual([]);
    fixture.seriesCatalog.getPublicSearchCards.mockRejectedValueOnce(new Error("database down"));
    await expect(fixture.service.search("show")).rejects.toThrow("database down");
  });
  it("does not advertise a next cursor outside the supported offset range", async () => {
    const candidates = Array.from({ length: 550 }, (_, index) => ({
      id: `creator-${index}`,
      type: "CHANNEL" as const,
      slug: `creator-${index}`,
      score: 600 - index,
    }));
    const fixture = serviceWith({
      candidates,
      channel: candidates.map((candidate) => ({
        id: candidate.id,
        handle: candidate.slug,
        name: candidate.slug,
      })),
    });
    const cursor = Buffer.from(JSON.stringify({ offset: 480 })).toString("base64url");
    const page = await fixture.service.search("creator", cursor, 24);
    expect(page.items).toHaveLength(24);
    expect(page.nextCursor).toBeNull();
  });
});
