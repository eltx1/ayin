import { apiBaseUrl, type AyinIdentity } from "./api";
import { readBoundedAccountJson } from "./account-scope";
import type { SearchItem, SearchResponse, SearchSuggestion } from "./search";

export interface SearchAudience {
  identity: AyinIdentity | null;
  isCurrent: () => boolean;
}

export class SearchReadError extends Error {
  constructor(readonly status: number) {
    super("Search could not be verified for the current viewer.");
  }
}

// The server owns profile age and territory policy. These identifiers only bind
// the read to the viewer shell's verified account/default-profile lease.
type SearchParams = { query: string; cursor?: string; locale: "en" | "ar" };
type SuggestionsResponse = { suggestions: SearchSuggestion[] };

export function readSearch(
  endpoint: "results",
  params: SearchParams,
  audience: SearchAudience,
  signal: AbortSignal,
): Promise<SearchResponse>;
export function readSearch(
  endpoint: "suggestions",
  params: SearchParams,
  audience: SearchAudience,
  signal: AbortSignal,
): Promise<SuggestionsResponse>;
export async function readSearch(
  endpoint: "results" | "suggestions",
  params: SearchParams,
  audience: SearchAudience,
  signal: AbortSignal,
): Promise<SearchResponse | SuggestionsResponse> {
  const assertCurrent = () => {
    signal.throwIfAborted();
    if (!audience.isCurrent()) throw new SearchReadError(409);
  };
  assertCurrent();
  const query = new URLSearchParams({ q: params.query });
  if (params.cursor) query.set("cursor", params.cursor);
  if (audience.identity) query.set("expectedProfileId", audience.identity.profile.id);
  const response = await fetch(
    `${apiBaseUrl}/public/search${endpoint === "suggestions" ? "/suggestions" : ""}?${query}`,
    {
      cache: "no-store",
      credentials: "include",
      redirect: "error",
      signal,
      headers: {
        "x-ayin-locale": params.locale,
        ...(audience.identity ? { "x-ayin-expected-account": audience.identity.account.id } : {}),
      },
    },
  );
  assertCurrent();
  if (!response.ok) throw new SearchReadError(response.status);
  const body = await readBoundedAccountJson(
    response,
    signal,
    endpoint === "suggestions" ? 32 * 1024 : 256 * 1024,
  );
  assertCurrent();
  return decodeSearch(endpoint, body, params.query);
}

const paths: Record<SearchItem["type"], RegExp> = {
  VIDEO: /^\/watch\/[^/?#\\\s]+(?:\?kids=1)?$/,
  CHANNEL: /^\/c\/[^/?#\\\s]+$/,
  PLAYLIST: /^\/c\/[^/?#\\\s]+\/playlists\/[^/?#\\\s]+$/,
  CREATOR_TV: /^\/c\/[^/?#\\\s]+\/tv$/,
  SERIES: /^\/series\/[^/?#\\\s]+$/,
  MOVIE: /^\/movies\/[^/?#\\\s]+$/,
};
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const nullableText = (value: unknown, max: number): value is string | null =>
  value === null || (typeof value === "string" && value.length <= max);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SearchReadError(0);
  return value as Record<string, unknown>;
}
function decodeSearch(endpoint: "results" | "suggestions", value: unknown, query: string) {
  const body = object(value);
  const items = endpoint === "suggestions" ? body.suggestions : body.items;
  if (!Array.isArray(items) || items.length > (endpoint === "suggestions" ? 8 : 24))
    throw new SearchReadError(0);
  for (const item of items) {
    const entry = object(item);
    if (
      !text(entry.id, 100) ||
      !text(entry.type, 20) ||
      !Object.hasOwn(paths, entry.type) ||
      !text(entry.href, 2048) ||
      !paths[entry.type as SearchItem["type"]].test(entry.href) ||
      // Encoded path separators/dot segments are not canonical public routes.
      /[\u0000-\u001f\u007f%]/.test(entry.href) ||
      entry.href.split(/[/?]/).some((part) => part === "." || part === "..") ||
      !text(endpoint === "suggestions" ? entry.label : entry.title, 1000)
    )
      throw new SearchReadError(0);
    if (
      endpoint === "results" &&
      (!text(entry.kicker, 100) ||
        !nullableText(entry.meta, 1000) ||
        !nullableText(entry.artworkObjectKey, 4096))
    )
      throw new SearchReadError(0);
  }
  if (endpoint === "suggestions") return { suggestions: items as SearchSuggestion[] };
  if (
    body.query !== query ||
    !nullableText(body.nextCursor, 100) ||
    !nullableText(body.emptyMessage, 1000)
  )
    throw new SearchReadError(0);
  return body as unknown as SearchResponse;
}
