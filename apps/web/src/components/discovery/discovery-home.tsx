"use client";

import { useEffect, useState } from "react";

import { MediaCardSkeleton } from "@/components/viewer/media-card";
import {
  fetchDiscoveryHome,
  getIdentity,
  type DiscoveryHomeResponse,
} from "@/lib/discovery";

import { DiscoveryRow } from "./discovery-row";
import styles from "./discovery.module.css";

export function DiscoveryHome() {
  const [home, setHome] = useState<DiscoveryHomeResponse | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const identity = await getIdentity(controller.signal);
        const signedIn = Boolean(identity);
        if (!controller.signal.aborted) setAuthenticated(signedIn);
        const response = await fetchDiscoveryHome(signedIn, controller.signal);
        if (!controller.signal.aborted) setHome(response);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Could not load AYIN discovery.");
        }
      }
    })();
    return () => controller.abort();
  }, []);

  if (error) {
    return (
      <section className={styles.authState} role="alert">
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
  return (
    <div aria-label="Loading AYIN discovery" className={styles.skeletonRows} role="status">
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
