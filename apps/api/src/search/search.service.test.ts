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
    searchCandidates: vi.fn(async () => fixture.candidates ?? []),
    suggestCandidates: vi.fn(async () => fixture.suggestions ?? fixture.candidates ?? []),
  };
  const seriesCatalog = {
    getPublicBySlug: vi.fn(async (slug: string) =>
      (fixture.series ?? []).find((item) => (item as { slug?: string }).slug === slug),
    ),
  };
  const movieCatalog = {
    getPublicBySlug: vi.fn(async (slug: string) =>
      (fixture.movies ?? []).find((item) => (item as { slug?: string }).slug === slug) ?? null,
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
    ),
    videoFindMany,
    postgres,
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
    await expect(service.search("one two three four five six seven eight nine ten eleven twelve thirteen"))
      .rejects.toMatchObject({ code: "INVALID_SEARCH_QUERY" });
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
      metadata: [
        { videoId: "tagged", tags: ["space"], category: "SCIENCE_TECHNOLOGY" },
      ],
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
    expect(postgres.suggestCandidates).toHaveBeenCalledWith("nov", 1);
    expect(result.suggestions).toEqual([
      { id: "channel-1", type: "CHANNEL", label: "Nova", href: "/c/nova" },
    ]);
  });
});
