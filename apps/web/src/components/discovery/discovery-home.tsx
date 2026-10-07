"use client";

import { useEffect, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { MediaCardSkeleton } from "@/components/viewer/media-card";
import { useViewerProduct } from "@/components/viewer/viewer-product-context";
import { ActionButton } from "@/components/ui/design-system";
import type { AyinIdentity } from "@/lib/api";
import { translatePublicDiscovery } from "@/lib/i18n/public-discovery";
import { sameViewerIdentity, withViewerReadDeadline } from "@/lib/viewer-bootstrap";
import {
  fetchDiscoveryHome,
  fetchKidsDiscoveryHome,
  getIdentity,
  type DiscoveryHomeResponse,
} from "@/lib/discovery";

import { DiscoveryRow } from "./discovery-row";
import styles from "./discovery.module.css";

export function DiscoveryHome({ kidsMode = false }: { kidsMode?: boolean }) {
  const { locale } = useI18n();
  const copy = (key: Parameters<typeof translatePublicDiscovery>[1]) =>
    translatePublicDiscovery(locale, key);
  const {
    bootstrapRevision,
    bootstrapSuspended,
    audienceStatus,
    identity,
    identityRevision,
    isAudienceCurrent,
    retryNavigation,
  } = useViewerProduct();
  const [read, setRead] = useState<{
    revision: number;
    kidsMode: boolean;
    identity: AyinIdentity | null;
    home: DiscoveryHomeResponse | null;
    status: "ready" | "error";
  } | null>(null);

  useEffect(() => {
    if (bootstrapSuspended) return;
    const controller = new AbortController();
    void withViewerReadDeadline(async (readSignal) => {
      const viewer = kidsMode ? null : await getIdentity(readSignal);
      readSignal.throwIfAborted();
      const home = kidsMode
        ? await fetchKidsDiscoveryHome(readSignal)
        : await fetchDiscoveryHome(Boolean(viewer), readSignal);
      if (!Array.isArray(home.rows)) throw new Error("Discovery unavailable");
      return { identity: viewer, home };
    }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted)
          setRead({ ...result, revision: bootstrapRevision, kidsMode, status: "ready" });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setRead({
            revision: bootstrapRevision,
            kidsMode,
            identity: null,
            home: null,
            status: "error",
          });
      });
    return () => controller.abort();
  }, [bootstrapRevision, bootstrapSuspended, kidsMode]);

  const currentRead =
    !bootstrapSuspended && read?.revision === bootstrapRevision && read.kidsMode === kidsMode
      ? read
      : null;
  const unavailable =
    !bootstrapSuspended &&
    (currentRead?.status === "error" ||
      (!kidsMode &&
        (audienceStatus === "error" ||
          (currentRead?.status === "ready" &&
            audienceStatus === "ready" &&
            !sameViewerIdentity(currentRead.identity, identity)))));
  if (unavailable) {
    return (
      <section className={styles.authState} role="alert">
        <p>{copy("home.error")}</p>
        <ActionButton
          data-tv-focus-id="home-discovery-retry"
          data-tv-focusable="true"
          onClick={retryNavigation}
          tone="secondary"
          type="button"
        >
          {copy("home.retry")}
        </ActionButton>
      </section>
    );
  }

  if (!currentRead?.home || (!kidsMode && (audienceStatus !== "ready" || !isAudienceCurrent())))
    return <DiscoverySkeleton />;

  return (
    <div
      className={styles.rows}
      data-private-viewer-state
      key={`${bootstrapRevision}:${identityRevision}:${kidsMode}`}
    >
      {currentRead.home.rows.map((row) => (
        <DiscoveryRow
          authenticated={Boolean(currentRead.identity)}
          kidsMode={kidsMode}
          key={row.key}
          row={row}
        />
      ))}
    </div>
  );
}

export function DiscoverySkeleton() {
  const { t } = useI18n();
  return (
    <div aria-label={t("home.loadingAria")} className={styles.skeletonRows} role="status">
      {Array.from({ length: 3 }, (_, rowIndex) => (
        <div className={styles.skeletonRow} key={`discovery-skeleton-${rowIndex}`}>
          <span className={styles.skeletonTitle} />
          <div className={styles.skeletonCards}>
            {Array.from({ length: 5 }, (_, cardIndex) => (
              <MediaCardSkeleton key={`card-${rowIndex}-${cardIndex}`} variant="poster" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
