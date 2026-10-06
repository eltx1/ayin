"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { getAdvertisingConsentSnapshot } from "@/lib/advertising-consent";
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
  const device = useSyncExternalStore(subscribePageAdDevice, detectPageAdDevice, () => null);
  if (!device || !pathname) return <div className={styles.probe} aria-hidden="true" />;
  return (
    <PageAdSlotSession
      key={JSON.stringify([placementKey, pathname, device])}
      placementKey={placementKey}
      route={pathname}
      device={device}
    />
  );
}

function PageAdSlotSession({
  placementKey,
  route,
  device,
}: {
  placementKey: string;
  route: string;
  device: PageAdDevice;
}) {
  const reactId = useId();
  const divId = `ayin-ad-${reactId.replaceAll(":", "")}`;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [house, setHouse] = useState<HousePageAdDemand | null>(null);
  const [showGpt, setShowGpt] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let cleanupGpt: (() => void) | null = null;
    let started = false;
    let active = true;
    const requestId = crypto.randomUUID();
    const sessionId = getPageAdSessionId();

    const showHouseFallback = async (fallback: HousePageAdDemand | null) => {
      if (!fallback || !active) return;
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
      if (started) return;
      started = true;
      const decision = await fetchPageAdDecision(placementKey, route, device, controller.signal);
      if (!active || !decision.enabled) return;

      await recordPageAdEvent({
        key: placementKey,
        eventType: "REQUEST",
        requestId,
        sessionId,
        provider: decision.demand.provider,
      });
      if (!active) return;

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
          consent: getAdvertisingConsentSnapshot(),
          signal: controller.signal,
          onRender: (filled) => {
            if (!active) return;
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
        if (!active) cleanupGpt();
      } catch (error) {
        if (!active) return;
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
        controller.abort();
        observer.disconnect();
        cleanupGpt?.();
      };
    }

    return () => {
      active = false;
      controller.abort();
      cleanupGpt?.();
    };
  }, [device, divId, placementKey, route]);

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
            onClick={() => {
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
      <div className={showGpt ? styles.gpt : styles.hidden} id={divId} />
    </aside>
  );
}
