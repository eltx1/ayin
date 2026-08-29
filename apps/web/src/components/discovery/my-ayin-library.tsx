"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchMyAyin, getIdentity, type MyAyinResponse } from "@/lib/discovery";

import { DiscoverySkeleton } from "./discovery-home";
import { DiscoveryRow } from "./discovery-row";
import styles from "./discovery.module.css";

export function MyAyinLibrary() {
  const [library, setLibrary] = useState<MyAyinResponse | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const identity = await getIdentity(controller.signal);
        if (controller.signal.aborted) return;
        if (!identity) {
          setSignedIn(false);
          return;
        }
        setSignedIn(true);
        const response = await fetchMyAyin(controller.signal);
        if (!controller.signal.aborted) setLibrary(response);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Could not load My AYIN.");
        }
      }
    })();
    return () => controller.abort();
  }, []);

  if (signedIn === false) {
    return (
      <div className={styles.authState}>
        <strong>Sign in to open My AYIN.</strong> Your Continue Watching, Watch Later, history,
        likes and playlists stay tied to your viewer profile. <Link href="/login">Sign in</Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.authState} role="alert">
        {error}
      </div>
    );
  }

  if (!library) return <DiscoverySkeleton />;

  return (
    <div className={styles.rows}>
      {library.sections.map((section) => (
        <DiscoveryRow authenticated key={section.key} row={section} scope="my-ayin" />
      ))}
    </div>
  );
}
