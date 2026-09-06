import { absoluteUrl } from "@/lib/seo";
import { getSitemapCounts, getSitemapShardCount, xmlEscape, xmlResponse } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

export async function GET() {
  const counts = await getSitemapCounts();
  const sitemapUrls = [absoluteUrl("/sitemaps/static.xml")];

  for (const kind of ["videos", "channels", "playlists"] as const) {
    const shards = getSitemapShardCount(kind, counts[kind]);
    for (let shard = 0; shard < shards; shard += 1) {
      sitemapUrls.push(absoluteUrl(`/sitemaps/${kind}/${shard}.xml`));
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls
    .map((url) => `<sitemap><loc>${xmlEscape(url)}</loc></sitemap>`)
    .join("\n")}\n</sitemapindex>`;
  return xmlResponse(xml);
}
