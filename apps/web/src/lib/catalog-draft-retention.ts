export type CatalogKind = "movie" | "series";
export type CatalogFormSnapshot<T = unknown> = {
  draft: T;
  baseline: T;
  sourceFingerprint: string | null;
};
export type CatalogRetainedDraft = {
  version: 1;
  kind: CatalogKind;
  target: { id: string | null; title: string };
  targetFingerprint: string | null;
  forms: Record<string, CatalogFormSnapshot>;
  pending: boolean;
  blocked: boolean;
  overflow?: boolean;
};
type Row = Record<string, unknown>;
const row = (value: unknown): value is Row =>
  value !== null && typeof value === "object" && !Array.isArray(value);
/** Stable exact baseline, not a collision-prone hash or a parent-only timestamp. */
export function catalogFingerprint(value: unknown): string {
  const normalized = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalized);
    if (row(item))
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .filter((key) => item[key] !== undefined)
          .map((key) => [key, normalized(item[key])]),
      );
    return item;
  };
  return JSON.stringify(normalized(value));
}
const pick = (value: unknown, keys: string[]): Row =>
  row(value)
    ? Object.fromEntries(
        keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]),
      )
    : {};
const list = (value: unknown): Row[] => (Array.isArray(value) ? value.filter(row) : []);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (values: Row[]) =>
  [...values].sort(
    (a, b) =>
      compare(
        String(a.id ?? a.type ?? a.territoryCode),
        String(b.id ?? b.type ?? b.territoryCode),
      ) || compare(catalogFingerprint(a), catalogFingerprint(b)),
  );

function videoBaseline(value: unknown) {
  if (!row(value)) return null;
  return {
    ...pick(value, ["id", "title", "slug", "status", "visibility", "durationMs", "removedAt"]),
    channel: pick(value.channel, ["id", "name", "handle", "status", "removedAt"]),
  };
}
function artworkBaseline(value: unknown) {
  return sorted(
    list(value).map((item) => ({
      ...pick(item, ["type", "mediaAssetId", "altText"]),
      asset: row(item.asset)
        ? pick(item.asset, [
            "id",
            "r2ObjectKey",
            "mimeType",
            "kind",
            "status",
            "width",
            "height",
            "removedAt",
          ])
        : null,
    })),
  );
}
function metadataBaseline(value: Row) {
  return {
    ...pick(value, [
      "id",
      "title",
      "slug",
      "synopsis",
      "status",
      "releaseDate",
      "releaseYear",
      "runtimeMinutes",
      "maturityRating",
      "originalLanguage",
      "primaryVideoId",
      "trailerVideoId",
      "publishedAt",
      "updatedAt",
    ]),
    genres: list(value.genres).map((item) => pick(item, ["id", "name", "slug"])),
    artwork: artworkBaseline(value.artwork),
    availability: sorted(
      list(value.availability).map((item) =>
        pick(item, ["territoryCode", "rule", "startsAt", "endsAt", "note"]),
      ),
    ),
    primaryVideo: videoBaseline(value.primaryVideo),
    trailerVideo: videoBaseline(value.trailerVideo),
  };
}
function episodeBaseline(value: Row, versionAndOrder: boolean) {
  return {
    ...pick(value, [
      "id",
      "seasonId",
      "episodeNumber",
      "title",
      "synopsis",
      "releaseDate",
      "status",
      "videoId",
      ...(versionAndOrder ? ["sortOrder", "updatedAt"] : []),
    ]),
    video: videoBaseline(value.video),
  };
}
function seasonBaseline(value: Row, versionAndOrder: boolean) {
  return {
    ...pick(value, [
      "id",
      "seriesId",
      "seasonNumber",
      "title",
      ...(versionAndOrder ? ["sortOrder", "updatedAt"] : []),
    ]),
    artwork: artworkBaseline(value.artwork),
  };
}
/** Only authoritative editable data, resource eligibility, hierarchy and versions.
 * Counters, diagnostic ordering, creation timestamps and future response extras
 * cannot cause a false conflict. Date strings retain their original precision.
 */
export function catalogTargetFingerprint(value: unknown): string | null {
  if (!row(value)) return null;
  return catalogFingerprint({
    metadata: metadataBaseline(value),
    seasons: sorted(
      list(value.seasons).map((season) => ({
        ...seasonBaseline(season, true),
        episodes: sorted(list(season.episodes).map((episode) => episodeBaseline(episode, true))),
      })),
    ),
  });
}
export function catalogFormFingerprint(key: string, ownRecord: unknown): string | null {
  if (!row(ownRecord)) return null;
  if (key === "movie" || key === "series") return catalogFingerprint(metadataBaseline(ownRecord));
  if (key.startsWith("season:")) return catalogFingerprint(seasonBaseline(ownRecord, false));
  if (key.startsWith("episode:")) return catalogFingerprint(episodeBaseline(ownRecord, false));
  if (key.startsWith("new-season:"))
    return catalogFingerprint({
      id: ownRecord.id,
      status: ownRecord.status,
      seasons: sorted(list(ownRecord.seasons).map((item) => pick(item, ["id", "seasonNumber"]))),
    });
  if (key.startsWith("new-episode:"))
    return catalogFingerprint({
      id: ownRecord.id,
      episodes: sorted(list(ownRecord.episodes).map((item) => pick(item, ["id", "episodeNumber"]))),
    });
  return null;
}
function owningRecord(key: string, target: Row): unknown {
  if (key === "movie" || key === "series" || key.startsWith("new-season:")) return target;
  const seasons = Array.isArray(target.seasons) ? target.seasons.filter(row) : [];
  const id = key.slice(key.indexOf(":") + 1);
  if (key.startsWith("season:") || key.startsWith("new-episode:"))
    return seasons.find((season) => season.id === id);
  return seasons
    .flatMap((season) => (Array.isArray(season.episodes) ? season.episodes.filter(row) : []))
    .find((episode) => episode.id === id);
}
export function catalogDraftCanRestore(candidate: CatalogRetainedDraft, target: unknown): boolean {
  if (candidate.overflow || candidate.pending || candidate.blocked) return false;
  if (candidate.target.id === null) return target === null && !candidate.blocked;
  if (
    !row(target) ||
    target.id !== candidate.target.id ||
    target.status === "ARCHIVED" ||
    catalogTargetFingerprint(target) !== candidate.targetFingerprint
  )
    return false;
  return Object.entries(candidate.forms).every(
    ([key, form]) =>
      form.sourceFingerprint !== null &&
      form.sourceFingerprint === catalogFormFingerprint(key, owningRecord(key, target)),
  );
}
export function catalogRestorationConflict(
  candidate: CatalogRetainedDraft,
  target: unknown,
): "pending" | "archived" | "record" | "seasons" | "episodes" | "baseline" {
  if (candidate.pending || candidate.blocked) return "pending";
  if (row(target) && target.status === "ARCHIVED") return "archived";
  try {
    const before: unknown = candidate.targetFingerprint
      ? JSON.parse(candidate.targetFingerprint)
      : null;
    const current = catalogTargetFingerprint(target);
    const after: unknown = current ? JSON.parse(current) : null;
    if (row(before) && row(after)) {
      if (catalogFingerprint(before.metadata) !== catalogFingerprint(after.metadata))
        return "record";
      const seasonsOnly = (value: unknown) =>
        list(value).map((item) =>
          Object.fromEntries(Object.entries(item).filter(([key]) => key !== "episodes")),
        );
      if (
        catalogFingerprint(seasonsOnly(before.seasons)) !==
        catalogFingerprint(seasonsOnly(after.seasons))
      )
        return "seasons";
      if (catalogFingerprint(before.seasons) !== catalogFingerprint(after.seasons))
        return "episodes";
    }
    for (const [key, form] of Object.entries(candidate.forms))
      if (
        !row(target) ||
        form.sourceFingerprint !== catalogFormFingerprint(key, owningRecord(key, target))
      )
        return key.includes("episode")
          ? "episodes"
          : key.includes("season:")
            ? "seasons"
            : "baseline";
  } catch {
    return "baseline";
  }
  return "baseline";
}
export function isCatalogRetainedDraft(
  value: unknown,
  kind: CatalogKind,
): value is CatalogRetainedDraft {
  return (
    row(value) &&
    value.version === 1 &&
    value.kind === kind &&
    row(value.target) &&
    (value.target.id === null || typeof value.target.id === "string") &&
    typeof value.target.title === "string" &&
    (value.targetFingerprint === null || typeof value.targetFingerprint === "string") &&
    row(value.forms) &&
    Object.keys(value.forms).length <= 512 &&
    Object.values(value.forms).every(
      (item) =>
        row(item) &&
        "draft" in item &&
        "baseline" in item &&
        (item.sourceFingerprint === null || typeof item.sourceFingerprint === "string"),
    ) &&
    typeof value.pending === "boolean" &&
    typeof value.blocked === "boolean"
  );
}
