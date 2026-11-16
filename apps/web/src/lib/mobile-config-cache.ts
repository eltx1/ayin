import { parseMobileConfig, type MobileConfig } from "./mobile-config";

const cacheKey = "ayin.mobile.public-config.v1";
export const maxConfigAgeMs = 24 * 60 * 60 * 1000;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (key) => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export async function mobileConfigRevision(config: MobileConfig): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(config)));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function rememberMobileConfig(config: MobileConfig, fetchedAt: number): void {
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ config, fetchedAt }));
  } catch {
    /* Optional recovery only. */
  }
}
export function cachedMobileConfig(now = Date.now()): MobileConfig | null {
  try {
    const value = JSON.parse(localStorage.getItem(cacheKey) ?? "null");
    if (
      !value ||
      typeof value.fetchedAt !== "number" ||
      !Number.isFinite(value.fetchedAt) ||
      value.fetchedAt > now + 300000 ||
      now - value.fetchedAt > maxConfigAgeMs
    )
      return null;
    const config = parseMobileConfig(value.config);
    // Cached data supports recovery, never authority to resume tracking/ads/push offline.
    return {
      ...config,
      ads: { ...config.ads, enabled: false },
      analytics: { enabled: false },
      notifications: { ...config.notifications, enabled: false },
      webViewAds: {
        android: { pageAdsEnabled: false, videoAdsEnabled: false },
        ios: { pageAdsEnabled: false, videoAdsEnabled: false },
      },
    };
  } catch {
    return null;
  }
}
