import { apiBaseUrl } from "@/lib/api";
import { localizedEntitySitemapLinks } from "@/lib/i18n/seo";
import { absoluteUrl } from "@/lib/seo";
import { xmlEscape, xmlResponse } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

interface SeriesSitemapItem {
  slug: string;
  updatedAt: string;
  availableLocales: string[];
}

export async function GET() {
  const response = await fetch(`${apiBaseUrl}/public/series-sitemap`, {
    next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error(`Series sitemap feed failed with ${response.status}.`);
  const body = (await response.json()) as { items: SeriesSitemapItem[] };
  const entries = body.items.map((item) => {
    const path = `/series/${encodeURIComponent(item.slug)}`;
    const alternates = localizedEntitySitemapLinks(path, item.availableLocales);
    const alternateXml = alternates
      .map(
        (alternate) =>
          `<xhtml:link rel="alternate" hreflang="${xmlEscape(alternate.hreflang)}" href="${xmlEscape(alternate.href)}"/>`,
      )
      .join("");
    return `<url><loc>${xmlEscape(absoluteUrl(path))}</loc><lastmod>${xmlEscape(new Date(item.updatedAt).toISOString())}</lastmod>${alternateXml}</url>`;
  });
  return xmlResponse(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join("\n")}\n</urlset>`,
  );
}
