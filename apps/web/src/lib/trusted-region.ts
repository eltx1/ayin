import { headers } from "next/headers";

export async function trustedApiRegionHeaders(): Promise<Record<string, string>> {
  const incoming = await headers();
  const country = incoming.get("cf-ipcountry")?.trim().toUpperCase();
  const token = process.env.AYIN_INTERNAL_EDGE_TOKEN?.trim();
  if (!country || !/^[A-Z]{2}$/.test(country) || !token) return {};
  return {
    "x-ayin-edge-country": country,
    "x-ayin-edge-token": token,
  };
}
