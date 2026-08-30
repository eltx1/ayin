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
