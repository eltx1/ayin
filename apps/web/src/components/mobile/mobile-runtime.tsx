"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { apiBaseUrl } from "@/lib/api";
import {
  isMobileHost,
  mobileNotificationRoute,
  mobileScreenName,
  requestMobile,
} from "@/lib/mobile-bridge";
import {
  getMobileAccountId,
  getMobileServerState,
  getMobileState,
  initializeMobile,
  nativeBannerEnabled,
  refreshMobileAccount,
  registerMobileTokenEvent,
  currentMobileRecipient,
  subscribeMobile,
  trackMobileEvent,
  updateMobilePrivacy,
} from "@/lib/mobile-runtime";
export function MobileRuntime() {
  const pathname = usePathname(),
    router = useRouter();
  const state = useSyncExternalStore(subscribeMobile, getMobileState, getMobileServerState);
  const lastScreen = useRef<string | null>(null);
  const initialized = useRef(false);
  const bootstrap = useRef<Promise<void> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const boot = () => {
      if (initialized.current || !isMobileHost()) return;
      initialized.current = true;
      bootstrap.current = initializeMobile(controller.signal);
    };
    boot();
    window.addEventListener("ayin:mobile-ready", boot);
    const nativeEvent = (event: WindowEventMap["ayin:mobile-event"]) => {
      if (!isMobileHost() || !event.detail || typeof event.detail.type !== "string") return;
      const detail = event.detail;
      if (
        detail.type === "notification.token" &&
        typeof detail.token === "string" &&
        currentMobileRecipient(detail.recipientAccountId)
      )
        void registerMobileTokenEvent(detail.recipientAccountId, detail.token).catch(
          () => undefined,
        );
      if (detail.type === "privacy.changed" && typeof detail.canRequestAds === "boolean")
        updateMobilePrivacy(detail.canRequestAds);
      if (
        detail.type === "notification.opened" &&
        typeof detail.notificationId === "string" &&
        /^[0-9a-f-]{36}$/i.test(detail.notificationId)
      ) {
        // Resolve the owned notification server-side after the current session is known.
        void (bootstrap.current ?? Promise.resolve())
          .then(() => refreshMobileAccount(controller.signal))
          .then(async () => {
            if (detail.recipientAccountId !== getMobileAccountId() || !getMobileAccountId()) return;
            const response = await fetch(
              apiBaseUrl + "/mobile/notifications/" + detail.notificationId + "/destination",
              {
                credentials: "include",
                cache: "no-store",
                signal: controller.signal,
                headers: { "x-ayin-expected-account": getMobileAccountId()! },
              },
            );
            if (controller.signal.aborted || !currentMobileRecipient(detail.recipientAccountId))
              return;
            const value: unknown = response.ok ? await response.json() : null;
            const route =
              value && typeof value === "object" && "path" in value
                ? mobileNotificationRoute(value.path)
                : null;
            router.push(route ?? "/notifications");
          })
          .catch(() => undefined);
      }
    };
    const resume = () => {
      if (document.visibilityState === "visible") void refreshMobileAccount(controller.signal);
    };
    window.addEventListener("ayin:mobile-event", nativeEvent);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      controller.abort();
      initialized.current = false;
      window.removeEventListener("ayin:mobile-ready", boot);
      window.removeEventListener("ayin:mobile-event", nativeEvent);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [router]);
  useEffect(() => {
    if (!pathname || !state.ready) return;
    const controller = new AbortController();
    void refreshMobileAccount(controller.signal).then(() => {
      if (controller.signal.aborted) return;
      const key = `${getMobileAccountId() ?? "guest"}:${pathname}`;
      if (!getMobileState().analyticsConsent) {
        lastScreen.current = null;
        return;
      }
      if (lastScreen.current === key) return;
      // Route names only: no titles, IDs, URLs, search text or query parameters reach Firebase.
      trackMobileEvent("screen_view", { screen_name: mobileScreenName(pathname) });
      lastScreen.current = key;
    });
    return () => controller.abort();
  }, [pathname, state.ready, state.analyticsConsent]);
  useEffect(() => {
    if (!state.ready) return;
    const screen = mobileScreenName(pathname ?? "");
    const suitable = ["home", "search", "channel"].includes(screen);
    if (suitable && nativeBannerEnabled() && state.canRequestAds)
      void requestMobile("ads.banner", { placement: "browse_bottom" }).catch(() => undefined);
    else void requestMobile("ads.hideBanner").catch(() => undefined);
    return () => {
      void requestMobile("ads.hideBanner").catch(() => undefined);
    };
  }, [pathname, state.ready, state.canRequestAds, state.config]);
  return null;
}
