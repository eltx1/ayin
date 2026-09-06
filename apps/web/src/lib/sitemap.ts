import { apiBaseUrl } from "@/lib/api";
import { absoluteUrl, AYIN_DEFAULT_IMAGE, mediaSeoUrl, seoDescription } from "@/lib/seo";

export const SITEMAP_SHARD_SIZE = 45_000;
const API_PAGE_SIZE = 5_000;

export type SitemapKind = "videos" | "channels" | "playlists";

export interface SitemapCounts {
  videos: number;
  channels: number;
  playlists: number;
}

interface SitemapPage<T> {
  items: T[];
  nextCursor: string | null;
}

interface SitemapVideoItem {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  durationMs: number | null;
  publishedAt: string | null;
  updatedAt: string;
  channel: { handle: string; name: string };
  thumbnailObjectKey: string | null;
  sourceObjectKey: string | null;
}

interface SitemapChannelItem {
  id: string;
  handle: string;
  name: string;
  description: string | null;
  updatedAt: string;
  imageObjectKey: string | null;
}

interface SitemapPlaylistItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  updatedAt: string;
  channel: { handle: string; name: string };
  imageObjectKey: string | null;
}

export async function getSitemapCounts(): Promise<SitemapCounts> {
  const response = await fetch(`${apiBaseUrl}/public/seo/sitemap-counts`, {
    next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error(`SEO sitemap counts failed with ${response.status}.`);
  return (await response.json()) as SitemapCounts;
}

export async function getSitemapShard(kind: SitemapKind, shard: number): Promise<string> {
  if (!Number.isInteger(shard) || shard < 0) throw new Error("Invalid sitemap shard.");
  const start = shard * SITEMAP_SHARD_SIZE;
  const end = start + SITEMAP_SHARD_SIZE;
  let cursor: string | undefined;
  let seen = 0;
  const entries: string[] = [];

  do {
    const page = await fetchSitemapPage(kind, cursor);
    for (const item of page.items) {
      if (seen >= start && seen < end) entries.push(renderEntry(kind, item));
      seen += 1;
      if (seen >= end) break;
    }
    cursor = page.nextCursor ?? undefined;
    if (seen >= end) break;
  } while (cursor);

  const namespaces =
    kind === "videos"
      ? ' xmlns:video="http://www.google.com/schemas/sitemap-video/1.1" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'
      : ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${namespaces}>\n${entries.join("\n")}\n</urlset>`;
}

export function xmlResponse(xml: string): Response {
  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=900, stale-while-revalidate=3600",
    },
  });
}

export function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function fetchSitemapPage(kind: SitemapKind, cursor?: string) {
  const query = new URLSearchParams({ limit: String(API_PAGE_SIZE) });
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(`${apiBaseUrl}/public/seo/sitemap/${kind}?${query.toString()}`, {
    next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error(`SEO sitemap ${kind} feed failed with ${response.status}.`);
  return (await response.json()) as SitemapPage<
    SitemapVideoItem | SitemapChannelItem | SitemapPlaylistItem
  >;
}

function renderEntry(
  kind: SitemapKind,
  item: SitemapVideoItem | SitemapChannelItem | SitemapPlaylistItem,
): string {
  if (kind === "videos") return renderVideoEntry(item as SitemapVideoItem);
  if (kind === "channels") return renderChannelEntry(item as SitemapChannelItem);
  return renderPlaylistEntry(item as SitemapPlaylistItem);
}

function renderVideoEntry(item: SitemapVideoItem): string {
  const loc = absoluteUrl(`/watch/${encodeURIComponent(item.slug)}`);
  const thumbnail = mediaSeoUrl(item.thumbnailObjectKey) ?? AYIN_DEFAULT_IMAGE;
  const contentUrl = mediaSeoUrl(item.sourceObjectKey);
  const description = seoDescription(
    item.description,
    `Watch ${item.title} from ${item.channel.name} on AYIN.`,
    2_000,
  );
  const duration = item.durationMs ? Math.max(1, Math.round(item.durationMs / 1000)) : null;
  const videoXml = contentUrl
    ? [
        "<video:video>",
        `<video:thumbnail_loc>${xmlEscape(thumbnail)}</video:thumbnail_loc>`,
        `<video:title>${xmlEscape(item.title.slice(0, 100))}</video:title>`,
        `<video:description>${xmlEscape(description)}</video:description>`,
        `<video:content_loc>${xmlEscape(contentUrl)}</video:content_loc>`,
        duration ? `<video:duration>${duration}</video:duration>` : "",
        item.publishedAt
          ? `<video:publication_date>${xmlEscape(new Date(item.publishedAt).toISOString())}</video:publication_date>`
          : "",
        `<video:uploader info="${xmlEscape(absoluteUrl(`/c/${encodeURIComponent(item.channel.handle)}`))}">${xmlEscape(item.channel.name)}</video:uploader>`,
        "</video:video>",
      ]
        .filter(Boolean)
        .join("")
    : "";
  return `<url><loc>${xmlEscape(loc)}</loc><lastmod>${xmlEscape(new Date(item.updatedAt).toISOString())}</lastmod><image:image><image:loc>${xmlEscape(thumbnail)}</image:loc></image:image>${videoXml}</url>`;
}

function renderChannelEntry(item: SitemapChannelItem): string {
  const loc = absoluteUrl(`/c/${encodeURIComponent(item.handle)}`);
  const image = mediaSeoUrl(item.imageObjectKey);
  return `<url><loc>${xmlEscape(loc)}</loc><lastmod>${xmlEscape(new Date(item.updatedAt).toISOString())}</lastmod>${image ? `<image:image><image:loc>${xmlEscape(image)}</image:loc></image:image>` : ""}</url>`;
}

function renderPlaylistEntry(item: SitemapPlaylistItem): string {
  const loc = absoluteUrl(
    `/c/${encodeURIComponent(item.channel.handle)}/playlists/${encodeURIComponent(item.slug)}`,
  );
  const image = mediaSeoUrl(item.imageObjectKey);
  return `<url><loc>${xmlEscape(loc)}</loc><lastmod>${xmlEscape(new Date(item.updatedAt).toISOString())}</lastmod>${image ? `<image:image><image:loc>${xmlEscape(image)}</image:loc></image:image>` : ""}</url>`;
}
