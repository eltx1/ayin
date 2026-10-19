import { androidAssetLinks } from "@/lib/mobile-app-links";
export const dynamic = "force-dynamic";
export function GET() {
  const links = androidAssetLinks(process.env.ANDROID_APP_LINKS_SHA256_FINGERPRINTS);
  return links
    ? Response.json(links, { headers: { "Cache-Control": "public, max-age=300" } })
    : new Response(null, { status: 404 });
}
