import { merchandisingScopeHeaders, type MerchandisingTarget } from "./admin-merchandising";
import type { DirectAdminSession } from "./admin-session-scope";
import {
  AdminWorkspaceError,
  adminCount,
  adminId,
  adminKnown,
  adminObject,
  adminRows,
  adminText,
  adminWorkspaceRequest,
} from "./verified-admin-transport";

export const homeRowSources = [
  "CONTINUE_WATCHING",
  "TRENDING_WORLDWIDE",
  "POPULAR_NOW",
  "NEW_ON_AYIN",
  "BECAUSE_YOU_WATCHED",
  "POPULAR_REGION",
  "MOVIES",
  "SERIES",
  "CREATOR_TV",
  "CREATORS_YOU_FOLLOW",
  "RECENTLY_ADDED",
  "EDITOR_PICKS",
] as const;
export const homeDiscoveryModes = ["INHERIT", "AUTO", "MANAGED"] as const;
export type HomeDiscoveryMode = (typeof homeDiscoveryModes)[number];

export interface CreateAdminHomeRow {
  requestId: string;
  expectedRowsRevision: string;
  key: string;
  title: string;
  source: (typeof homeRowSources)[number];
  audience: "ALL" | "AUTHENTICATED" | "ANONYMOUS";
  enabled: boolean;
  maxItems: number;
  regionPersonalizationRequired: boolean;
  targetRegions: string[];
  confirmManagedTransition: boolean;
  reason: string;
}

export interface AdminHomeRow {
  id: string;
  key: string;
  title: string;
  source: string;
  audience: string;
  enabled: boolean;
  position: number;
  maxItems: number;
  regionPersonalizationRequired: boolean;
  targetRegions: string[];
  manualItems: Array<{ id: string; entityType: string; entityId: string; position: number }>;
}

export interface ProductControls {
  navigation: Array<{
    key: string;
    label: string;
    href: string;
    enabled: boolean;
    featureFlag: string | null;
  }>;
  hero: {
    entityType: "VIDEO" | "CREATOR_TV" | "CHANNEL" | "PLAYLIST" | null;
    entityId: string | null;
  };
  taxonomy: Array<{ key: string; label: string; enabled: boolean }>;
  announcement: { enabled: boolean; text: string; href: string | null };
  deviceVisibility: { web: boolean; mobile: boolean; tv: boolean };
}

export interface AdminProductSnapshot {
  selectedTargets: MerchandisingTarget[];
  rows: AdminHomeRow[];
  controls: ProductControls;
  homeDiscoveryMode: HomeDiscoveryMode;
  homeRowsRevision: string;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  actor?: DirectAdminSession,
): Promise<T> {
  return (await adminWorkspaceRequest(path, init?.signal ?? new AbortController().signal, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
      ...(actor ? merchandisingScopeHeaders(actor) : {}),
    },
  })) as T;
}

function readHomeRowsRevision(value: unknown): string {
  const revision = adminText(value, 64, 64);
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new AdminWorkspaceError();
  return revision;
}

export const getAdminProductControls = async (signal?: AbortSignal, actor?: DirectAdminSession) => {
  const snapshot = await request<AdminProductSnapshot>(
    "/admin/product-controls",
    signal ? { signal } : undefined,
    actor,
  );
  return {
    ...snapshot,
    homeDiscoveryMode: adminKnown(snapshot.homeDiscoveryMode, homeDiscoveryModes),
    homeRowsRevision: readHomeRowsRevision(snapshot.homeRowsRevision),
  };
};

export async function updateAdminHomeDiscoveryMode(
  value: HomeDiscoveryMode,
  reason: string,
  confirmHighImpact: boolean,
  signal?: AbortSignal,
  actor?: DirectAdminSession,
) {
  if (!confirmHighImpact || reason.trim().length < 3 || reason.trim().length > 500)
    throw new AdminWorkspaceError();
  adminKnown(value, homeDiscoveryModes);
  const result = await request<unknown>(
    "/admin/settings/homeDiscoveryMode",
    {
      signal: signal ?? null,
      method: "PATCH",
      body: JSON.stringify({ value, reason: reason.trim(), confirmHighImpact }),
    },
    actor,
  );
  try {
    const acknowledgment = adminObject(result);
    if (
      acknowledgment.key !== "homeDiscoveryMode" ||
      acknowledgment.value !== value ||
      acknowledgment.highImpact !== true ||
      typeof acknowledgment.changed !== "boolean"
    )
      throw new AdminWorkspaceError();
    const saved = await getAdminProductControls(signal, actor);
    if (saved.homeDiscoveryMode !== value) throw new AdminWorkspaceError();
    return saved.homeDiscoveryMode;
  } catch (error) {
    if (
      error instanceof AdminWorkspaceError &&
      ([401, 403].includes(error.status) ||
        (error.status === 409 && ["ACCOUNT_CHANGED", "SESSION_CHANGED"].includes(error.code)))
    )
      throw error;
    throw new AdminWorkspaceError(0, true);
  }
}

export async function createAdminHomeRow(
  input: CreateAdminHomeRow,
  signal?: AbortSignal,
  actor?: DirectAdminSession,
) {
  const submitted = {
    ...input,
    key: input.key.trim(),
    title: input.title.trim(),
    targetRegions: parseRegionTargets(input.targetRegions.join(",")).sort(),
    reason: input.reason.trim(),
  };
  adminId(submitted.requestId);
  readHomeRowsRevision(submitted.expectedRowsRevision);
  const result = await request<unknown>(
    "/admin/product-controls/home-rows",
    { signal: signal ?? null, method: "POST", body: JSON.stringify(submitted) },
    actor,
  );
  try {
    const acknowledgment = adminObject(result);
    const value = adminObject(acknowledgment.row);
    if (
      typeof value.enabled !== "boolean" ||
      typeof value.regionPersonalizationRequired !== "boolean"
    )
      throw new AdminWorkspaceError();
    const row: AdminHomeRow = {
      id: adminId(value.id),
      key: adminText(value.key, 80, 1),
      title: adminText(value.title, 120, 1),
      source: adminKnown(value.source, homeRowSources),
      audience: adminKnown(value.audience, ["ALL", "AUTHENTICATED", "ANONYMOUS"]),
      enabled: value.enabled,
      position: adminCount(value.position),
      maxItems: adminCount(value.maxItems, 40),
      regionPersonalizationRequired: value.regionPersonalizationRequired,
      targetRegions: adminRows(value.targetRegions, 64, (region) => adminText(region, 2, 2)),
      manualItems: adminRows(value.manualItems, 100, (entry) => {
        const item = adminObject(entry);
        return {
          id: adminId(item.id),
          entityType: adminKnown(item.entityType, ["VIDEO", "CREATOR_TV", "CHANNEL", "PLAYLIST"]),
          entityId: adminId(item.entityId),
          position: adminCount(item.position),
        };
      }),
    };
    if (
      row.id !== submitted.requestId ||
      row.key !== submitted.key ||
      row.title !== submitted.title ||
      row.source !== submitted.source ||
      row.audience !== submitted.audience ||
      row.enabled !== submitted.enabled ||
      row.maxItems !== submitted.maxItems ||
      row.regionPersonalizationRequired !== submitted.regionPersonalizationRequired ||
      JSON.stringify([...row.targetRegions].sort()) !== JSON.stringify(submitted.targetRegions) ||
      typeof acknowledgment.replayed !== "boolean"
    )
      throw new AdminWorkspaceError();
    return {
      row,
      replayed: acknowledgment.replayed,
      homeRowsRevision: readHomeRowsRevision(acknowledgment.homeRowsRevision),
    };
  } catch {
    throw new AdminWorkspaceError(0, true);
  }
}

export const patchAdminHomeRow = (
  rowId: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  actor?: DirectAdminSession,
) =>
  request<Omit<AdminHomeRow, "manualItems"> & { homeRowsRevision: string }>(
    `/admin/product-controls/home-rows/${rowId}`,
    {
      signal: signal ?? null,
      method: "PATCH",
      body: JSON.stringify(body),
    },
    actor,
  );

export const reorderAdminHomeRows = (
  rowIds: string[],
  reason: string,
  signal?: AbortSignal,
  actor?: DirectAdminSession,
) =>
  request<{ rowIds: string[]; homeRowsRevision: string }>(
    "/admin/product-controls/home-rows/order",
    {
      signal: signal ?? null,
      method: "PUT",
      body: JSON.stringify({ rowIds, reason }),
    },
    actor,
  );

export const replaceAdminHomeRowManualItems = (
  rowId: string,
  items: Array<{ entityType: "VIDEO" | "CREATOR_TV" | "CHANNEL" | "PLAYLIST"; entityId: string }>,
  reason: string,
  signal?: AbortSignal,
  actor?: DirectAdminSession,
) =>
  request<Omit<AdminHomeRow, "targetRegions">>(
    `/admin/product-controls/home-rows/${rowId}/manual-items`,
    {
      signal: signal ?? null,
      method: "PUT",
      body: JSON.stringify({ items, reason }),
    },
    actor,
  );

export const updateAdminProductControls = async (
  controls: ProductControls,
  reason: string,
  signal?: AbortSignal,
  actor?: DirectAdminSession,
) => {
  // Match the API's documented trimming without deriving taxonomy identifiers
  // from labels. A successful HTTP status alone is not confirmation of this draft.
  const submitted: ProductControls = {
    navigation: controls.navigation.map((item) => ({
      ...item,
      label: item.label.trim(),
      featureFlag: item.featureFlag?.trim() ?? null,
    })),
    hero: { ...controls.hero },
    taxonomy: controls.taxonomy.map((item) => ({ ...item, label: item.label.trim() })),
    announcement: { ...controls.announcement, text: controls.announcement.text.trim() },
    deviceVisibility: { ...controls.deviceVisibility },
  };
  const result = await request<unknown>(
    "/admin/product-controls/global",
    {
      signal: signal ?? null,
      method: "PUT",
      body: JSON.stringify({ ...submitted, reason }),
    },
    actor,
  );
  if (!sameProductControlsValue(result, submitted)) throw new AdminWorkspaceError(0, true);
  return submitted;
};

function sameProductControlsValue(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((entry, index) => sameProductControlsValue(actual[index], entry))
    );
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    const record = actual as Record<string, unknown>;
    return (
      Object.keys(record).length === Object.keys(expected).length &&
      Object.entries(expected).every(([key, value]) => sameProductControlsValue(record[key], value))
    );
  }
  return false;
}

export function parseRegionTargets(value: string): string[] {
  const regions = [
    ...new Set(
      value
        .split(/[\s,،]+/)
        .map((part) => part.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  if (regions.length > 64 || regions.some((region) => !/^[A-Z]{2}$/.test(region))) {
    throw new Error("INVALID_REGIONS");
  }
  return regions;
}

export function mergeHomeRowFields(
  rows: AdminHomeRow[],
  id: string,
  result: Partial<AdminHomeRow>,
  fields: Array<keyof AdminHomeRow>,
): AdminHomeRow[] {
  const patch = Object.fromEntries(
    fields.filter((field) => result[field] !== undefined).map((field) => [field, result[field]]),
  );
  return rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
}
