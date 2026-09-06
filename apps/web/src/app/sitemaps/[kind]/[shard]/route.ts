import { notFound } from "next/navigation";

import {
  getSitemapCounts,
  getSitemapShard,
  getSitemapShardCount,
  type SitemapKind,
  xmlResponse,
} from "@/lib/sitemap";

const kinds = new Set<SitemapKind>(["videos", "channels", "playlists"]);

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; shard: string }> },
) {
  const { kind: kindRaw, shard: shardRaw } = await params;
  if (!kinds.has(kindRaw as SitemapKind) || !shardRaw.endsWith(".xml")) notFound();

  const kind = kindRaw as SitemapKind;
  const shard = Number.parseInt(shardRaw.slice(0, -4), 10);
  if (!Number.isInteger(shard) || shard < 0) notFound();

  const counts = await getSitemapCounts();
  if (shard >= getSitemapShardCount(kind, counts[kind])) notFound();

  return xmlResponse(await getSitemapShard(kind, shard));
}
