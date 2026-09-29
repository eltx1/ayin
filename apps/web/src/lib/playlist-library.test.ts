import { describe, expect, it } from "vitest";
import { playlistAr, playlistEn } from "./i18n/resources/playlists";
import { navigationEn } from "./i18n/resources/navigation";
import { enMessages } from "./i18n/resources/en";
import type { CreatorPlaylistSummary } from "./playlist";
import { playlistLibraryPage, playlistPageSize } from "./playlist-library";

const rows: CreatorPlaylistSummary[] = Array.from({ length: 27 }, (_, index) => ({
  id: `playlist-${index}`,
  channelId: "owned-channel",
  slug: `playlist-${index}`,
  name: index === 0 ? "مفضّلات Café" : `Playlist ${index}`,
  description: index === 1 ? "Behind the scenes" : null,
  systemKey: index === 0 ? "UPLOADS" : null,
  protected: index === 0,
  visibility: index % 2 ? "PRIVATE" : "PUBLIC",
  itemCount: index,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  capabilities: {
    canDelete: index !== 0,
    canRename: index !== 0,
    canChangeVisibility: index !== 0,
    canEditItems: index !== 0,
  },
}));

describe("owned playlist snapshot presentation", () => {
  it("reaches every row exactly once with bounded pages and no input mutation", () => {
    const original = structuredClone(rows);
    const result = [1, 2, 3].flatMap((page) => playlistLibraryPage(rows, "", "ALL", page).items);
    expect(playlistPageSize).toBe(12);
    expect(playlistLibraryPage(rows, "", "ALL", 1).items).toHaveLength(12);
    expect(playlistLibraryPage(rows, "", "ALL", 3).items).toHaveLength(3);
    expect(result).toEqual(rows);
    expect(new Set(result.map((row) => row.id)).size).toBe(27);
    expect(rows).toEqual(original);
  });
  it("combines name/description search and visibility while preserving system/capability data", () => {
    expect(playlistLibraryPage(rows, "cafe\u0301", "PUBLIC", 1).items).toEqual([rows[0]]);
    expect(playlistLibraryPage(rows, "مفضّلات", "ALL", 1).items).toEqual([rows[0]]);
    expect(playlistLibraryPage(rows, "  BEHIND  ", "PRIVATE", 1).items).toEqual([rows[1]]);
    expect(playlistLibraryPage(rows, "Behind", "PUBLIC", 1).total).toBe(0);
    expect(playlistLibraryPage(rows, "", "PRIVATE", 1).total).toBe(13);
  });
  it("clamps stale/invalid pages after filtering without inventing rows or totals", () => {
    for (const page of [-20, NaN, Infinity])
      expect(playlistLibraryPage(rows, "", "ALL", page).page).toBe(1);
    expect(playlistLibraryPage(rows, "", "ALL", 100).page).toBe(3);
    expect(playlistLibraryPage(rows, "Behind", "ALL", 3)).toMatchObject({
      page: 1,
      total: 1,
      pageCount: 1,
    });
    expect(playlistLibraryPage([], "", "ALL", 3)).toEqual({
      items: [],
      page: 1,
      total: 0,
      pageCount: 1,
    });
  });
  it("keeps typed EN/AR coverage without overriding existing catalogue or navigation keys", () => {
    expect(Object.keys(playlistAr).sort()).toEqual(Object.keys(playlistEn).sort());
    for (const key of Object.keys(playlistEn)) {
      expect(Object.hasOwn(enMessages, key)).toBe(false);
      expect(Object.hasOwn(navigationEn, key)).toBe(false);
    }
  });
});
