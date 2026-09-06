import { cache } from "react";

import { apiBaseUrl } from "@/lib/api";

export interface SeoVideoResponse {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  durationMs: number | null;
  visibility: "PUBLIC" | "UNLISTED";
  publishedAt: string | null;
  updatedAt: string;
  channel: { id: string; handle: string; name: string };
  thumbnail: {
    objectKey: string;
    mimeType: string;
    width: number | null;
    height: number | null;
  } | null;
  source: { objectKey: string; mimeType: string };
}

export interface SeoChannelResponse {
  id: string;
  handle: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  publicVideoCount: number;
  publicPlaylistCount: number;
  avatar: SeoImage | null;
  banner: SeoImage | null;
}

export interface SeoPlaylistResponse {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: "PUBLIC" | "UNLISTED";
  createdAt: string;
  updatedAt: string;
  channel: { id: string; handle: string; name: string };
  items: Array<{
    position: number;
    video: {
      id: string;
      slug: string;
      title: string;
      description: string | null;
      durationMs: number | null;
      publishedAt: string | null;
      thumbnail: SeoImage | null;
    };
  }>;
}

interface SeoImage {
  objectKey: string;
  mimeType: string;
  width: number | null;
  height: number | null;
}

export const getSeoVideo = cache(async (slug: string): Promise<SeoVideoResponse | null> => {
  return fetchSeo<SeoVideoResponse>(`/public/seo/videos/${encodeURIComponent(slug)}`);
});

export const getSeoChannel = cache(async (handle: string): Promise<SeoChannelResponse | null> => {
  return fetchSeo<SeoChannelResponse>(`/public/seo/channels/${encodeURIComponent(handle)}`);
});

export const getSeoPlaylist = cache(
  async (handle: string, slug: string): Promise<SeoPlaylistResponse | null> => {
    return fetchSeo<SeoPlaylistResponse>(
      `/public/seo/playlists/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`,
    );
  },
);

async function fetchSeo<T>(path: string): Promise<T | null> {
  const response = await fetch(`${apiBaseUrl}${path}`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`SEO metadata request failed with ${response.status}.`);
  return (await response.json()) as T;
}
