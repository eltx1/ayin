export const notificationTypes = [
  "system",
  "channel",
  "video",
  "comment",
  "subscription",
  "moderation",
  "monetization",
] as const;
export type NotificationType = (typeof notificationTypes)[number];
export type NotificationPreferences = Record<NotificationType, boolean>;
export const emptyNotificationPreferences = (): NotificationPreferences =>
  Object.fromEntries(notificationTypes.map((key) => [key, false])) as NotificationPreferences;
export interface MobileConfig {
  schemaVersion: 1;
  bridgeVersion: 1;
  minimumAppVersion: { android: string; ios: string };
  latestAppVersion: { android: string; ios: string };
  ads: {
    enabled: boolean;
    testMode: boolean;
    audience: "unknown" | "general" | "children";
    banner: { enabled: boolean };
    interstitial: { enabled: boolean; cooldownSeconds: number; maxPerSession: number };
    platforms: Record<
      "android" | "ios",
      { enabled: boolean; bannerUnitId: string; interstitialUnitId: string }
    >;
    requestTimeoutMs: number;
    retryCount: number;
    retryBackoffMs: number;
  };
  analytics: { enabled: boolean };
  notifications: { enabled: boolean; types: NotificationType[]; richMedia: boolean };
  web: {
    mode: "hosted";
    origin: "https://ayin.stream";
    minimumBridgeVersion: number;
    rolloutPercent: number;
    bundleUpdatesEnabled: false;
  };
}
/** Provider is inferred only from validated native inventory, never a web ad tag URL. */
export function mobileAdUnitProvider(value: unknown): "gam" | "admob" | null {
  if (typeof value !== "string" || value.length > 256 || /\s/.test(value)) return null;
  if (/^ca-app-pub-\d{16}\/\d{10}$/.test(value)) return "admob";
  if (/^\/[0-9]{1,20}(?:\/[A-Za-z0-9_.-]+)+$/.test(value)) return "gam";
  return null;
}
export function isMobileAdUnitId(value: unknown): value is string {
  return value === "" || mobileAdUnitProvider(value) !== null;
}
/** Old shells validate both platforms. Project a copy so GAM cannot disable push/analytics. */
export function mobileConfigForCapabilities(
  config: MobileConfig,
  capabilities: readonly string[],
): MobileConfig {
  const projected = JSON.parse(JSON.stringify(config)) as MobileConfig;
  if (capabilities.includes("ads.gam")) return projected;
  for (const platform of ["android", "ios"] as const) {
    for (const field of ["bannerUnitId", "interstitialUnitId"] as const) {
      if (mobileAdUnitProvider(projected.ads.platforms[platform][field]) === "gam") {
        projected.ads.platforms[platform][field] = "";
        projected.ads.enabled = false;
      }
    }
  }
  return projected;
}
export function parseMobileConfig(input: unknown): MobileConfig {
  if (!input || typeof input !== "object") throw new Error("INVALID_MOBILE_CONFIG");
  const value = input as MobileConfig;
  const bool = (v: unknown) => typeof v === "boolean";
  const range = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
  const version = (v: unknown) => typeof v === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v);
  const unit = isMobileAdUnitId;
  if (
    value.schemaVersion !== 1 ||
    value.bridgeVersion !== 1 ||
    !value.ads ||
    !value.analytics ||
    !value.notifications ||
    !value.web ||
    !["android", "ios"].every(
      (platform) =>
        version(value.minimumAppVersion?.[platform as "android"]) &&
        version(value.latestAppVersion?.[platform as "android"]),
    ) ||
    !bool(value.ads.enabled) ||
    !bool(value.ads.testMode) ||
    !["unknown", "general", "children"].includes(value.ads.audience) ||
    !bool(value.ads.banner?.enabled) ||
    !bool(value.ads.interstitial?.enabled) ||
    !range(value.ads.interstitial?.cooldownSeconds, 60, 3600) ||
    !range(value.ads.interstitial?.maxPerSession, 0, 20) ||
    !["android", "ios"].every(
      (p) =>
        bool(value.ads.platforms?.[p as "android"]?.enabled) &&
        unit(value.ads.platforms?.[p as "android"]?.bannerUnitId) &&
        unit(value.ads.platforms?.[p as "android"]?.interstitialUnitId),
    ) ||
    !range(value.ads.requestTimeoutMs, 1000, 30000) ||
    !range(value.ads.retryCount, 0, 3) ||
    !range(value.ads.retryBackoffMs, 500, 30000) ||
    !bool(value.analytics.enabled) ||
    !bool(value.notifications.enabled) ||
    !bool(value.notifications.richMedia) ||
    !Array.isArray(value.notifications.types) ||
    value.notifications.types.some((type) => !notificationTypes.includes(type)) ||
    value.web.mode !== "hosted" ||
    value.web.origin !== "https://ayin.stream" ||
    value.web.minimumBridgeVersion !== 1 ||
    !range(value.web.rolloutPercent, 0, 100) ||
    value.web.bundleUpdatesEnabled !== false
  )
    throw new Error("INVALID_MOBILE_CONFIG");
  // Copy only JSON data; no callable or prototype-valued properties cross the bridge.
  return JSON.parse(JSON.stringify(value)) as MobileConfig;
}
