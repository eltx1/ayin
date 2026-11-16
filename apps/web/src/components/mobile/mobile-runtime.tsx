"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { apiBaseUrl } from "@/lib/api";
import {
  isMobileHost,
  mobileNotificationRoute,
  mobileScreenName,
  requestMobile,
  supportsMobile,
} from "@/lib/mobile-bridge";
import { reconcileMobileNavigation } from "@/lib/mobile-navigation-ads";
import { installMobileConfigLifecycle } from "@/lib/mobile-config-lifecycle";
import { installMobileDiagnosticsLifecycle } from "@/lib/mobile-diagnostics";
import {
  getMobileAccountId,
  getMobileServerState,
  getMobileState,
  initializeMobile,
  nativeBannerEnabled,
  mobileIdentityRefreshing,
  mobileRestricted,
  requestBrowseInterstitial,
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
  const previousBrowseRoute = useRef<string | null>(null);
  const initialized = useRef(false);
  const bootstrap = useRef<Promise<void> | null>(null);
  const bootstrapSettled = useRef(false);
  const identityReady = state.ready && !mobileIdentityRefreshing();
  const browse = (route: string) => ["home", "search", "channel"].includes(mobileScreenName(route));
  const bannerEligible = Boolean(
    identityReady && state.canRequestAds && browse(pathname ?? "") && nativeBannerEnabled(),
  );
  useEffect(() => {
    const controller = new AbortController();
    const stopConfigRefresh = installMobileConfigLifecycle(controller.signal);
    const stopDiagnostics = installMobileDiagnosticsLifecycle(controller.signal);
    const boot = () => {
      if (initialized.current || !isMobileHost()) return;
      initialized.current = true;
      bootstrap.current = initializeMobile(controller.signal).finally(() => {
        if (!controller.signal.aborted) bootstrapSettled.current = true;
      });
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
      stopConfigRefresh();
      stopDiagnostics();
      initialized.current = false;
      bootstrapSettled.current = false;
      window.removeEventListener("ayin:mobile-ready", boot);
      window.removeEventListener("ayin:mobile-event", nativeEvent);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [router]);
  useEffect(() => {
    if (!pathname) return;
    const previous = previousBrowseRoute.current;
    previousBrowseRoute.current = pathname;
    if (!state.ready || !isMobileHost()) return;
    const controller = new AbortController();
    void reconcileMobileNavigation(
      previous,
      pathname,
      controller.signal,
      {
        refreshIdentity: (signal) => {
          // Initial bootstrap already reconciles the native binding. Do not race it.
          // Once settled, start reconciliation synchronously so the banner effect in
          // this commit observes the restriction before requesting any native ad.
          if (bootstrapSettled.current) return refreshMobileAccount(signal);
          return (bootstrap.current ?? Promise.resolve()).then(() => {
            if (!signal.aborted) return refreshMobileAccount(signal);
          });
        },
        permission: () => {
          const current = getMobileState();
          return {
            accountId: getMobileAccountId(),
            consentGranted: current.canRequestAds,
            configuration: current.config,
          };
        },
        subscribe: subscribeMobile,
        eligible: () => {
          const current = getMobileState();
          return Boolean(
            current.ready &&
            !mobileIdentityRefreshing() &&
            !mobileRestricted() &&
            current.canRequestAds &&
            supportsMobile("ads.interstitial") &&
            current.info?.configured.ads &&
            current.config?.ads.enabled &&
            current.config.ads.interstitial.enabled &&
            current.config.ads.platforms[current.info.platform].enabled,
          );
        },
        currentRoute: () => window.location.pathname,
        surfaceIdle: () =>
          document.visibilityState === "visible" &&
          document.documentElement.dataset.ayinUploadActive !== "true" &&
          document.documentElement.dataset.ayinWebAdActive !== "true" &&
          !Array.from(document.querySelectorAll<HTMLMediaElement>("video,audio")).some(
            (media) => !media.paused && !media.ended,
          ),
        request: requestBrowseInterstitial,
      },
      { isBrowseRoute: (route) => ["home", "search", "channel"].includes(mobileScreenName(route)) },
    );
    return () => controller.abort();
  }, [pathname, state.ready]);
  useEffect(() => {
    if (!pathname || !identityReady || mobileIdentityRefreshing()) return;
    if (!state.analyticsConsent) {
      lastScreen.current = null;
      return;
    }
    if (mobileRestricted()) return;
    const key = `${getMobileAccountId() ?? "guest"}:${pathname}`;
    if (lastScreen.current === key) return;
    // Route names only: no titles, IDs, URLs, search text or query parameters reach Firebase.
    trackMobileEvent("screen_view", { screen_name: mobileScreenName(pathname) });
    lastScreen.current = key;
  }, [pathname, identityReady, state.analyticsConsent, state.adultAffirmed]);
  useEffect(() => {
    if (!state.ready) return;
    // The preceding route effect can begin a refresh in this same commit. Recheck
    // its transient restriction before issuing SDK work, then retry when it settles.
    if (bannerEligible && !mobileIdentityRefreshing() && nativeBannerEnabled())
      void requestMobile("ads.banner", { placement: "browse_bottom" }).catch(() => undefined);
    else void requestMobile("ads.hideBanner").catch(() => undefined);
    return () => {
      void requestMobile("ads.hideBanner").catch(() => undefined);
    };
  }, [pathname, state.ready, bannerEligible, state.config]);
  return null;
}
