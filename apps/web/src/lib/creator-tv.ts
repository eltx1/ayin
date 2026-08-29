import { apiBaseUrl, readApiError } from "@/lib/api";
import type { ChannelAppearance } from "@/lib/channel";

export interface CreatorTvVideo {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  publishedAt: string | null;
  durationMs: number | null;
  source: { objectKey: string; mimeType: string };
  thumbnail: { objectKey: string; mimeType: string } | null;
}

export interface CreatorTvProgram {
  occurrenceKey: string;
  source: "AUTO" | "ADMIN";
  video: CreatorTvVideo;
  startsAt: string;
  endsAt: string;
  playbackOffsetMs: number;
}

export interface PublicCreatorTvResponse {
  canonicalHandle: string;
  redirectedFrom: string | null;
  channel: {
    id: string;
    handle: string;
    name: string;
    description: string | null;
    createdAt: string;
  };
  appearance: ChannelAppearance;
  tv: {
    id: string;
    slug: string;
    name: string;
    status: "ACTIVE" | "OFF_AIR" | "DISABLED";
    state: "ON_AIR" | "OFF_AIR";
    offAirReason:
      "TV_DISABLED" | "TV_OFF_AIR" | "AUTOMATIC_SCHEDULING_DISABLED" | "NO_ELIGIBLE_VIDEOS" | null;
  };
  schedule: {
    generatedAt: string;
    windowEndsAt: string;
    cycleDurationMs: number;
    nowPlaying: CreatorTvProgram | null;
    upNext: CreatorTvProgram | null;
    guide: CreatorTvProgram[];
    adBreaks: Array<{
      id: string;
      occurrenceKey: string;
      offsetMs: number;
      source: "HOUSE" | "DIRECT" | "PROGRAMMATIC";
    }>;
  };
  playback: {
    exactMidProgramSynchronization: false;
    strategy: "BEST_EFFORT_PROGRESSIVE_MP4";
    conceptualOffsetMs: number;
    limitation: string;
  };
}

export interface CreatorTvManagementResponse {
  channel: { id: string; handle: string; name: string };
  tv: {
    id: string;
    slug: string;
    name: string;
    status: "ACTIVE" | "OFF_AIR" | "DISABLED";
  };
  automation: {
    platformEnabled: boolean;
    channelAutoAddEnabled: boolean;
    channelScheduleEnabled: boolean;
    rotationMode: "PRIORITY_ORDER_OLDEST" | "PRIORITY_ORDER_NEWEST";
    fallbackDurationMs: number;
    guideWindowMinutes: number;
  };
  videos: Array<
    CreatorTvVideo & {
      included: boolean;
      priority: number;
      sortOrder: number | null;
      effectiveDurationMs: number;
    }
  >;
}

export async function fetchPublicCreatorTv(handle: string): Promise<PublicCreatorTvResponse> {
  const response = await fetch(`${apiBaseUrl}/public/channels/${encodeURIComponent(handle)}/tv`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as PublicCreatorTvResponse;
}

export async function getCreatorTvManagement(
  channelId: string,
): Promise<CreatorTvManagementResponse> {
  const response = await fetch(`${apiBaseUrl}/creator/channels/${channelId}/tv`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as CreatorTvManagementResponse;
}

export async function updateCreatorTvVideoPreference(
  tvChannelId: string,
  videoId: string,
  input: { included: boolean; priority: number; sortOrder: number | null },
) {
  const response = await fetch(`${apiBaseUrl}/creator/tv/${tvChannelId}/videos/${videoId}`, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as {
    preference: {
      videoId: string;
      included: boolean;
      priority: number;
      sortOrder: number | null;
      updatedAt: string;
    };
  };
}
