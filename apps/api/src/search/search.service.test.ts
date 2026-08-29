import { describe, expect, it } from "vitest";

import { SearchService } from "./search.service.js";

function serviceWith(overrides: Record<string, unknown[]> = {}) {
  const client = {
    video: { findMany: async () => overrides.video ?? [] },
    channel: { findMany: async () => overrides.channel ?? [] },
    playlist: { findMany: async () => overrides.playlist ?? [] },
    creatorTvChannel: { findMany: async () => overrides.creatorTvChannel ?? [] },
  };
  return new SearchService({ client } as never);
}

describe("SearchService", () => {
  it("normalizes safe queries and returns unified typed results", async () => {
    const service = serviceWith({
      video: [
        {
          id: "video-1",
          slug: "a-film",
          title: "A Film",
          channel: { name: "Nova" },
          mediaAssets: [],
        },
      ],
      channel: [{ id: "channel-1", handle: "nova", name: "Nova" }],
    });
    const result = await service.search("  A   Film  ");
    expect(result.query).toBe("A Film");
    expect(result.items.map((item) => item.type)).toEqual(["VIDEO", "CHANNEL"]);
    expect(result.items[0]?.href).toBe("/watch/a-film");
  });

  it("rejects undersized queries and malformed cursors", async () => {
    const service = serviceWith();
    await expect(service.search("a")).rejects.toMatchObject({
      code: "INVALID_SEARCH_QUERY",
    });
    await expect(service.search("film", "not-a-cursor")).rejects.toMatchObject({
      code: "INVALID_SEARCH_CURSOR",
    });
  });

  it("returns only the requested unified page", async () => {
    const service = serviceWith({
      channel: Array.from({ length: 4 }, (_, index) => ({
        id: `c-${index}`,
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
});
