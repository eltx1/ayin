import "server-only";

import { normalizeTerritoryCode } from "@ayin/types";
import { headers } from "next/headers";
import { cache } from "react";

export const trustedApiRegionHeaders = cache(async (): Promise<Record<string, string>> => {
  const incoming = await headers();
  // This marker carries no authority. It keeps missing/stale runtime credentials
  // from making a server fetch look like a direct viewer request at the API edge.
  const context: Record<string, string> = { "x-ayin-edge-context": "server" };
  const token = process.env.AYIN_INTERNAL_EDGE_TOKEN?.trim();
  if (!token) return context;
  context["x-ayin-edge-token"] = token;
  if (process.env.AYIN_TRUST_CLOUDFLARE_REGION !== "true") return context;

  const country = normalizeTerritoryCode(incoming.get("cf-ipcountry"));
  if (country) context["x-ayin-edge-country"] = country;
  return context;
});
