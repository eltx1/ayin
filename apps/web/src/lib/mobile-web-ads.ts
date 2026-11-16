import { isMobileHost, supportsMobile, requestMobile } from "./mobile-bridge";
import { getMobileState, mobileRestricted, mobileIdentityRefreshing } from "./mobile-runtime";

/** Explicit WebView opt-in, independent of native inventory and UMP consent.
 * GPT/IMA still apply their own browser consent scope; UMP is never copied into it.
 * Older/unregistered shells and failed configuration remain closed.
 */
export function webAdvertisingAllowed(format: "page" | "video"): boolean {
  if (!isMobileHost()) return true;
  const state = getMobileState();
  if (
    !state.ready ||
    mobileIdentityRefreshing() ||
    state.error ||
    !state.info ||
    mobileRestricted() ||
    !supportsMobile("ads.webview")
  )
    return false;
  return (
    state.config?.webViewAds?.[state.info.platform]?.[
      format === "page" ? "pageAdsEnabled" : "videoAdsEnabled"
    ] === true
  );
}

const activeBreaks = new Set<symbol>();
/** Native guards also inspect this marker while IMA has paused the content video. */
export function beginWebAdBreak(): () => void {
  const lease = Symbol();
  activeBreaks.add(lease);
  document.documentElement.dataset.ayinWebAdActive = "true";
  // An already-mounted SDK banner must leave before the web player opens its break.
  void requestMobile("ads.hideBanner").catch(() => undefined);
  return () => {
    activeBreaks.delete(lease);
    if (!activeBreaks.size) delete document.documentElement.dataset.ayinWebAdActive;
  };
}
