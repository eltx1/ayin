import { AccountScopeError, requestAccountScope } from "./account-scope";
import type { StudioVideo } from "./studio";

export const STUDIO_CONTENT_PAGE_SIZE = 25;
export const STUDIO_CONTENT_HISTORY_LIMIT = 100;
export const studioContentStatuses = [
  "DRAFT",
  "UPLOADING",
  "VALIDATING",
  "SCHEDULED",
  "PUBLISHED",
  "REMOVED",
] as const;
export const studioContentVisibilities = ["PUBLIC", "UNLISTED", "PRIVATE"] as const;
export type StudioContentFilters = { query: string; status: string; visibility: string };
export type StudioContentLocation = {
  filters: StudioContentFilters;
  page: number;
  cursors: (string | null)[];
};
export function firstStudioContentPage(filters: StudioContentFilters): StudioContentLocation {
  return { filters, page: 1, cursors: [null] };
}
export function nextStudioContentPage(
  location: StudioContentLocation,
  cursor: string,
): StudioContentLocation {
  return {
    ...location,
    page: location.page + 1,
    cursors: [...location.cursors, cursor].slice(-STUDIO_CONTENT_HISTORY_LIMIT),
  };
}
export function previousStudioContentPage(location: StudioContentLocation): StudioContentLocation {
  return location.cursors.length > 1
    ? { ...location, page: location.page - 1, cursors: location.cursors.slice(0, -1) }
    : location;
}
const invalid = () => new AccountScopeError(0, "INVALID_CONTENT_RESPONSE");
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, min = 0): string {
  if (typeof value !== "string" || value.length < min || value.length > max) throw invalid();
  return value;
}
function id(value: unknown) {
  const result = text(value, 36, 36);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(result)) throw invalid();
  return result.toLowerCase();
}
function date(value: unknown): string {
  const result = text(value, 24, 24);
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result)
    throw invalid();
  return result;
}
function known<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw invalid();
  return value as T[number];
}
function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null ? null : parse(value);
}
function list<T>(value: unknown, max: number, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) throw invalid();
  return value.map(parse);
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER, min = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    throw invalid();
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw invalid();
  return value;
}
function metadata(value: unknown): StudioVideo["metadata"] {
  if (value === null) return null;
  const row = record(value);
  const countries = (value: unknown) =>
    list(value, 100, (country) => {
      const result = text(country, 2, 2);
      if (!/^[A-Z]{2}$/.test(result)) throw invalid();
      return result;
    });
  return {
    contentType: known(row.contentType, ["CREATOR_VIDEO", "MOVIE", "DOCUMENTARY"]),
    tags: list(row.tags, 20, (value) => text(value, 40, 1)),
    category: nullable(row.category, (value) =>
      known(value, [
        "ENTERTAINMENT",
        "EDUCATION",
        "GAMING",
        "MUSIC",
        "NEWS",
        "SPORTS",
        "TECHNOLOGY",
        "LIFESTYLE",
        "FILM_ANIMATION",
        "OTHER",
      ]),
    ),
    primaryLanguage: nullable(row.primaryLanguage, (value) => text(value, 35, 2)),
    recordingDate: nullable(row.recordingDate, (value) => {
      const result = text(value, 10, 10);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
        !Number.isFinite(Date.parse(result)) ||
        new Date(result).toISOString().slice(0, 10) !== result
      )
        throw invalid();
      return result;
    }),
    seriesTitle: nullable(row.seriesTitle, (value) => text(value, 120)),
    seasonNumber: nullable(row.seasonNumber, (value) => integer(value, 10_000, 1)),
    episodeNumber: nullable(row.episodeNumber, (value) => integer(value, 100_000, 1)),
    maturityLevel: nullable(row.maturityLevel, (value) =>
      known(value, ["GENERAL", "TEEN", "MATURE"]),
    ),
    ageRestriction: known(row.ageRestriction, ["NONE", "AGE_13_PLUS", "AGE_18_PLUS"]),
    allowedTerritories: countries(row.allowedTerritories),
    blockedTerritories: countries(row.blockedTerritories),
    rightsExpiresAt: nullable(row.rightsExpiresAt, date),
    geoAvailabilityMode: nullable(row.geoAvailabilityMode, (value) =>
      known(value, ["WORLDWIDE", "INCLUDE_ONLY", "EXCLUDE"]),
    ),
    geoCountries: countries(row.geoCountries),
    chapters: list(row.chapters ?? [], 100, (value) => {
      const chapter = record(value);
      return { title: text(chapter.title, 100, 1), startSeconds: integer(chapter.startSeconds) };
    }),
    adBreakPreference: nullable(row.adBreakPreference, (value) =>
      known(value, ["AUTOMATIC", "DISABLED", "CUSTOM"]),
    ),
    adBreakOffsetsSeconds: list(row.adBreakOffsetsSeconds, 20, (value) =>
      integer(value, Number.MAX_SAFE_INTEGER, 1),
    ),
    // The established editor represents a missing rights basis by absence.
    ...(row.rightsBasis === null
      ? {}
      : {
          rightsBasis: known(row.rightsBasis, [
            "OWNED",
            "LICENSED",
            "AUTHORIZED",
            "PUBLIC_DOMAIN",
            "OTHER",
          ]),
        }),
    rightsNote: nullable(row.rightsNote, (value) => text(value, 1000)),
  };
}
function cursor(value: unknown): string | null {
  if (value === null) return null;
  const result = text(value, 2048, 1);
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw invalid();
  return result;
}
export function parseStudioContentPage(
  value: unknown,
  filters: StudioContentFilters,
  requestedCursor: string | null,
  expectedChannelId?: string,
) {
  const result = record(value),
    channel = record(result.channel),
    page = record(result.page);
  const channelId = id(channel.id);
  if (
    (expectedChannelId && expectedChannelId !== channelId) ||
    page.take !== STUDIO_CONTENT_PAGE_SIZE ||
    page.cursor !== requestedCursor ||
    page.query !== filters.query ||
    page.status !== filters.status ||
    page.visibility !== filters.visibility
  )
    throw invalid();
  const videos = list(result.videos, STUDIO_CONTENT_PAGE_SIZE, (value): StudioVideo => {
    const row = record(value);
    const status = known(row.status, studioContentStatuses),
      visibility = known(row.visibility, studioContentVisibilities);
    if (
      (filters.status ? status !== filters.status : status === "REMOVED") ||
      (filters.visibility && visibility !== filters.visibility)
    )
      throw invalid();
    return {
      id: id(row.id),
      title: text(row.title, 200, 1),
      description: nullable(row.description, (value) => text(value, 20_000)),
      status,
      visibility,
      commentsEnabled: boolean(row.commentsEnabled),
      tvIncluded: boolean(row.tvIncluded),
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
      publishedAt: nullable(row.publishedAt, date),
      metadata: metadata(row.metadata),
    };
  });
  if (new Set(videos.map((video) => video.id)).size !== videos.length) throw invalid();
  for (let index = 1; index < videos.length; index++) {
    const previous = videos[index - 1]!,
      current = videos[index]!;
    if (
      current.updatedAt > previous.updatedAt ||
      (current.updatedAt === previous.updatedAt && current.id >= previous.id)
    )
      throw invalid();
  }
  const nextCursor = cursor(result.nextCursor);
  if (
    nextCursor !== null &&
    (videos.length !== STUDIO_CONTENT_PAGE_SIZE || nextCursor === requestedCursor)
  )
    throw invalid();
  return {
    actorAccountId: id(result.actorAccountId),
    channel: {
      id: channelId,
      handle: text(channel.handle, 100, 1),
      name: text(channel.name, 200, 1),
      status: text(channel.status, 40, 1),
    },
    videos,
    nextCursor,
  };
}
export type StudioContentPage = ReturnType<typeof parseStudioContentPage>;
export async function readStudioContentPage(
  filters: StudioContentFilters,
  requestedCursor: string | null,
  signal: AbortSignal,
  expected?: { accountId: string; channelId: string },
) {
  if (
    filters.query !== filters.query.trim() ||
    filters.query.length > 200 ||
    (filters.status && !studioContentStatuses.includes(filters.status as never)) ||
    (filters.visibility && !studioContentVisibilities.includes(filters.visibility as never))
  )
    throw invalid();
  const params = new URLSearchParams({ take: String(STUDIO_CONTENT_PAGE_SIZE) });
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (requestedCursor !== null) params.set("cursor", cursor(requestedCursor)!);
  // requestAccountScope deliberately rejects raw '+' and '*'. URLSearchParams
  // uses '+' for spaces and leaves '*' unescaped; preserve both literal meanings.
  const encoded = params.toString().replace(/\+/g, "%20").replace(/\*/g, "%2A");
  const path = `/creator/studio/content?${encoded}`;
  const result = await requestAccountScope(
    path,
    "GET",
    (value) => parseStudioContentPage(value, filters, requestedCursor, expected?.channelId),
    {
      signal,
      expectedAccountId: expected?.accountId,
      maxResponseBytes: 4 * 1024 * 1024,
    },
  );
  if (result.accountId !== result.value.actorAccountId) throw invalid();
  signal.throwIfAborted();
  return result.value;
}
