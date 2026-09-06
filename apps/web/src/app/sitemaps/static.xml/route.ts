import { absoluteUrl } from "@/lib/seo";
import { xmlEscape, xmlResponse } from "@/lib/sitemap";

const publicRoutes = [
  "/",
  "/clips",
  "/live",
  "/community",
  "/community-guidelines",
  "/copyright",
  "/creator-terms",
  "/cookies",
] as const;

export function GET() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${publicRoutes
    .map((path) => `<url><loc>${xmlEscape(absoluteUrl(path))}</loc></url>`)
    .join("\n")}\n</urlset>`;
  return xmlResponse(xml);
}
