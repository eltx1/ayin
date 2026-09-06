import { absoluteUrl } from "@/lib/seo";
import { getSitemapCounts, SITEMAP_SHARD_SIZE, xmlEscape, xmlResponse } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

export async function GET() {
  const counts = await getSitemapCounts();
  const sitemapUrls = [absoluteUrl("/sitemaps/static.xml")];

  for (const kind of ["videos", "channels", "playlists"] as const) {
    const shards = Math.max(1, Math.ceil(counts[kind] / SITEMAP_SHARD_SIZE));
    for (let shard = 0; shard < shards; shard += 1) {
      sitemapUrls.push(absoluteUrl(`/sitemaps/${kind}/${shard}.xml`));
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls
    .map((url) => `<sitemap><loc>${xmlEscape(url)}</loc></sitemap>`)
    .join("\n")}\n</sitemapindex>`;
  return xmlResponse(xml);
}
