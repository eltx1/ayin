import { parseStudioAnalytics, type CreatorAnalytics } from "./studio-analytics";
import { apiBaseUrl, readApiError } from "./api";
import type { QuickVideoMetadata } from "./quick-upload";

export type StudioCaptionTrack = {
  id: string;
  videoId: string;
  languageCode: string;
  label: string;
  kind: "CAPTIONS" | "SUBTITLES";
  default: boolean;
  enabled: boolean;
  status: "READY" | "PENDING";
  sizeBytes: number | null;
  replacing: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StudioVideo = {
  id: string;
  title: string;
  description: string | null;
  status: "DRAFT" | "UPLOADING" | "VALIDATING" | "SCHEDULED" | "PUBLISHED" | "REMOVED";
  visibility: "PUBLIC" | "UNLISTED" | "PRIVATE";
  commentsEnabled: boolean;
  tvIncluded: boolean;
  metadata:
    | (QuickVideoMetadata & {
        contentType: "CREATOR_VIDEO" | "MOVIE" | "DOCUMENTARY";
        tags: string[];
        geoCountries: string[];
        chapters: unknown[];
        adBreakOffsetsSeconds: number[];
      })
    | null;
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

export type StudioAnalytics = CreatorAnalytics;

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

export function getStudioOverview(signal?: AbortSignal): Promise<StudioOverview> {
  return studioFetch("/creator/studio/overview", signal ? { signal } : undefined);
}

export async function getStudioAnalytics(
  days = 28,
  signal?: AbortSignal,
): Promise<StudioAnalytics> {
  const response = await studioFetch<unknown>(
    `/creator/studio/analytics?days=${encodeURIComponent(String(days))}`,
    signal ? { signal } : undefined,
  );
  return parseStudioAnalytics(response, days);
}

export async function getStudioContent(
  filters?: {
    query?: string;
    status?: string;
    visibility?: string;
  },
  signal?: AbortSignal,
): Promise<{ channel: StudioOverview["channel"]; videos: StudioVideo[] }> {
  const params = new URLSearchParams();
  if (filters?.query) params.set("query", filters.query);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.visibility) params.set("visibility", filters.visibility);
  const suffix = params.size ? `?${params.toString()}` : "";
  const response = await studioFetch<{ channel: StudioOverview["channel"]; videos: StudioVideo[] }>(
    `/creator/studio/content${suffix}`,
    signal ? { signal } : undefined,
  );
  if (!Array.isArray(response.videos)) throw new Error("Invalid content response");
  return response;
}

export function updateStudioVideo(
  videoId: string,
  patch: Partial<
    Pick<StudioVideo, "title" | "description" | "visibility" | "commentsEnabled" | "tvIncluded">
  > &
    QuickVideoMetadata,
) {
  return studioFetch(`/creator/studio/videos/${encodeURIComponent(videoId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function getStudioCaptions(videoId: string): Promise<{ tracks: StudioCaptionTrack[] }> {
  return studioFetch(`/creator/studio/videos/${encodeURIComponent(videoId)}/captions`);
}

export function prepareStudioCaptionUpload(
  videoId: string,
  input: {
    fileName: string;
    sizeBytes: number;
    mimeType: "text/vtt";
    languageCode: string;
    label: string;
    kind: "CAPTIONS" | "SUBTITLES";
    default: boolean;
  },
): Promise<{
  trackId: string;
  uploadUrl: string;
  expiresAt: string;
  contentType: "text/vtt";
  maxBytes: number;
}> {
  return studioFetch(`/creator/studio/videos/${encodeURIComponent(videoId)}/captions/uploads`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function prepareStudioCaptionReplacement(videoId: string, trackId: string, file: File) {
  return studioFetch<{
    trackId: string;
    uploadUrl: string;
    expiresAt: string;
    contentType: "text/vtt";
    maxBytes: number;
  }>(
    `/creator/studio/videos/${encodeURIComponent(videoId)}/captions/${encodeURIComponent(trackId)}/uploads`,
    {
      method: "POST",
      body: JSON.stringify({
        fileName: file.name,
        sizeBytes: file.size,
        mimeType: "text/vtt",
      }),
    },
  );
}

export async function putCaptionFile(uploadUrl: string, file: File): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": "text/vtt" },
    body: file,
  });
  if (!response.ok) throw new Error("Caption upload failed before validation.");
}

export function finalizeStudioCaptionUpload(videoId: string, trackId: string) {
  return studioFetch<{ trackId: string; status: "READY"; cueCount: number }>(
    `/creator/studio/videos/${encodeURIComponent(videoId)}/captions/${encodeURIComponent(trackId)}/finalize`,
    { method: "POST", body: "{}" },
  );
}

export function updateStudioCaption(
  videoId: string,
  trackId: string,
  patch: Partial<
    Pick<StudioCaptionTrack, "languageCode" | "label" | "kind" | "enabled" | "default">
  >,
) {
  return studioFetch(
    `/creator/studio/videos/${encodeURIComponent(videoId)}/captions/${encodeURIComponent(trackId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
  );
}

export function removeStudioCaption(videoId: string, trackId: string) {
  return studioFetch(
    `/creator/studio/videos/${encodeURIComponent(videoId)}/captions/${encodeURIComponent(trackId)}`,
    {
      method: "DELETE",
      body: "{}",
    },
  );
}

export function unpublishStudioVideo(videoId: string) {
  return studioFetch(`/creator/studio/videos/${encodeURIComponent(videoId)}/unpublish`, {
    method: "POST",
    body: "{}",
  });
}

export function removeStudioVideo(videoId: string) {
  return studioFetch(`/creator/studio/videos/${encodeURIComponent(videoId)}`, {
    method: "DELETE",
    body: "{}",
  });
}

export async function getStudioComments(signal?: AbortSignal) {
  const response = await studioFetch<{
    channel: StudioOverview["channel"];
    comments: StudioComment[];
  }>("/creator/studio/comments", signal ? { signal } : undefined);
  if (!Array.isArray(response.comments)) throw new Error("Invalid comments response");
  return response;
}
