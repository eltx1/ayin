import { apiBaseUrl, readApiError } from "./api";

export const searchResultTypes = ["VIDEO", "CHANNEL", "PLAYLIST", "CREATOR_TV"] as const;
export type SearchResultType = (typeof searchResultTypes)[number];

export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  href: string;
  kicker: string;
  meta: string | null;
  artworkObjectKey: string | null;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  nextCursor: string | null;
}

export interface SearchSuggestionsResponse {
  query: string;
  suggestions: SearchResult[];
}

export async function fetchSearch(
  query: string,
  options: {
    types?: SearchResultType[] | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
    signal?: AbortSignal | undefined;
  } = {},
): Promise<SearchResponse> {
  const parameters = new URLSearchParams({ q: query });
  if (options.types?.length) parameters.set("types", options.types.join(","));
  if (options.cursor) parameters.set("cursor", options.cursor);
  if (options.limit) parameters.set("limit", String(options.limit));

  const response = await fetch(`${apiBaseUrl}/public/search?${parameters.toString()}`, {
    cache: "no-store",
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as SearchResponse;
}

export async function fetchSearchSuggestions(
  query: string,
  signal?: AbortSignal,
): Promise<SearchSuggestionsResponse> {
  const parameters = new URLSearchParams({ q: query, limit: "6" });
  const response = await fetch(`${apiBaseUrl}/public/search/suggestions?${parameters.toString()}`, {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as SearchSuggestionsResponse;
}
