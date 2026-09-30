import { describe, expect, it } from "vitest";

import { buildTvFocusIdentities, resolvePersistedTvFocusIndex } from "./tv-focus-identity";

describe("TV focus identities", () => {
  it("gives repeated semantic IDs distinct geometry and persistence identities", () => {
    const identities = buildTvFocusIdentities([
      "media-poster-same-title",
      "media-poster-same-title",
      "next-card",
    ]);

    expect(identities[0]?.navigationId).not.toBe(identities[1]?.navigationId);
    expect(identities[0]?.persistenceId).not.toBe(identities[1]?.persistenceId);
    expect(new Set(identities.map((identity) => identity.navigationId)).size).toBe(3);
    expect(resolvePersistedTvFocusIndex(identities, identities[1]!.persistenceId!)).toBe(1);

    const laterUnique = buildTvFocusIdentities(["media-poster-same-title", "next-card"]);
    expect(resolvePersistedTvFocusIndex(laterUnique, identities[1]!.persistenceId!)).toBe(0);
  });

  it("keeps unique named persistence stable and supports legacy stored values", () => {
    const before = buildTvFocusIdentities(["home", undefined, "search"]);
    const after = buildTvFocusIdentities([undefined, "home", undefined, "search"]);

    expect(before[0]?.persistenceId).toBe(after[1]?.persistenceId);
    expect(resolvePersistedTvFocusIndex(after, "search")).toBe(3);
    expect(resolvePersistedTvFocusIndex(after, "missing")).toBe(-1);
  });

  it("keeps unnamed geometry targets unique without persisting them", () => {
    const identities = buildTvFocusIdentities([undefined, undefined]);

    expect(identities.map((identity) => identity.navigationId)).toEqual(["auto:0", "auto:1"]);
    expect(identities.every((identity) => identity.persistenceId === null)).toBe(true);
  });
});
