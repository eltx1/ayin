import { supportedLocales } from "@/lib/i18n/config";
import { localizePath } from "@/lib/i18n/routing";
import { localizedSitemapLinks } from "@/lib/i18n/seo";
import { absoluteUrl } from "@/lib/seo";
import { xmlEscape, xmlResponse } from "@/lib/sitemap";

const publicRoutes = [
  "/",
  "/clips",
  "/community",
  "/community-guidelines",
  "/copyright",
  "/creator-terms",
  "/cookies",
  "/privacy",
  "/terms",
] as const;

// Only routes with meaningful localized UI should be advertised as hreflang alternates.
// Add routes here as their product copy is localized; page implementations remain shared.
const localizedPublicRoutes = new Set<string>(["/"]);

function localizedUrlXml(path: string): string[] {
  const alternates = localizedSitemapLinks(path)
    .map(
      ({ hreflang, href }) =>
        `<xhtml:link rel="alternate" hreflang="${xmlEscape(hreflang)}" href="${xmlEscape(href)}" />`,
    )
    .join("");

  return supportedLocales.map(
    (locale) =>
      `<url><loc>${xmlEscape(absoluteUrl(localizePath(path, locale)))}</loc>${alternates}</url>`,
  );
}

export function GET() {
  const urls = publicRoutes.flatMap((path) =>
    localizedPublicRoutes.has(path)
      ? localizedUrlXml(path)
      : [`<url><loc>${xmlEscape(absoluteUrl(path))}</loc></url>`],
  );
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>`;
  return xmlResponse(xml);
}
