import { apiBaseUrl, readApiError } from "@/lib/api";

export type PlaylistVisibility = "PUBLIC" | "UNLISTED" | "PRIVATE";

export interface PlaylistCapabilities {
  canDelete: boolean;
  canRename: boolean;
  canChangeVisibility: boolean;
  canEditItems: boolean;
}

export interface CreatorPlaylistSummary {
  id: string;
  channelId: string;
  slug: string;
  name: string;
  description: string | null;
  systemKey: "UPLOADS" | null;
  protected: boolean;
  visibility: PlaylistVisibility;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
  capabilities: PlaylistCapabilities;
}

export interface EditablePlaylistResponse {
  playlist: {
    id: string;
    channelId: string;
    slug: string;
    name: string;
    description: string | null;
    systemKey: "UPLOADS" | null;
    protected: boolean;
    visibility: PlaylistVisibility;
    capabilities: PlaylistCapabilities;
  };
  items: Array<{
    id: string;
    position: number;
    video: {
      id: string;
      slug: string;
      title: string;
      status: "PUBLISHED" | "SCHEDULED" | "DRAFT" | "UPLOADING" | "VALIDATING" | "REMOVED";
      visibility: "PUBLIC" | "UNLISTED" | "PRIVATE";
      publishedAt: string | null;
    };
  }>;
  availableVideos: Array<{
    id: string;
    slug: string;
    title: string;
    visibility: "PUBLIC" | "UNLISTED" | "PRIVATE";
    publishedAt: string | null;
  }>;
}

export interface PublicPlaylistResponse {
  canonicalHandle: string;
  redirectedFrom: string | null;
  channel: { id: string; handle: string; name: string };
  playlist: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    visibility: "PUBLIC" | "UNLISTED";
    systemKey: "UPLOADS" | null;
  };
  items: Array<{
    id: string;
    position: number;
    video: {
      id: string;
      slug: string;
      title: string;
      description: string | null;
      durationMs: number | null;
      publishedAt: string | null;
      thumbnail: { objectKey: string; mimeType: string } | null;
    };
  }>;
}

export async function listCreatorPlaylists(channelId: string): Promise<CreatorPlaylistSummary[]> {
  const response = await apiRequest<{ playlists: CreatorPlaylistSummary[] }>(
    `/creator/channels/${channelId}/playlists`,
    "GET",
  );
  return response.playlists;
}

export async function createCreatorPlaylist(
  channelId: string,
  input: { name: string; description?: string | null; visibility: PlaylistVisibility },
): Promise<{ playlist: CreatorPlaylistSummary }> {
  return apiRequest(`/creator/channels/${channelId}/playlists`, "POST", input);
}

export async function getCreatorPlaylist(playlistId: string): Promise<EditablePlaylistResponse> {
  return apiRequest(`/creator/playlists/${playlistId}`, "GET");
}

export async function updateCreatorPlaylist(
  playlistId: string,
  input: { name?: string; description?: string | null; visibility?: PlaylistVisibility },
): Promise<void> {
  await apiRequest(`/creator/playlists/${playlistId}`, "PATCH", input);
}

export async function deleteCreatorPlaylist(playlistId: string): Promise<void> {
  await apiRequest(`/creator/playlists/${playlistId}`, "DELETE");
}

export async function addCreatorPlaylistItem(playlistId: string, videoId: string): Promise<void> {
  await apiRequest(`/creator/playlists/${playlistId}/items`, "POST", { videoId });
}

export async function removeCreatorPlaylistItem(playlistId: string, itemId: string): Promise<void> {
  await apiRequest(`/creator/playlists/${playlistId}/items/${itemId}`, "DELETE");
}

export async function reorderCreatorPlaylistItems(
  playlistId: string,
  itemIds: string[],
): Promise<void> {
  await apiRequest(`/creator/playlists/${playlistId}/items/reorder`, "PUT", { itemIds });
}

async function apiRequest<T = unknown>(
  path: string,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  payload?: unknown,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    credentials: "include",
    cache: "no-store",
    ...(payload === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as T;
}
