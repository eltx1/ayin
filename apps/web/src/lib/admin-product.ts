import { merchandisingScopeHeaders, type MerchandisingTarget } from "./admin-merchandising";
import type { DirectAdminSession } from "./admin-session-scope";
import { adminWorkspaceRequest } from "./verified-admin-transport";

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

export const updateAdminProductControls = (
  controls: ProductControls,
  reason: string,
  signal?: AbortSignal,
  actor?: DirectAdminSession,
) =>
  request<ProductControls>(
    "/admin/product-controls/global",
    {
      signal: signal ?? null,
      method: "PUT",
      body: JSON.stringify({ ...controls, reason }),
    },
    actor,
  );

export function parseRegionTargets(value: string): string[] {
  const regions = [
    ...new Set(
      value
        .split(/[\s,]+/)
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
