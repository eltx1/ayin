import { apiBaseUrl, type AyinIdentity, readApiError } from "./api";

export type DiscoveryItemType = "VIDEO" | "CREATOR_TV" | "CHANNEL" | "PLAYLIST";
export type DiscoveryAvailability = "AVAILABLE" | "EMPTY" | "UNAVAILABLE";

export interface DiscoveryItem {
  id: string;
  type: DiscoveryItemType;
  title: string;
  href: string;
  kicker: string;
  meta: string | null;
  artworkObjectKey: string | null;
  progress?: { positionMs: number; completedAt: string | null };
}

export interface DiscoveryRowData {
  key: string;
  title: string;
  source?: string;
  maxItems?: number;
  items: DiscoveryItem[];
  nextCursor: string | null;
  availability: DiscoveryAvailability;
  emptyMessage: string;
}

export interface DiscoveryHomeResponse {
  rows: DiscoveryRowData[];
}

export interface MyAyinResponse {
  profileId: string;
  sections: DiscoveryRowData[];
}

export async function getIdentity(signal?: AbortSignal): Promise<AyinIdentity | null> {
  const response = await fetch(`${apiBaseUrl}/auth/me`, {
    cache: "no-store",
    credentials: "include",
    signal: signal ?? null,
  });
  if (!response.ok) return null;
  return (await response.json()) as AyinIdentity;
}

export async function fetchDiscoveryHome(
  authenticated: boolean,
  signal?: AbortSignal,
): Promise<DiscoveryHomeResponse> {
  const response = await fetch(
    `${apiBaseUrl}/${authenticated ? "discovery" : "public/discovery"}/home`,
    { cache: "no-store", credentials: "include", signal: signal ?? null },
  );
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as DiscoveryHomeResponse;
}

export async function fetchDiscoveryRow(
  key: string,
  cursor: string,
  authenticated: boolean,
): Promise<DiscoveryRowData> {
  const parameters = new URLSearchParams({ cursor, limit: "8" });
  const response = await fetch(
    `${apiBaseUrl}/${authenticated ? "discovery" : "public/discovery"}/rows/${encodeURIComponent(key)}?${parameters}`,
    { cache: "no-store", credentials: "include" },
  );
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as DiscoveryRowData;
}

export async function fetchMyAyin(signal?: AbortSignal): Promise<MyAyinResponse> {
  const response = await fetch(`${apiBaseUrl}/discovery/my-ayin`, {
    cache: "no-store",
    credentials: "include",
    signal: signal ?? null,
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as MyAyinResponse;
}

export async function fetchMyAyinSection(
  section: string,
  cursor: string,
): Promise<DiscoveryRowData> {
  const parameters = new URLSearchParams({ cursor, limit: "8" });
  const response = await fetch(
    `${apiBaseUrl}/discovery/my-ayin/${encodeURIComponent(section)}?${parameters}`,
    { cache: "no-store", credentials: "include" },
  );
  if (!response.ok) throw new Error(await readApiError(response));
  const page = (await response.json()) as Omit<DiscoveryRowData, "key" | "title">;
  return { key: section, title: section, ...page };
}
