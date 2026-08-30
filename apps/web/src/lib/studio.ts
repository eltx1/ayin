import { apiBaseUrl, readApiError } from "./api";

export type StudioVideo = {
  id: string;
  title: string;
  description: string | null;
  status: "DRAFT" | "UPLOADING" | "VALIDATING" | "SCHEDULED" | "PUBLISHED" | "REMOVED";
  visibility: "PUBLIC" | "UNLISTED" | "PRIVATE";
  commentsEnabled: boolean;
  tvIncluded: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type StudioOverview = {
  channel: { id: string; handle: string; name: string; status: string };
  counters: {
    videos: number;
    publishedVideos: number;
    subscribers: number;
    comments: number;
    playlists: number;
  };
  analytics: {
    views: number | null;
    watchTimeMs: number | null;
    available: boolean;
    reason: string;
  };
  recentUploads: Array<{
    id: string;
    title: string;
    status: string;
    visibility: string;
    commentsEnabled: boolean;
    createdAt: string;
    publishedAt: string | null;
  }>;
  monetization: {
    contractStatus: string;
    revenueShareBps: number | null;
    effectiveFrom: string | null;
    estimatedRevenue: number | null;
    available: boolean;
    reason: string;
  };
};

export type StudioAnalytics = {
  periodDays: number;
  refresh: "query-time";
  views: number;
  watchTimeMs: number;
  averageViewDurationMs: number;
  completionRate: number;
  subscribers: number;
  topVideos: Array<{ videoId: string; title: string; views: number }>;
};

export type StudioComment = {
  id: string;
  body: string;
  status: string;
  createdAt: string;
  parentId: string | null;
  authorProfile: { id: string; name: string; slug: string };
  video: { id: string; title: string; commentsEnabled: boolean };
  _count: { reactions: number; reports: number; replies: number };
};

async function studioFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as T;
}

export function getStudioOverview(): Promise<StudioOverview> {
  return studioFetch("/creator/studio/overview");
}

export function getStudioAnalytics(days = 28): Promise<StudioAnalytics> {
  return studioFetch(`/creator/studio/analytics?days=${encodeURIComponent(String(days))}`);
}

export async function getStudioContent(filters?: {
  query?: string;
  status?: string;
  visibility?: string;
}): Promise<{ channel: StudioOverview["channel"]; videos: StudioVideo[] }> {
  const params = new URLSearchParams();
  if (filters?.query) params.set("query", filters.query);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.visibility) params.set("visibility", filters.visibility);
  const suffix = params.size ? `?${params.toString()}` : "";
  return studioFetch(`/creator/studio/content${suffix}`);
}

export function updateStudioVideo(
  videoId: string,
  patch: Partial<
    Pick<StudioVideo, "title" | "description" | "visibility" | "commentsEnabled" | "tvIncluded">
  >,
) {
  return studioFetch(`/creator/studio/videos/${encodeURIComponent(videoId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function unpublishStudioVideo(videoId: string) {
  return studioFetch(`/creator/studio/videos/${encodeURIComponent(videoId)}/unpublish`, {
    method: "POST",
  });
}

export function removeStudioVideo(videoId: string) {
  return studioFetch(`/creator/studio/videos/${encodeURIComponent(videoId)}`, {
    method: "DELETE",
  });
}

export function getStudioComments(): Promise<{
  channel: StudioOverview["channel"];
  comments: StudioComment[];
}> {
  return studioFetch("/creator/studio/comments");
}
