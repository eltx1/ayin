import { appleAppLinks } from "@/lib/mobile-app-links";
export const dynamic = "force-dynamic";
export function GET() {
  const links = appleAppLinks(process.env.IOS_APP_LINKS_TEAM_ID);
  return links
    ? Response.json(links, { headers: { "Cache-Control": "public, max-age=300" } })
    : new Response(null, { status: 404 });
}
