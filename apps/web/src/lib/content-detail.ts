import { apiBaseUrl, readApiError } from "./api";
import type { PublicPlaybackResponse } from "./ayin-player";
import type { SearchResult } from "./search";

export type ContentDetailKind =
  "VIDEO" | "MOVIE" | "SERIES" | "SEASON" | "EPISODE" | "SHORT" | "TV_CHANNEL" | "LIVE_EVENT";

export type ExternalAdPlacementKey = "watch_below_player" | "content_detail";

export interface VideoContentDetailResponse {
  kind: "VIDEO";
  content: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    durationMs: number | null;
    publishedAt: string | null;
    artworkObjectKey: string | null;
    creator: { id: string; handle: string; name: string };
  };
  playback: PublicPlaybackResponse;
  related: SearchResult[];
  actionHooks: {
    save: { key: "save"; status: "RESERVED"; targetTask: "TASK_14" };
  };
  slots: {
    comments: { key: "comments"; enabled: boolean; status: "RESERVED_TASK_15" };
    externalAds: Array<{ key: ExternalAdPlacementKey; status: "RESERVED" }>;
  };
}

export interface ContentDetailViewModel {
  kind: ContentDetailKind;
  title: string;
  description: string | null;
  durationMs: number | null;
  publishedAt: string | null;
  creator: { handle: string; name: string } | null;
  related: SearchResult[];
  saveHookReserved: boolean;
  comments: { enabled: boolean; reserved: boolean };
  externalAdPlacements: ExternalAdPlacementKey[];
}

export async function fetchVideoContentDetail(slug: string): Promise<VideoContentDetailResponse> {
  const response = await fetch(`${apiBaseUrl}/public/content/videos/${encodeURIComponent(slug)}`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as VideoContentDetailResponse;
}

export function videoDetailViewModel(detail: VideoContentDetailResponse): ContentDetailViewModel {
  return {
    kind: detail.kind,
    title: detail.content.title,
    description: detail.content.description,
    durationMs: detail.content.durationMs,
    publishedAt: detail.content.publishedAt,
    creator: detail.content.creator,
    related: detail.related,
    saveHookReserved: detail.actionHooks.save.status === "RESERVED",
    comments: {
      enabled: detail.slots.comments.enabled,
      reserved: detail.slots.comments.status === "RESERVED_TASK_15",
    },
    externalAdPlacements: detail.slots.externalAds.map((placement) => placement.key),
  };
}
