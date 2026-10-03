export type ChannelTabId = "home" | "videos" | "tv" | "playlists" | "about";

export interface ChannelAsset {
  assetId: string;
  objectKey: string;
  mimeType: string;
}

export interface ChannelAppearance {
  accentColor: string | null;
  avatar: ChannelAsset | null;
  banner: ChannelAsset | null;
}

export interface PublicChannelResponse {
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
  subscription: { available: true; subscriberCount: number };
  features: { shorts: boolean; posts: boolean };
  creatorTv: {
    id: string;
    slug: string;
    name: string;
    status: "ACTIVE" | "OFF_AIR" | "DISABLED";
  } | null;
  videos: Array<{
    id: string;
    slug: string;
    title: string;
    description: string | null;
    durationMs: number | null;
    publishedAt: string | null;
    thumbnail: { objectKey: string; mimeType: string } | null;
  }>;
  playlists: Array<{
    id: string;
    slug: string;
    name: string;
    description: string | null;
    itemCount: number;
  }>;
}

export interface EditableChannelResponse {
  channel: {
    id: string;
    handle: string;
    name: string;
    description: string | null;
    status: "ACTIVE" | "HIDDEN" | "SUSPENDED" | "REMOVED";
  };
  appearance: ChannelAppearance;
  settings: {
    defaultCommentsEnabled: boolean;
    defaultVideoVisibility: "PUBLIC" | "UNLISTED" | "PRIVATE";
    autoAddPublishedToTv: boolean;
    tvAutoScheduleEnabled: boolean;
  } | null;
  previousHandle?: string | null;
}

const mediaBaseUrl = process.env.NEXT_PUBLIC_MEDIA_BASE_URL?.replace(/\/$/, "") ?? null;

export function channelTabs(features: { shorts: boolean; posts: boolean }) {
  // Keep the feature-shaped contract for callers while the current in-page
  // tab set intentionally excludes placeholder-only destinations.
  void features;
  // Posts use the real public Community route. Shorts remain hidden until a
  // channel-specific Viewer surface exists; never expose placeholder tabs.
  return [
    { id: "home" as const, label: "Home" },
    { id: "videos" as const, label: "Videos" },
    { id: "tv" as const, label: "TV" },
    { id: "playlists" as const, label: "Playlists" },
    { id: "about" as const, label: "About" },
  ];
}

export function resolveChannelTab(
  requested: string | string[] | undefined,
  features: { shorts: boolean; posts: boolean },
): ChannelTabId {
  const value = Array.isArray(requested) ? requested[0] : requested;
  const tabs = channelTabs(features);
  return tabs.some((tab) => tab.id === value) ? (value as ChannelTabId) : "home";
}

export function mediaAssetUrl(objectKey: string | null | undefined): string | null {
  if (!mediaBaseUrl || !objectKey) return null;
  const encoded = objectKey
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${mediaBaseUrl}/${encoded}`;
}
