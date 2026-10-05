import { describe, expect, it } from "vitest";
import { parseResolvedHero } from "./viewer-product";

describe("resolved public hero contract", () => {
  it("accepts absent and null selections without inventing content", () => {
    expect(parseResolvedHero(null)).toBeNull();
    expect(parseResolvedHero(undefined)).toBeNull();
  });
  it.each([
    ["VIDEO", "/watch/a-video"],
    ["VIDEO", "/watch/a-video?kids=1"],
    ["CHANNEL", "/c/creator.name"],
    ["CHANNEL", "/c/قناة"],
    ["CREATOR_TV", "/c/creator/tv"],
    ["PLAYLIST", "/c/creator/playlists/a-list"],
  ])("keeps %s canonical destinations and authored text", (entityType, href) => {
    const hero = { entityType, entityId: "id", title: "Original name", description: null, href };
    expect(parseResolvedHero(hero)).toEqual(hero);
  });
  it.each([
    { href: "https://other.example/watch/video" },
    { href: "//other.example/watch/video" },
    { href: "/tv/legacy" },
    { href: "/watch/video?bad=1" },
    { href: "/watch/video\\bad" },
    { entityType: "UNKNOWN" },
    { title: "" },
    { description: 123 },
  ])("rejects malformed featured content: %j", (patch) => {
    expect(() =>
      parseResolvedHero({
        entityType: "VIDEO",
        entityId: "id",
        title: "Title",
        description: null,
        href: "/watch/video",
        ...patch,
      }),
    ).toThrow("Invalid featured content");
  });
});
