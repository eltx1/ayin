import { merchandisingScopeHeaders, type MerchandisingTarget } from "./admin-merchandising";
import type { DirectAdminSession } from "./admin-session-scope";
import { AdminWorkspaceError, adminWorkspaceRequest } from "./verified-admin-transport";

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

export const getAdminProductControls = (signal?: AbortSignal, actor?: DirectAdminSession) =>
  request<AdminProductSnapshot>("/admin/product-controls", signal ? { signal } : undefined, actor);

export const patchAdminHomeRow = (
  rowId: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
  actor?: DirectAdminSession,
) =>
  request<Omit<AdminHomeRow, "manualItems">>(
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
  request<{ rowIds: string[] }>(
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
