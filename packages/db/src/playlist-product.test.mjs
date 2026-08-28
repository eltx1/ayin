import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const watchLater = readFileSync(
  new URL("../prisma/playlist-product.prisma", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../prisma/migrations/20260829090000_playlist_product/migration.sql", import.meta.url),
  "utf8",
);

describe("Task 09 playlist schema", () => {
  it("supports public, unlisted and private playlist visibility with compatibility safety", () => {
    expect(schema).toMatch(
      /enum PlaylistVisibility \{[\s\S]*PUBLIC[\s\S]*UNLISTED[\s\S]*PRIVATE[\s\S]*\}/,
    );
    expect(schema).toMatch(/visibility\s+PlaylistVisibility\s+@default\(PUBLIC\)/);
    expect(migration).toContain("Playlist_visibility_projection_check");
    expect(migration).toContain('"Playlist_channelId_visibility_createdAt_idx"');
  });

  it("keeps Watch Later profile-owned and duplicate-safe", () => {
    expect(watchLater).toContain("model WatchLaterItem {");
    expect(watchLater).toContain("profileId String");
    expect(watchLater).toContain("videoId   String");
    expect(watchLater).toContain("@@unique([profileId, videoId])");
  });
});
