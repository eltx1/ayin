import { apiBaseUrl, readApiError } from "./api";

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
  rows: AdminHomeRow[];
  controls: ProductControls;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as T;
}

export const getAdminProductControls = () =>
  request<AdminProductSnapshot>("/admin/product-controls");

export const patchAdminHomeRow = (rowId: string, body: Record<string, unknown>) =>
  request<AdminHomeRow>(`/admin/product-controls/home-rows/${rowId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const reorderAdminHomeRows = (rowIds: string[], reason: string) =>
  request<{ rowIds: string[] }>("/admin/product-controls/home-rows/order", {
    method: "PUT",
    body: JSON.stringify({ rowIds, reason }),
  });

export const replaceAdminHomeRowManualItems = (
  rowId: string,
  items: Array<{ entityType: "VIDEO" | "CREATOR_TV" | "CHANNEL" | "PLAYLIST"; entityId: string }>,
  reason: string,
) =>
  request<AdminHomeRow>(`/admin/product-controls/home-rows/${rowId}/manual-items`, {
    method: "PUT",
    body: JSON.stringify({ items, reason }),
  });

export const updateAdminProductControls = (controls: ProductControls, reason: string) =>
  request<ProductControls>("/admin/product-controls/global", {
    method: "PUT",
    body: JSON.stringify({ ...controls, reason }),
  });
