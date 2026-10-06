import { describe, expect, it } from "vitest";
import {
  catalogDraftCanRestore,
  catalogFingerprint,
  catalogTargetFingerprint,
  catalogRestorationConflict,
  catalogFormFingerprint,
  isCatalogRetainedDraft,
  type CatalogRetainedDraft,
} from "./catalog-draft-retention";
const episode = {
  id: "episode-a",
  seasonId: "season-a",
  episodeNumber: 1,
  title: "Original episode",
  synopsis: "Episode synopsis",
  sortOrder: 0,
  status: "DRAFT",
  updatedAt: "v1",
};
const season = {
  id: "season-a",
  seriesId: "series-a",
  title: "Season",
  seasonNumber: 1,
  sortOrder: 0,
  updatedAt: "v1",
  episodes: [episode],
};
const series = {
  id: "series-a",
  title: "Series",
  synopsis: "Original series",
  status: "DRAFT",
  updatedAt: "parent-v1",
  validation: { issues: [] },
  seasons: [season],
};
function candidate(target = series): CatalogRetainedDraft {
  return {
    version: 1,
    kind: "series",
    target: { id: target.id, title: target.title },
    targetFingerprint: catalogTargetFingerprint(target),
    forms: {
      series: {
        draft: { title: "Unsaved parent" },
        baseline: { title: "Series" },
        sourceFingerprint: catalogFormFingerprint("series", series),
      },
      "episode:episode-a": {
        draft: { title: "Unsaved episode" },
        baseline: { title: "Original episode" },
        sourceFingerprint: catalogFormFingerprint("episode:episode-a", episode),
      },
    },
    pending: false,
    blocked: false,
  };
}
describe("exact-target catalog draft restoration", () => {
  it("accepts only a fresh unchanged same target and every needed form baseline", () => {
    expect(catalogDraftCanRestore(candidate(), structuredClone(series))).toBe(true);
    expect(catalogDraftCanRestore(candidate(), { ...series, id: "series-b" })).toBe(false);
    expect(catalogDraftCanRestore(candidate(), null)).toBe(false);
    expect(catalogDraftCanRestore(candidate(), { ...series, status: "ARCHIVED" })).toBe(false);
  });
  it("detects child changes even while parent updatedAt stays unchanged", () => {
    const changed = {
      ...series,
      seasons: [
        { ...season, episodes: [{ ...episode, title: "External change", updatedAt: "v2" }] },
      ],
    };
    expect(changed.updatedAt).toBe(series.updatedAt);
    expect(catalogDraftCanRestore(candidate(), changed)).toBe(false);
  });
  it("does not advance a dirty child baseline just because a later sibling refresh saw that external edit", () => {
    const changed = {
      ...series,
      seasons: [
        { ...season, episodes: [{ ...episode, title: "External change", updatedAt: "v2" }] },
      ],
    };
    expect(catalogDraftCanRestore(candidate(changed), changed)).toBe(false);
  });
  it("allows acknowledged order-only changes without dropping independent metadata drafts", () => {
    const reordered = {
      ...series,
      seasons: [{ ...season, episodes: [{ ...episode, sortOrder: 10, updatedAt: "v2" }] }],
    };
    expect(catalogDraftCanRestore(candidate(reordered), reordered)).toBe(true);
  });
  it("never restores an in-flight, uncertain, or oversized candidate into a writeable editor", () => {
    for (const flag of ["pending", "blocked", "overflow"] as const)
      expect(catalogDraftCanRestore({ ...candidate(), [flag]: true }, series)).toBe(false);
  });
  it("keeps new drafts distinct from an unacknowledged create", () => {
    const fresh = {
      ...candidate(),
      target: { id: null, title: "" },
      targetFingerprint: null,
      forms: {
        series: { draft: { title: "New" }, baseline: { title: "" }, sourceFingerprint: null },
      },
    };
    expect(catalogDraftCanRestore(fresh, null)).toBe(true);
    expect(catalogDraftCanRestore({ ...fresh, pending: true }, null)).toBe(false);
    expect(catalogDraftCanRestore({ ...fresh, blocked: true }, null)).toBe(false);
    expect(catalogDraftCanRestore(fresh, series)).toBe(false);
  });
  it("detects a changed child-creation collection and a removed original parent", () => {
    const next = candidate();
    next.forms = {
      "new-episode:season-a": {
        draft: { episodeNumber: "2" },
        baseline: { episodeNumber: "1" },
        sourceFingerprint: catalogFormFingerprint("new-episode:season-a", season),
      },
    };
    expect(catalogDraftCanRestore(next, series)).toBe(true);
    const changed = {
      ...series,
      seasons: [
        { ...season, episodes: [episode, { ...episode, id: "episode-b", episodeNumber: 2 }] },
      ],
    };
    expect(
      catalogDraftCanRestore(
        { ...next, targetFingerprint: catalogTargetFingerprint(changed) },
        changed,
      ),
    ).toBe(false);
    const removed = { ...series, seasons: [] };
    expect(
      catalogDraftCanRestore(
        { ...next, targetFingerprint: catalogTargetFingerprint(removed) },
        removed,
      ),
    ).toBe(false);
  });
  it("normalizes object key order without collapsing timestamp or value differences", () => {
    expect(catalogFingerprint({ a: 1, b: { x: 2 } })).toBe(
      catalogFingerprint({ b: { x: 2 }, a: 1 }),
    );
    expect(catalogFingerprint({ time: "2035-01-01T00:00:00.001Z" })).not.toBe(
      catalogFingerprint({ time: "2035-01-01T00:00:00.002Z" }),
    );
  });
  it("rejects wrong-slot or malformed retained envelopes", () => {
    expect(isCatalogRetainedDraft(candidate(), "series")).toBe(true);
    expect(isCatalogRetainedDraft(candidate(), "movie")).toBe(false);
    expect(isCatalogRetainedDraft({ ...candidate(), forms: { x: null } }, "series")).toBe(false);
  });
  it("ignores unrelated response counters, diagnostics, property and unordered row delivery order", () => {
    const unchanged = {
      ...series,
      viewCount: 42,
      diagnostics: { durationMs: 99 },
      validation: { issues: ["new-diagnostic-order"] },
    };
    expect(catalogDraftCanRestore(candidate(), unchanged)).toBe(true);
  });
  it("reports the changed hierarchy level while preserving exact timestamps", () => {
    const changed = {
      ...series,
      seasons: [
        {
          ...season,
          episodes: [{ ...episode, releaseDate: "2035-01-01T12:00:00.001Z", updatedAt: "v2" }],
        },
      ],
    };
    expect(catalogRestorationConflict(candidate(), changed)).toBe("episodes");
    expect(catalogRestorationConflict(candidate(), { ...series, status: "ARCHIVED" })).toBe(
      "archived",
    );
  });
  it("retains original parent identity even when a newer read already saw reparenting", () => {
    const moved = {
      ...series,
      seasons: [
        { ...season, episodes: [] },
        {
          ...season,
          id: "season-b",
          seasonNumber: 2,
          episodes: [{ ...episode, seasonId: "season-b" }],
        },
      ],
    };
    expect(catalogDraftCanRestore(candidate(moved), moved)).toBe(false);
  });
});
