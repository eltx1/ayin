"use client";

import { isMobileHost } from "@/lib/mobile-bridge";
import { webAdvertisingAllowed } from "@/lib/mobile-web-ads";
import { subscribeMobile } from "@/lib/mobile-runtime";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import {
  createAdvertisingConsentScope,
  getAdvertisingConsentSnapshot,
  type AdvertisingConsentSnapshot,
} from "@/lib/advertising-consent";
import { useAdvertisingConsent } from "@/lib/use-advertising-consent";
import { GptRuntimeError, mountGooglePublisherTagSlot } from "@/lib/google-gpt-page-ad-service";
import { stripLocalePrefix } from "@/lib/i18n/routing";
import { pageAdsSuppressed, subscribePageAdSuppression } from "@/lib/page-ad-suppression";
import {
  detectPageAdDevice,
  fetchPageAdDecision,
  getPageAdSessionId,
  type HousePageAdDemand,
  pageAdFrameUrl,
  recordPageAdEvent,
  subscribePageAdDevice,
  type PageAdDevice,
} from "@/lib/page-ads";

import styles from "./page-ad-slot.module.css";

const anchorDismissedKey = "ayin.pageAds.anchorDismissed";

function anchorDismissed() {
  try {
    return sessionStorage.getItem(anchorDismissedKey) === "1";
  } catch {
    return false;
  }
}

/**
 * "anchor" pins the slot to the bottom of a phone screen above the navigation bar, with a close
 * button that hides it for the rest of the visit. It is never shown inside the native apps,
 * whose own banner already uses that space.
 */
export function PageAdSlot({
  placementKey,
  variant = "inline",
}: {
  placementKey: string;
  variant?: "inline" | "anchor";
}) {
  const [dismissed, setDismissed] = useState(false);
  const [anchorVisible, setAnchorVisible] = useState(false);
  const pathname = usePathname();
  const consent = useAdvertisingConsent();
  const device = useSyncExternalStore(subscribePageAdDevice, detectPageAdDevice, () => null);
  const webAdsAllowed = useSyncExternalStore(
    subscribeMobile,
    () => webAdvertisingAllowed("page"),
    () => true,
  );
  const suppressed = useSyncExternalStore(
    subscribePageAdSuppression,
    pageAdsSuppressed,
    () => true,
  );
  if (!webAdsAllowed || suppressed) return null;
  if (!device || !pathname) return <div className={styles.probe} aria-hidden="true" />;
  // Placements match unlocalized routes ("/", "/watch/*"); "/ar/..." must match them too.
  const route = stripLocalePrefix(pathname);
  const session = (
    <PageAdSlotSession
      key={JSON.stringify([placementKey, route, device, consent])}
      placementKey={placementKey}
      route={route}
      device={device}
      consent={consent}
      {...(variant === "anchor" ? { onVisibleChange: setAnchorVisible } : {})}
    />
  );
  if (variant === "inline") return session;
  if (dismissed || device !== "MOBILE" || isMobileHost() || anchorDismissed()) return null;
  return (
    <>
      {/* Keeps the end of the page reachable above the pinned banner. */}
      <div aria-hidden="true" className={styles.anchorSpacer} data-visible={anchorVisible} />
      <div className={styles.anchor} data-visible={anchorVisible}>
        {session}
        {anchorVisible ? (
          <button
            type="button"
            className={styles.anchorClose}
            aria-label="Close advertisement"
            onClick={() => {
              try {
                sessionStorage.setItem(anchorDismissedKey, "1");
              } catch {
                // The banner still closes for this page view without storage.
              }
              setDismissed(true);
            }}
          >
            ×
          </button>
        ) : null}
      </div>
    </>
  );
}

function PageAdSlotSession({
  placementKey,
  route,
  device,
  consent,
  onVisibleChange,
}: {
  placementKey: string;
  route: string;
  device: PageAdDevice;
  consent: AdvertisingConsentSnapshot;
  onVisibleChange?: (visible: boolean) => void;
}) {
  const reactId = useId();
  const divId = `ayin-ad-${reactId.replaceAll(":", "")}`;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gptRef = useRef<HTMLDivElement | null>(null);
  const [house, setHouse] = useState<HousePageAdDemand | null>(null);
  const [showGpt, setShowGpt] = useState(false);
  const [frame, setFrame] = useState<{ url: string; fixedHeight: number | null } | null>(null);
  const [frameHeight, setFrameHeight] = useState(0);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!frame) return;
    const onMessage = (event: MessageEvent) => {
      const source = frameRef.current?.contentWindow;
      if (!source || event.source !== source) return;
      const data = event.data as { type?: unknown; height?: unknown } | null;
      if (data?.type !== "ayin-ad-frame-size" || typeof data.height !== "number") return;
      if (!Number.isFinite(data.height)) return;
      setFrameHeight(Math.max(0, Math.min(1200, Math.ceil(data.height))));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame]);

  useEffect(() => {
    const controller = new AbortController();
    const consentScope = createAdvertisingConsentScope(consent);
    const conceal = () => {
      if (hostRef.current) hostRef.current.hidden = true;
      controller.abort();
      gptRef.current?.replaceChildren();
    };
    consentScope.signal.addEventListener("abort", conceal, { once: true });
    if (consentScope.signal.aborted) controller.abort();
    else if (hostRef.current) hostRef.current.hidden = false;
    let cleanupGpt: (() => void) | null = null;
    let started = false;
    let active = true;
    const isActive = () => active && consentScope.isCurrent() && webAdvertisingAllowed("page");
    const requestId = crypto.randomUUID();
    const sessionId = getPageAdSessionId();

    const showHouseFallback = async (fallback: HousePageAdDemand | null) => {
      if (!fallback || !isActive()) return;
      setHouse(fallback);
      await recordPageAdEvent({
        key: placementKey,
        eventType: "IMPRESSION",
        requestId,
        sessionId,
        provider: "HOUSE",
      });
    };

    const start = async () => {
      if (started || !isActive()) return;
      started = true;
      const decision = await fetchPageAdDecision(placementKey, route, device, controller.signal);
      if (!isActive() || !decision.enabled) return;

      await recordPageAdEvent({
        key: placementKey,
        eventType: "REQUEST",
        requestId,
        sessionId,
        provider: decision.demand.provider,
      });
      if (!isActive()) return;

      if (decision.demand.provider === "CODE") {
        setFrame({
          url: pageAdFrameUrl(placementKey, decision.demand.version),
          fixedHeight: decision.demand.height,
        });
        await recordPageAdEvent({
          key: placementKey,
          eventType: "IMPRESSION",
          requestId,
          sessionId,
          provider: "CODE",
        });
        return;
      }

      if (decision.demand.provider === "HOUSE") {
        setHouse(decision.demand);
        await recordPageAdEvent({
          key: placementKey,
          eventType: "IMPRESSION",
          requestId,
          sessionId,
          provider: "HOUSE",
        });
        return;
      }

      setShowGpt(true);
      try {
        cleanupGpt = await mountGooglePublisherTagSlot({
          divId,
          adUnitPath: decision.demand.adUnitPath,
          sizes: decision.sizes,
          responsive: decision.responsive,
          consent,
          signal: controller.signal,
          onRender: (filled) => {
            if (!isActive()) return;
            if (filled) {
              void recordPageAdEvent({
                key: placementKey,
                eventType: "FILL",
                requestId,
                sessionId,
                provider: "GOOGLE_GPT",
              });
              void recordPageAdEvent({
                key: placementKey,
                eventType: "IMPRESSION",
                requestId,
                sessionId,
                provider: "GOOGLE_GPT",
              });
              return;
            }

            // Google documents that slotRenderEnded(isEmpty=true) can represent either
            // legitimate no-fill or a network failure, so AYIN deliberately keeps it ambiguous.
            void recordPageAdEvent({
              key: placementKey,
              eventType: "ERROR",
              requestId,
              sessionId,
              provider: "GOOGLE_GPT",
              errorCode: "GPT_EMPTY_OR_NETWORK_FAILURE",
            });
            setShowGpt(false);
            void showHouseFallback(decision.fallback);
          },
        });
        if (!isActive()) cleanupGpt();
      } catch (error) {
        if (!isActive()) return;
        setShowGpt(false);
        const errorCode =
          error instanceof GptRuntimeError ? error.diagnosticCode : "GPT_RUNTIME_FAILURE";
        void recordPageAdEvent({
          key: placementKey,
          eventType: "ERROR",
          requestId,
          sessionId,
          provider: "GOOGLE_GPT",
          errorCode,
        });
        await showHouseFallback(decision.fallback);
      }
    };

    const host = hostRef.current;
    if (!host || !("IntersectionObserver" in window)) {
      void start().catch(() => undefined);
    } else {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer.disconnect();
            void start().catch(() => undefined);
          }
        },
        { rootMargin: "400px 0px" },
      );
      observer.observe(host);
      return () => {
        active = false;
        consentScope.release();
        controller.abort();
        observer.disconnect();
        cleanupGpt?.();
      };
    }

    return () => {
      active = false;
      consentScope.release();
      controller.abort();
      cleanupGpt?.();
    };
  }, [consent, device, divId, placementKey, route]);

  const renderedFrameHeight = frame ? (frame.fixedHeight ?? frameHeight) : 0;
  const visible = Boolean(house || showGpt || renderedFrameHeight > 0);
  useEffect(() => {
    onVisibleChange?.(visible);
  }, [onVisibleChange, visible]);
  useEffect(() => () => onVisibleChange?.(false), [onVisibleChange]);
  return (
    <aside
      className={visible || frame ? styles.slot : styles.probe}
      data-ad-slot={placementKey}
      data-collapsed={frame && !visible ? "true" : undefined}
      ref={hostRef}
      aria-label={visible ? "Advertisement" : undefined}
      aria-hidden={!visible}
    >
      {visible ? <span className={styles.label}>Advertisement</span> : null}
      {frame ? (
        <iframe
          ref={frameRef}
          className={styles.frame}
          src={frame.url}
          title="Advertisement"
          referrerPolicy="strict-origin-when-cross-origin"
          // No allow-same-origin: the ad runs in an opaque origin, isolated from AYIN.
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"
          scrolling="no"
          style={{ height: `${renderedFrameHeight}px` }}
        />
      ) : null}
      {house ? (
        house.clickUrl ? (
          <a
            className={styles.house}
            href={house.clickUrl}
            rel="noopener noreferrer sponsored"
            target="_blank"
            onClick={(event) => {
              if (getAdvertisingConsentSnapshot() !== consent) {
                event.preventDefault();
                return;
              }
              void recordPageAdEvent({
                key: placementKey,
                eventType: "CLICK",
                requestId: crypto.randomUUID(),
                sessionId: getPageAdSessionId(),
                provider: "HOUSE",
              });
            }}
          >
            <span
              className={styles.houseCreative}
              role="img"
              aria-label={house.altText}
              style={{ backgroundImage: `url(${JSON.stringify(house.imageUrl)})` }}
            />
          </a>
        ) : (
          <span
            className={styles.houseCreative}
            role="img"
            aria-label={house.altText}
            style={{ backgroundImage: `url(${JSON.stringify(house.imageUrl)})` }}
          />
        )
      ) : null}
      <div className={showGpt ? styles.gpt : styles.hidden} id={divId} ref={gptRef} />
    </aside>
  );
}
