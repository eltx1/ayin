import { describe, expect, it } from "vitest";

import {
  isMovieAvailableInTerritory,
  moviePublishIssues,
  normalizeMovieSlug,
} from "./movie-catalog.policy.js";

const now = new Date("2026-09-15T00:00:00.000Z");

function publishableMovie() {
  return {
    title: "Catalog Movie",
    slug: "catalog-movie",
    synopsis: "A deliberately cataloged feature film.",
    releaseYear: 2026,
    runtimeMinutes: 101,
    maturityRating: "PG-13",
    originalLanguage: "en",
    primaryVideo: { status: "PUBLISHED", visibility: "PUBLIC" },
    genres: [{ slug: "drama" }],
    artwork: [{ type: "POSTER" as const, assetReady: true }],
    availability: [
      { territoryCode: "*", rule: "ALLOW" as const, startsAt: null, endsAt: null },
    ],
  };
}

describe("movie catalog publish eligibility", () => {
  it("publishes only when catalog metadata, artwork, playable video and active rights are complete", () => {
    expect(moviePublishIssues(publishableMovie(), now)).toEqual([]);

    const candidate = publishableMovie();
    candidate.primaryVideo = { status: "DRAFT", visibility: "PUBLIC" };
    candidate.artwork = [];
    candidate.availability = [];

    expect(moviePublishIssues(candidate, now)).toEqual(
      expect.arrayContaining([
        "POSTER_REQUIRED",
        "PRIMARY_VIDEO_NOT_PUBLISHED",
        "ACTIVE_RIGHTS_REQUIRED",
      ]),
    );
  });

  it("normalizes catalog slugs without changing the underlying video identity", () => {
    expect(normalizeMovieSlug("  My Movie: 2026! ")).toBe("my-movie-2026");
  });
});

describe("movie rights visibility", () => {
  it("uses exact territory rules before global fallback and BLOCK wins within a scope", () => {
    const windows = [
      { territoryCode: "*", rule: "ALLOW" as const, startsAt: null, endsAt: null },
      { territoryCode: "EG", rule: "BLOCK" as const, startsAt: null, endsAt: null },
      { territoryCode: "US", rule: "ALLOW" as const, startsAt: null, endsAt: null },
    ];

    expect(isMovieAvailableInTerritory(windows, "EG", now)).toBe(false);
    expect(isMovieAvailableInTerritory(windows, "US", now)).toBe(true);
    expect(isMovieAvailableInTerritory(windows, "GB", now)).toBe(true);
  });

  it("does not expose a movie without an active allow window", () => {
    expect(
      isMovieAvailableInTerritory(
        [
          {
            territoryCode: "*",
            rule: "ALLOW",
            startsAt: new Date("2026-10-01T00:00:00.000Z"),
            endsAt: null,
          },
        ],
        "US",
        now,
      ),
    ).toBe(false);
  });
});
