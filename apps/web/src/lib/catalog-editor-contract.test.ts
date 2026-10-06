import { describe, expect, it } from "vitest";
import {
  catalogResourceItems,
  catalogChildAcknowledged,
  catalogIdentityFailure,
  catalogList,
  catalogRecord,
  validCatalogRecord,
} from "./catalog-editor-contract";
const id = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002";
const movie = {
  id,
  title: "Movie",
  slug: "movie",
  synopsis: "Synopsis",
  status: "DRAFT",
  releaseDate: null,
  releaseYear: 2026,
  runtimeMinutes: 90,
  maturityRating: "PG",
  originalLanguage: "en",
  primaryVideoId: null,
  trailerVideoId: null,
  primaryVideo: null,
  trailerVideo: null,
  genres: [],
  artwork: [],
  availability: [],
  validation: { status: "BLOCKED", publishable: false, issues: ["POSTER_REQUIRED"] },
};
describe("catalog API identity and acknowledgement contracts", () => {
  it("accepts native movie/series detail and list shapes", () => {
    expect(catalogRecord({ movie }, "movie", id)).toEqual(movie);
    expect(catalogList({ items: [movie] }, "movie")).toEqual([movie]);
    expect(validCatalogRecord({ ...movie, releaseYear: null, seasons: [] }, "series")).toBe(true);
  });
  it("rejects missing, malformed and wrong-target acknowledgements", () => {
    for (const body of [
      null,
      {},
      { movie: { id } },
      { movie: { ...movie, id: other } },
      { movie: { ...movie, artwork: null } },
    ])
      expect(() => catalogRecord(body, "movie", id)).toThrow();
    expect(() =>
      catalogList({ items: [{ ...movie, validation: { status: "READY" } }] }, "movie"),
    ).toThrow();
  });
  it("requires exact child identity and parent even for acknowledged creates", () => {
    expect(
      catalogChildAcknowledged({ season: { id, seriesId: other } }, "season", null, {
        key: "seriesId",
        id: other,
      }),
    ).toBe(true);
    expect(
      catalogChildAcknowledged({ episode: { id, seasonId: other } }, "episode", id, {
        key: "seasonId",
        id: other,
      }),
    ).toBe(true);
    expect(
      catalogChildAcknowledged({ episode: { id: other, seasonId: other } }, "episode", id, {
        key: "seasonId",
        id: other,
      }),
    ).toBe(false);
    expect(
      catalogChildAcknowledged({ season: { id, seriesId: id } }, "season", null, {
        key: "seriesId",
        id: other,
      }),
    ).toBe(false);
  });
  it("conceals on expected identity conflicts without mistaking ordinary 409 validation", () => {
    expect(catalogIdentityFailure(401, null)).toBe(true);
    expect(catalogIdentityFailure(403, null)).toBe(true);
    expect(catalogIdentityFailure(409, { error: { code: "SESSION_CHANGED" } })).toBe(true);
    expect(catalogIdentityFailure(409, { error: { code: "ACCOUNT_CHANGED" } })).toBe(true);
    expect(catalogIdentityFailure(409, { error: { code: "SEASON_NUMBER_CONFLICT" } })).toBe(false);
  });
  it("accepts bounded directory rows and rejects unverified selectable resources", () => {
    const resource = {
      id,
      label: "Video",
      title: "Video",
      slug: "video",
      durationMs: null,
      channel: { name: "Channel", handle: "channel" },
    };
    expect(catalogResourceItems({ items: [resource] }, "video")).toEqual([resource]);
    for (const value of [
      null,
      {},
      { items: null },
      { items: [{ id, label: "Incomplete" }] },
      { items: [resource, resource] },
      { items: Array(26).fill(resource) },
    ])
      expect(() => catalogResourceItems(value, "video")).toThrow();
  });
});
