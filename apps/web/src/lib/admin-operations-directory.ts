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
