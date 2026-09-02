import { apiBaseUrl } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch(`${apiBaseUrl}/authorized-sellers/app-ads`, { cache: "no-store" });
    if (!response.ok) return unavailable();
    const body = (await response.json()) as { text?: unknown };
    if (typeof body.text !== "string") return unavailable();
    return new Response(body.text, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return unavailable();
  }
}

function unavailable() {
  return new Response("Authorized seller file is temporarily unavailable.\n", {
    status: 503,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "60",
    },
  });
}
