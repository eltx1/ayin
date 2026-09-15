"use client";

import { useEffect, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { MediaCardSkeleton } from "@/components/viewer/media-card";
import {
  fetchDiscoveryHome,
  fetchKidsDiscoveryHome,
  getIdentity,
  type DiscoveryHomeResponse,
} from "@/lib/discovery";

import { DiscoveryRow } from "./discovery-row";
import styles from "./discovery.module.css";

export function DiscoveryHome({ kidsMode = false }: { kidsMode?: boolean }) {
  const { t } = useI18n();
  const [home, setHome] = useState<DiscoveryHomeResponse | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const identity = kidsMode ? null : await getIdentity(controller.signal);
        const signedIn = Boolean(identity);
        if (!controller.signal.aborted) setAuthenticated(signedIn);
        const response = kidsMode
          ? await fetchKidsDiscoveryHome(controller.signal)
          : await fetchDiscoveryHome(signedIn, controller.signal);
        if (!controller.signal.aborted) setHome(response);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : t("home.loadError"));
        }
      }
    })();
    return () => controller.abort();
  }, [kidsMode, t]);

  if (error) {
    return (
      <section className={styles.authState} dir="auto" role="alert">
        {error}
      </section>
    );
  }

  if (!home) return <DiscoverySkeleton />;

  return (
    <div className={styles.rows}>
      {home.rows.map((row) => (
        <DiscoveryRow authenticated={authenticated} key={row.key} row={row} />
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
