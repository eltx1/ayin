import type { CreatorPlaylistSummary, PlaylistVisibility } from "./playlist";

export const playlistPageSize = 12;
export type PlaylistFilter = PlaylistVisibility | "ALL";

// Presentation paging of the current owned snapshot, not a claim of API pagination.
export function playlistLibraryPage(
  rows: readonly CreatorPlaylistSummary[],
  query: string,
  visibility: PlaylistFilter,
  requestedPage: number,
) {
  const term = query.normalize("NFC").trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (visibility !== "ALL" && row.visibility !== visibility) return false;
    const text = `${row.name}\n${row.description ?? ""}`.normalize("NFC").toLowerCase();
    return !term || text.includes(term);
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / playlistPageSize));
  const safePage = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1;
  const page = Math.max(1, Math.min(pageCount, safePage));
  return {
    items: filtered.slice((page - 1) * playlistPageSize, page * playlistPageSize),
    total: filtered.length,
    page,
    pageCount,
  };
}
