type Row = Record<string, unknown>;
const row = (value: unknown): value is Row =>
  !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const nullableString = (value: unknown) => value === null || typeof value === "string";
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const validation = (value: unknown) =>
  row(value) &&
  ["READY", "BLOCKED"].includes(String(value.status)) &&
  typeof value.publishable === "boolean" &&
  Array.isArray(value.issues) &&
  value.issues.every((x) => typeof x === "string");
const video = (value: unknown) =>
  value === null ||
  (row(value) &&
    uuid(value.id) &&
    typeof value.title === "string" &&
    typeof value.slug === "string");
const artwork = (value: unknown) =>
  Array.isArray(value) &&
  value.every(
    (x) =>
      row(x) &&
      ["POSTER", "BACKDROP", "LOGO"].includes(String(x.type)) &&
      uuid(x.mediaAssetId) &&
      nullableString(x.altText) &&
      (x.asset === null || (row(x.asset) && typeof x.asset.r2ObjectKey === "string")),
  );
const availability = (value: unknown) =>
  Array.isArray(value) &&
  value.every(
    (x) =>
      row(x) &&
      typeof x.territoryCode === "string" &&
      ["ALLOW", "BLOCK"].includes(String(x.rule)) &&
      nullableString(x.startsAt) &&
      nullableString(x.endsAt) &&
      nullableString(x.note),
  );
const episode = (value: unknown) =>
  row(value) &&
  uuid(value.id) &&
  finite(value.episodeNumber) &&
  finite(value.sortOrder) &&
  typeof value.title === "string" &&
  typeof value.synopsis === "string" &&
  nullableString(value.releaseDate) &&
  nullableString(value.videoId) &&
  video(value.video) &&
  validation(value.validation) &&
  ["DRAFT", "PUBLISHED", "ARCHIVED"].includes(String(value.status));
const season = (value: unknown) =>
  row(value) &&
  uuid(value.id) &&
  finite(value.seasonNumber) &&
  finite(value.sortOrder) &&
  nullableString(value.title) &&
  artwork(value.artwork) &&
  Array.isArray(value.episodes) &&
  value.episodes.every(episode);

export function validCatalogRecord(value: unknown, kind: "movie" | "series"): boolean {
  if (
    !row(value) ||
    !uuid(value.id) ||
    !["title", "slug", "synopsis", "maturityRating", "originalLanguage"].every(
      (key) => typeof value[key] === "string",
    ) ||
    !["DRAFT", "PUBLISHED", "ARCHIVED"].includes(String(value.status)) ||
    !validation(value.validation) ||
    !artwork(value.artwork) ||
    !availability(value.availability) ||
    !Array.isArray(value.genres) ||
    !value.genres.every((x) => row(x) && typeof x.name === "string") ||
    !nullableString(value.trailerVideoId) ||
    !video(value.trailerVideo)
  )
    return false;
  return kind === "movie"
    ? finite(value.releaseYear) &&
        finite(value.runtimeMinutes) &&
        nullableString(value.releaseDate) &&
        nullableString(value.primaryVideoId) &&
        video(value.primaryVideo)
    : (value.releaseYear === null || finite(value.releaseYear)) &&
        Array.isArray(value.seasons) &&
        value.seasons.every(season);
}

export function catalogRecord<T>(body: unknown, kind: "movie" | "series", expectedId?: string): T {
  if (
    !row(body) ||
    !validCatalogRecord(body[kind], kind) ||
    (expectedId !== undefined && (body[kind] as Row).id !== expectedId)
  )
    throw new Error(
      "The catalog response could not be verified. Reopen the saved record before trying again.",
    );
  return body[kind] as T;
}
export function catalogList<T>(body: unknown, kind: "movie" | "series"): T[] {
  if (
    !row(body) ||
    !Array.isArray(body.items) ||
    !body.items.every((item) => validCatalogRecord(item, kind))
  )
    throw new Error("The catalog list could not be verified.");
  return body.items as T[];
}
export function catalogChildAcknowledged(
  body: unknown,
  kind: "season" | "episode",
  expectedId: string | null,
  parent: { key: "seriesId" | "seasonId"; id: string },
) {
  if (!row(body) || !row(body[kind])) return false;
  const child = body[kind] as Row;
  return (
    uuid(child.id) &&
    (expectedId === null || child.id === expectedId) &&
    child[parent.key] === parent.id
  );
}
export function catalogIdentityFailure(status: number, body: unknown): boolean {
  return (
    status === 401 ||
    status === 403 ||
    (status === 409 &&
      row(body) &&
      row(body.error) &&
      ["ACCOUNT_CHANGED", "SESSION_CHANGED"].includes(String(body.error.code)))
  );
}

export function catalogResourceItems<T>(body: unknown, kind: "video" | "artwork"): T[] {
  const channel = (value: unknown) =>
    row(value) && typeof value.name === "string" && typeof value.handle === "string";
  if (
    !row(body) ||
    !Array.isArray(body.items) ||
    body.items.length > 25 ||
    !body.items.every((item) => {
      if (
        !row(item) ||
        !uuid(item.id) ||
        typeof item.label !== "string" ||
        !item.label.trim() ||
        item.label.length > 2048
      )
        return false;
      return kind === "video"
        ? typeof item.title === "string" &&
            typeof item.slug === "string" &&
            (item.durationMs === null || finite(item.durationMs)) &&
            channel(item.channel)
        : typeof item.r2ObjectKey === "string" &&
            typeof item.mimeType === "string" &&
            typeof item.kind === "string" &&
            (item.width === null || finite(item.width)) &&
            (item.height === null || finite(item.height)) &&
            (item.video === null ||
              (row(item.video) &&
                typeof item.video.title === "string" &&
                typeof item.video.slug === "string")) &&
            (item.channel === null || channel(item.channel));
    }) ||
    new Set(body.items.map((item) => (item as Row).id)).size !== body.items.length
  )
    throw new Error("Search results could not be verified. Try searching again.");
  return body.items as T[];
}
