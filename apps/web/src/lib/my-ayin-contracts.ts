import type {
  DiscoveryAvailability,
  DiscoveryItem,
  DiscoveryItemType,
  DiscoveryRowData,
  MyAyinResponse,
} from "./discovery";

const itemTypes = new Set<DiscoveryItemType>([
  "VIDEO",
  "CREATOR_TV",
  "CHANNEL",
  "PLAYLIST",
  "SERIES",
]);
const availability = new Set<DiscoveryAvailability>(["AVAILABLE", "EMPTY", "UNAVAILABLE"]);

function text(value: unknown): value is string {
  return typeof value === "string";
}

function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseDiscoveryItem(value: unknown): DiscoveryItem {
  if (!value || typeof value !== "object") throw new Error("INVALID_MY_AYIN");
  const item = value as Record<string, unknown>;
  if (
    !text(item.id) ||
    !itemTypes.has(item.type as DiscoveryItemType) ||
    !text(item.title) ||
    !text(item.href) ||
    !item.href.startsWith("/") ||
    !text(item.kicker) ||
    !nullableText(item.meta) ||
    !nullableText(item.artworkObjectKey)
  ) {
    throw new Error("INVALID_MY_AYIN");
  }
  let progress: DiscoveryItem["progress"];
  if (item.progress !== undefined) {
    if (!item.progress || typeof item.progress !== "object") throw new Error("INVALID_MY_AYIN");
    const raw = item.progress as Record<string, unknown>;
    if (
      typeof raw.positionMs !== "number" ||
      !Number.isInteger(raw.positionMs) ||
      raw.positionMs < 0 ||
      !nullableText(raw.completedAt)
    ) {
      throw new Error("INVALID_MY_AYIN");
    }
    progress = { positionMs: raw.positionMs, completedAt: raw.completedAt };
  }
  return {
    id: item.id,
    type: item.type as DiscoveryItemType,
    title: item.title,
    href: item.href,
    kicker: item.kicker,
    meta: item.meta,
    artworkObjectKey: item.artworkObjectKey,
    ...(progress ? { progress } : {}),
  };
}

export function parseDiscoveryRow(value: unknown): DiscoveryRowData {
  if (!value || typeof value !== "object") throw new Error("INVALID_MY_AYIN");
  const row = value as Record<string, unknown>;
  if (
    !text(row.key) ||
    !text(row.title) ||
    (row.source !== undefined && !text(row.source)) ||
    (row.maxItems !== undefined &&
      (typeof row.maxItems !== "number" || !Number.isInteger(row.maxItems) || row.maxItems < 0)) ||
    !Array.isArray(row.items) ||
    row.items.length > 100 ||
    !nullableText(row.nextCursor) ||
    !availability.has(row.availability as DiscoveryAvailability) ||
    !text(row.emptyMessage)
  ) {
    throw new Error("INVALID_MY_AYIN");
  }
  return {
    key: row.key,
    title: row.title,
    ...(row.source !== undefined ? { source: row.source as string } : {}),
    ...(row.maxItems !== undefined ? { maxItems: row.maxItems as number } : {}),
    items: row.items.map(parseDiscoveryItem),
    nextCursor: row.nextCursor,
    availability: row.availability as DiscoveryAvailability,
    emptyMessage: row.emptyMessage,
  };
}

export function parseMyAyinResponse(value: unknown): MyAyinResponse {
  if (!value || typeof value !== "object") throw new Error("INVALID_MY_AYIN");
  const response = value as Record<string, unknown>;
  if (
    !text(response.profileId) ||
    !Array.isArray(response.sections) ||
    response.sections.length > 12
  ) {
    throw new Error("INVALID_MY_AYIN");
  }
  const sections = response.sections.map(parseDiscoveryRow);
  if (new Set(sections.map((section) => section.key)).size !== sections.length) {
    throw new Error("INVALID_MY_AYIN");
  }
  return { profileId: response.profileId, sections };
}

export interface LensItem {
  id: string;
  slug: string;
  title: string;
  channelId: string;
  channelHandle: string;
  channelName: string;
  artworkObjectKey: string | null;
  score: number;
  reason: { code: string; label: string };
}

export interface LensResponse {
  profileId: string;
  mode: "HEURISTIC_V1" | "SAFE_FALLBACK";
  algorithm: string;
  items: LensItem[];
}

function parseLensItem(value: unknown): LensItem {
  if (!value || typeof value !== "object") throw new Error("INVALID_LENS");
  const item = value as Record<string, unknown>;
  const reason =
    item.reason && typeof item.reason === "object"
      ? (item.reason as Record<string, unknown>)
      : null;
  if (
    !text(item.id) ||
    !text(item.slug) ||
    !text(item.title) ||
    !text(item.channelId) ||
    !text(item.channelHandle) ||
    !text(item.channelName) ||
    !nullableText(item.artworkObjectKey) ||
    typeof item.score !== "number" ||
    !Number.isFinite(item.score) ||
    !reason ||
    !text(reason.code) ||
    !text(reason.label)
  ) {
    throw new Error("INVALID_LENS");
  }
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    channelId: item.channelId,
    channelHandle: item.channelHandle,
    channelName: item.channelName,
    artworkObjectKey: item.artworkObjectKey,
    score: item.score,
    reason: { code: reason.code, label: reason.label },
  };
}

export function parseLensResponse(value: unknown): LensResponse {
  if (!value || typeof value !== "object") throw new Error("INVALID_LENS");
  const response = value as Record<string, unknown>;
  if (
    !text(response.profileId) ||
    (response.mode !== "HEURISTIC_V1" && response.mode !== "SAFE_FALLBACK") ||
    !text(response.algorithm) ||
    !Array.isArray(response.items) ||
    response.items.length > 48
  ) {
    throw new Error("INVALID_LENS");
  }
  return {
    profileId: response.profileId,
    mode: response.mode,
    algorithm: response.algorithm,
    items: response.items.map(parseLensItem),
  };
}

export function confirmNotInterested(
  value: unknown,
  expectedProfileId: string,
  expectedVideoId: string,
): boolean {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return (
    result.profileId === expectedProfileId &&
    result.videoId === expectedVideoId &&
    result.state === "NOT_INTERESTED"
  );
}

export function confirmLensReset(value: unknown, expectedProfileId: string): boolean {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return (
    result.profileId === expectedProfileId &&
    typeof result.resetAt === "string" &&
    Number.isFinite(Date.parse(result.resetAt))
  );
}
