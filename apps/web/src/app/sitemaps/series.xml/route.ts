import { apiBaseUrl } from "@/lib/api";
import { absoluteUrl } from "@/lib/seo";
import { xmlEscape, xmlResponse } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

interface SeriesSitemapItem {
  slug: string;
  updatedAt: string;
}

export async function GET() {
  const response = await fetch(`${apiBaseUrl}/public/series-sitemap`, {
    next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error(`Series sitemap feed failed with ${response.status}.`);
  const body = (await response.json()) as { items: SeriesSitemapItem[] };
  const entries = body.items.map(
    (item) =>
      `<url><loc>${xmlEscape(absoluteUrl(`/series/${encodeURIComponent(item.slug)}`))}</loc><lastmod>${xmlEscape(new Date(item.updatedAt).toISOString())}</lastmod></url>`,
  );
  return xmlResponse(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>`,
  );
}
