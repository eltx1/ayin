import { apiBaseUrl, readApiError } from "./api";

export interface AdminPagination {
  total: number;
  page: number;
  take: number;
  pages: number;
}

export interface AdminAnalyticsMetrics {
  refresh: "query-time";
  dauApprox: number;
  mauApprox: number;
  watchTimeMs: number;
  watchHours: number;
  uploads: number;
  tvStarts: number;
  adEvents: number;
  errors: number;
}

export interface AdminGlobalSearchResult {
  kind: "ACCOUNT" | "CHANNEL" | "VIDEO" | "PAYOUT";
  id: string;
  label: string;
  detail: string;
  href: string;
}

export interface AdminSystemHealth {
  checkedAt: string;
  api: { status: "OK" };
  database: { status: "OK" | "ERROR"; reason: string | null };
  mediaStorage: {
    status: "READY" | "TEST" | "DEVELOPMENT";
    mode: "r2" | "development" | "e2e";
    r2Configured: boolean;
    bucketConfigured: boolean;
    region: string;
    directUploadArchitecture: true;
  };
}

export type AdminRole =
  "SUPERADMIN" | "ADMIN" | "OPERATIONS" | "CONTENT_MODERATOR" | "AD_MANAGER" | "FINANCE_MANAGER";

export interface AdminStaffMember {
  id: string;
  email: string;
  displayName: string;
  status: string;
  authVersion: number;
  createdAt: string;
  roles: AdminRole[];
}

export interface AdminAuditItem {
  id: string;
  actorAccountId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  metadata: unknown;
  createdAt: string;
  actor: { id: string; email: string; displayName: string } | null;
}

export interface AdminSupportTicket {
  id: string;
  createdByAccountId: string;
  assignedToAccountId: string | null;
  category: string;
  subject: string;
  description: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  status: "OPEN" | "IN_PROGRESS" | "WAITING" | "RESOLVED" | "CLOSED";
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  createdBy: { id: string; email: string; displayName: string } | null;
  assignedTo: { id: string; email: string; displayName: string } | null;
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as T;
}

export function getAdminDashboard() {
  return adminFetch<Record<string, unknown>>("/admin/control/dashboard");
}

export function getAdminAnalytics() {
  return adminFetch<AdminAnalyticsMetrics>("/admin/analytics");
}

export function searchAdmin(query: string) {
  return adminFetch<{ query: string; items: AdminGlobalSearchResult[] }>(
    `/admin/control/search?query=${encodeURIComponent(query)}`,
  );
}

export function getAdminSystemHealth() {
  return adminFetch<AdminSystemHealth>("/admin/control/health");
}

export function getAdminCollection<T>(
  resource: "users" | "channels" | "videos" | "tv" | "moderation",
  params: URLSearchParams,
): Promise<T> {
  const suffix = params.size ? `?${params.toString()}` : "";
  return adminFetch(`/admin/control/${resource}${suffix}`);
}

export function patchAdminResource<T>(
  resource: "users" | "channels" | "videos" | "tv",
  id: string,
  body: unknown,
) {
  return adminFetch<T>(`/admin/control/${resource}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function bulkAdminVideos(
  ids: string[],
  action: "UNPUBLISH" | "DISABLE_COMMENTS" | "ENABLE_COMMENTS",
  reason: string,
) {
  return adminFetch<{ affected: number; action: string }>("/admin/control/videos/bulk", {
    method: "POST",
    body: JSON.stringify({ ids, action, reason }),
  });
}

export function getAdminRoles() {
  return adminFetch<{ roles: AdminRole[] }>("/admin/operations/roles");
}

export function getAdminStaff(query = "") {
  const suffix = query.trim() ? `?query=${encodeURIComponent(query.trim())}` : "";
  return adminFetch<{ items: AdminStaffMember[] }>(`/admin/operations/staff${suffix}`);
}

export function updateAdminStaffRoles(accountId: string, roles: AdminRole[], reason: string) {
  return adminFetch<{ accountId: string; roles: AdminRole[]; sessionsRevoked: true }>(
    `/admin/operations/staff/${encodeURIComponent(accountId)}/roles`,
    { method: "PATCH", body: JSON.stringify({ roles, reason }) },
  );
}

export function getAdminAudit(params = new URLSearchParams()) {
  const suffix = params.size ? `?${params.toString()}` : "";
  return adminFetch<{ items: AdminAuditItem[]; pagination: AdminPagination }>(
    `/admin/operations/audit${suffix}`,
  );
}

export function revokeAccountSessions(accountId: string, reason: string) {
  return adminFetch<{ id: string; sessionsRevoked: true }>(
    `/admin/operations/accounts/${encodeURIComponent(accountId)}/revoke-sessions`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}

export function getCreatorCompliance(channelId: string) {
  return adminFetch<{
    channel: { id: string; name: string; handle: string };
    profile: null | {
      id: string;
      legalName: string;
      preferredCurrency: string;
      provider: string;
      destinationMask: string | null;
      countryCode: string | null;
      identityStatus: string;
      taxStatus: string;
      updatedAt: string;
    };
  }>(`/admin/operations/compliance/${encodeURIComponent(channelId)}`);
}

export function updateCreatorCompliance(
  channelId: string,
  input: { identityStatus?: string; taxStatus?: string; reason: string },
) {
  return adminFetch(`/admin/operations/compliance/${encodeURIComponent(channelId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function getAdminSupportTickets(params = new URLSearchParams()) {
  const suffix = params.size ? `?${params.toString()}` : "";
  return adminFetch<{ items: AdminSupportTicket[] }>(`/admin/operations/support${suffix}`);
}

export function updateAdminSupportTicket(
  ticketId: string,
  input: {
    status?: AdminSupportTicket["status"];
    priority?: AdminSupportTicket["priority"];
    assignedToAccountId?: string | null;
    resolution?: string | null;
    reason: string;
  },
) {
  return adminFetch(`/admin/operations/support/${encodeURIComponent(ticketId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function downloadAdminCsv(
  resource: "users" | "channels" | "videos" | "payouts" | "audit",
) {
  const payload = await adminFetch<{ filename: string; content: string }>(
    `/admin/operations/exports/${resource}`,
  );
  const blob = new Blob([payload.content], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = payload.filename;
  anchor.click();
  URL.revokeObjectURL(href);
}
