import "server-only";

import { apiBaseUrl } from "@/lib/api";
import { parseClipsPage, type ClipsPage } from "@/lib/clips";
import { trustedApiRegionHeaders } from "@/lib/trusted-region";

export const clipsPageSize = 20;

export async function fetchClipsPage(cursor?: string): Promise<ClipsPage> {
  const query = new URLSearchParams({ take: String(clipsPageSize) });
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(`${apiBaseUrl}/public/clips?${query}`, {
    cache: "no-store",
    headers: await trustedApiRegionHeaders(),
  });
  if (!response.ok) throw new Error("CLIPS_UNAVAILABLE");
  return parseClipsPage(await response.json());
}
