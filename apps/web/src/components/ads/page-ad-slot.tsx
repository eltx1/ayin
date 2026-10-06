"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import {
  createAdvertisingConsentScope,
  getAdvertisingConsentSnapshot,
  type AdvertisingConsentSnapshot,
} from "@/lib/advertising-consent";
import { useAdvertisingConsent } from "@/lib/use-advertising-consent";
import { GptRuntimeError, mountGooglePublisherTagSlot } from "@/lib/google-gpt-page-ad-service";
import {
  detectPageAdDevice,
  fetchPageAdDecision,
  getPageAdSessionId,
  type HousePageAdDemand,
  recordPageAdEvent,
  subscribePageAdDevice,
  type PageAdDevice,
} from "@/lib/page-ads";

import styles from "./page-ad-slot.module.css";

export function PageAdSlot({ placementKey }: { placementKey: string }) {
  const pathname = usePathname();
  const consent = useAdvertisingConsent();
  const device = useSyncExternalStore(subscribePageAdDevice, detectPageAdDevice, () => null);
  if (!device || !pathname) return <div className={styles.probe} aria-hidden="true" />;
  return (
    <PageAdSlotSession
      key={JSON.stringify([placementKey, pathname, device, consent])}
      placementKey={placementKey}
      route={pathname}
      device={device}
      consent={consent}
    />
  );
}

function PageAdSlotSession({
  placementKey,
  route,
  device,
  consent,
}: {
  placementKey: string;
  route: string;
  device: PageAdDevice;
  consent: AdvertisingConsentSnapshot;
}) {
  const reactId = useId();
  const divId = `ayin-ad-${reactId.replaceAll(":", "")}`;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const gptRef = useRef<HTMLDivElement | null>(null);
  const [house, setHouse] = useState<HousePageAdDemand | null>(null);
  const [showGpt, setShowGpt] = useState(false);

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
    const isActive = () => active && consentScope.isCurrent();
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

  const visible = Boolean(house || showGpt);
  return (
    <aside
      className={visible ? styles.slot : styles.probe}
      ref={hostRef}
      aria-label={visible ? "Advertisement" : undefined}
      aria-hidden={!visible}
    >
      {visible ? <span className={styles.label}>Advertisement</span> : null}
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
