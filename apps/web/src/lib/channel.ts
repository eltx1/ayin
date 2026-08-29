import { apiBaseUrl, readApiError } from "@/lib/api";

export type ChannelTabId = "home" | "videos" | "tv" | "playlists" | "shorts" | "posts" | "about";

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
  return [
    { id: "home" as const, label: "Home" },
    { id: "videos" as const, label: "Videos" },
    { id: "tv" as const, label: "TV" },
    { id: "playlists" as const, label: "Playlists" },
    ...(features.shorts ? [{ id: "shorts" as const, label: "Shorts" }] : []),
    ...(features.posts ? [{ id: "posts" as const, label: "Posts" }] : []),
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

export async function getEditableChannel(channelId: string): Promise<EditableChannelResponse> {
  const response = await fetch(`${apiBaseUrl}/creator/channels/${channelId}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as EditableChannelResponse;
}

export async function updateEditableChannel(
  channelId: string,
  input: {
    name: string;
    handle: string;
    description: string | null;
    accentColor: string | null;
  },
): Promise<EditableChannelResponse> {
  const response = await fetch(`${apiBaseUrl}/creator/channels/${channelId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as EditableChannelResponse;
}

export async function uploadChannelAsset(
  channelId: string,
  kind: "avatar" | "banner",
  file: File,
): Promise<ChannelAppearance> {
  const authorization = await fetch(
    `${apiBaseUrl}/creator/channels/${channelId}/assets/authorize`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind,
        mimeType: file.type,
        sizeBytes: file.size,
      }),
    },
  );
  if (!authorization.ok) throw new Error(await readApiError(authorization));
  const authorized = (await authorization.json()) as {
    assetId: string;
    upload: { url: string; headers: Record<string, string> };
  };

  await putImage(authorized.upload.url, file, authorized.upload.headers);

  const completion = await fetch(`${apiBaseUrl}/creator/channels/${channelId}/assets/complete`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assetId: authorized.assetId }),
  });
  if (!completion.ok) throw new Error(await readApiError(completion));
  return ((await completion.json()) as { appearance: ChannelAppearance }).appearance;
}

function putImage(url: string, file: File, headers: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.onerror = () => reject(new Error("The channel image upload was interrupted."));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error("The channel image could not be stored. Please try another image."));
    };
    request.send(file);
  });
}
