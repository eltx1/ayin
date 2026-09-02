import { apiBaseUrl, readApiError } from "./api";
import type { AdminRole } from "./admin-control";

export interface AdminSupportAssignee {
  id: string;
  email: string;
  displayName: string;
  roles: AdminRole[];
}

export interface AdminComplianceChannel {
  id: string;
  name: string;
  handle: string;
  status: string;
  payoutProfile: null | {
    legalName: string;
    preferredCurrency: string;
    identityStatus: string;
    taxStatus: string;
  };
}

export interface AdminRevenueChannelTarget {
  id: string;
  name: string;
  handle: string;
  status: string;
  payoutProfile: null | {
    preferredCurrency: string;
    identityStatus: string;
    taxStatus: string;
  };
}

export interface AdminAdvertisingChannelTarget {
  id: string;
  name: string;
  handle: string;
  status: string;
}

export interface AdminAdvertisingVideoTarget {
  id: string;
  title: string;
  slug: string;
  status: string;
  channel: { id: string; name: string; handle: string };
}

async function adminDirectoryFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as T;
}

export function getAdminSupportAssignees() {
  return adminDirectoryFetch<{ items: AdminSupportAssignee[] }>(
    "/admin/operations/directory/support-assignees",
  );
}

export function searchAdminComplianceChannels(query: string) {
  return adminDirectoryFetch<{ items: AdminComplianceChannel[] }>(
    `/admin/operations/directory/compliance-channels?query=${encodeURIComponent(query.trim())}`,
  );
}

export function searchAdminRevenueChannels(query: string) {
  return adminDirectoryFetch<{ items: AdminRevenueChannelTarget[] }>(
    `/admin/operations/directory/revenue-channels?query=${encodeURIComponent(query.trim())}`,
  );
}

export function searchAdminAdvertisingTargets(query: string) {
  return adminDirectoryFetch<{
    channels: AdminAdvertisingChannelTarget[];
    videos: AdminAdvertisingVideoTarget[];
  }>(`/admin/operations/directory/advertising-targets?query=${encodeURIComponent(query.trim())}`);
}
