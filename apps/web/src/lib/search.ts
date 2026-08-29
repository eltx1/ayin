export interface SearchItem {
  id: string;
  type: "VIDEO" | "CHANNEL" | "PLAYLIST" | "CREATOR_TV";
  title: string;
  href: string;
  kicker: string;
  meta: string | null;
  artworkObjectKey: string | null;
}

export interface SearchResponse {
  query: string;
  items: SearchItem[];
  nextCursor: string | null;
  emptyMessage: string | null;
}

export interface SearchSuggestion {
  id: string;
  type: "VIDEO" | "CHANNEL" | "CREATOR_TV";
  label: string;
  href: string;
}

export function normalizeSearchTerm(value: string): string {
  return value.normalize("NFKC").replaceAll(/\s+/g, " ").trim().slice(0, 100);
}
