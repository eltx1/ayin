/** Versioned, deliberately finite native API. Native hosts independently enforce origin and schema. */
export type MobileCapability =
  | "privacy"
  | "analytics"
  | "ads.gam"
  | "ads.banner"
  | "ads.interstitial"
  | "notifications"
  | "session.reset";
export type MobileMethod =
  | "runtime.configure"
  | "privacy.request"
  | "privacy.options"
  | "analytics.consent"
  | "analytics.event"
  | "analytics.user"
  | "ads.banner"
  | "ads.hideBanner"
  | "ads.interstitial"
  | "notifications.request"
  | "notifications.token"
  | "session.reset";
export type MobileEventName =
  | "screen_view"
  | "video_start"
  | "video_progress"
  | "video_complete"
  | "clip_view"
  | "search"
  | "follow"
  | "share"
  | "upload_started"
  | "upload_resumed"
  | "upload_completed"
  | "upload_failed";
export interface MobileInfo {
  platform: "android" | "ios";
  appVersion: string;
  installationId: string;
  boundAccountId?: string | null;
  runtimeAllowed?: boolean;
  upgradeRequired?: boolean;
  configured: { firebase: boolean; ads: boolean };
}
export interface MobileNativeEvent {
  type: string;
  token?: string;
  recipientAccountId?: string;
  route?: string;
  notificationId?: string;
  state?: string;
  canRequestAds?: boolean;
  privacyOptionsRequired?: boolean;
}
declare global {
  interface Window {
    AyinMobile?: {
      version: number;
      capabilities: string[];
      request(message: { id: string; method: string; params: Record<string, unknown> }): void;
    };
  }
  interface WindowEventMap {
    "ayin:mobile-response": CustomEvent<{
      id: string;
      ok: boolean;
      result?: unknown;
      error?: unknown;
    }>;
    "ayin:mobile-event": CustomEvent<MobileNativeEvent>;
    "ayin:mobile-ready": Event;
  }
}
export function isMobileHost(): boolean {
  if (typeof window === "undefined" || window.self !== window.top) return false;
  return Boolean(
    window.AyinMobile &&
    window.AyinMobile.version === 1 &&
    typeof window.AyinMobile.request === "function" &&
    Array.isArray(window.AyinMobile.capabilities),
  );
}
export function supportsMobile(capability: MobileCapability): boolean {
  return isMobileHost() && window.AyinMobile!.capabilities.includes(capability);
}
function requiredCapability(method: MobileMethod): MobileCapability | null {
  if (method === "runtime.configure") return null;
  if (method.startsWith("analytics.")) return "analytics";
  if (method.startsWith("privacy.")) return "privacy";
  if (method.startsWith("notifications.")) return "notifications";
  return method === "ads.hideBanner" ? "ads.banner" : (method as MobileCapability);
}
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const only = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
export function validMobileAnalytics(name: unknown, params: unknown): boolean {
  if (!object(params)) return false;
  const finite = (key: string, min: number, max: number) =>
    typeof params[key] === "number" &&
    Number.isFinite(params[key]) &&
    (params[key] as number) >= min &&
    (params[key] as number) <= max;
  if (name === "screen_view")
    return (
      only(params, ["screen_name"]) &&
      ["home", "watch", "clips", "search", "channel", "account", "upload", "other"].includes(
        String(params.screen_name),
      )
    );
  if (["video_start", "video_complete", "clip_view", "share"].includes(String(name)))
    return (
      only(params, ["content_type"]) && ["video", "clip"].includes(String(params.content_type))
    );
  if (name === "video_progress")
    return (
      only(params, ["content_type", "position_seconds"]) &&
      params.content_type === "video" &&
      finite("position_seconds", 0, 86400)
    );
  if (name === "search") return only(params, ["query_length"]) && finite("query_length", 0, 200);
  if (name === "follow") return Object.keys(params).length === 0;
  if (
    ["upload_started", "upload_resumed", "upload_completed", "upload_failed"].includes(String(name))
  )
    return (
      only(params, ["size_bucket"]) &&
      ["small", "medium", "large", "unknown"].includes(String(params.size_bucket))
    );
  return false;
}
export function validMobileRequest(method: MobileMethod, params: Record<string, unknown>): boolean {
  if (!object(params)) return false;
  switch (method) {
    case "runtime.configure":
      return (
        only(params, ["config"]) &&
        object(params.config) &&
        params.config.schemaVersion === 1 &&
        params.config.bridgeVersion === 1
      );
    case "privacy.request":
      return only(params, ["underAgeOfConsent"]) && typeof params.underAgeOfConsent === "boolean";
    case "notifications.request":
    case "notifications.token":
      return (
        only(params, ["accountId"]) &&
        typeof params.accountId === "string" &&
        /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(params.accountId)
      );
    case "analytics.consent":
      return only(params, ["enabled"]) && typeof params.enabled === "boolean";
    case "analytics.event":
      return only(params, ["name", "params"]) && validMobileAnalytics(params.name, params.params);
    case "analytics.user":
      return (
        only(params, ["id"]) &&
        (params.id === null ||
          (typeof params.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(params.id)))
      );
    case "ads.banner":
    case "ads.interstitial":
      return (
        only(
          params,
          method === "ads.banner" ? ["placement"] : ["placement", "naturalTransition"],
        ) &&
        typeof params.placement === "string" &&
        /^[a-z][a-z0-9_]{0,39}$/.test(params.placement) &&
        (method !== "ads.interstitial" || params.naturalTransition === true)
      );
    default:
      return (
        [
          "privacy.options",
          "ads.hideBanner",
          "notifications.request",
          "notifications.token",
          "session.reset",
        ].includes(method) && Object.keys(params).length === 0
      );
  }
}
/** Resolves null when unsupported; rejects finite timeouts/errors. No queue survives navigation. */
export function requestMobile<T = unknown>(
  method: MobileMethod,
  params: Record<string, unknown> = {},
  timeoutMs = 15000,
): Promise<T | null> {
  const capability = requiredCapability(method);
  if (!isMobileHost() || (capability && !supportsMobile(capability))) return Promise.resolve(null);
  if (!validMobileRequest(method, params))
    return Promise.reject(new Error("MOBILE_INVALID_PARAMS"));
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("ayin:mobile-response", receive);
      window.removeEventListener("pagehide", cancel);
    };
    const cancel = () => {
      cleanup();
      reject(new Error("MOBILE_INTERRUPTED"));
    };
    const receive = (event: WindowEventMap["ayin:mobile-response"]) => {
      const detail = event.detail;
      if (!object(detail) || detail.id !== id || typeof detail.ok !== "boolean") return;
      cleanup();
      if (detail.ok) resolve(detail.result as T);
      else reject(new Error("MOBILE_REQUEST_FAILED"));
    };
    const timer = setTimeout(
      () => {
        cleanup();
        reject(new Error("MOBILE_TIMEOUT"));
      },
      Math.max(1000, Math.min(timeoutMs, 120000)),
    );
    window.addEventListener("ayin:mobile-response", receive);
    window.addEventListener("pagehide", cancel, { once: true });
    try {
      window.AyinMobile!.request({ id, method, params });
    } catch {
      cleanup();
      reject(new Error("MOBILE_UNAVAILABLE"));
    }
  });
}
export function mobileNotificationRoute(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 200 || /[\\?#%\s]/.test(value)) return null;
  return /^\/(?:notifications|(?:watch|c)\/[a-zA-Z0-9_.~-]{1,180})$/.test(value) ? value : null;
}
export function mobileScreenName(path: string): string {
  const route = path.replace(/^\/(ar|en)(?=\/|$)/, "") || "/";
  if (route === "/") return "home";
  if (route.startsWith("/c/")) return "channel";
  const name = route.split("/")[1];
  return ["watch", "clips", "search", "channel", "account", "upload"].includes(name ?? "")
    ? name!
    : "other";
}
