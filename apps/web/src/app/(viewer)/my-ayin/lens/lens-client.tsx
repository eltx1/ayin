"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { trackAnalyticsEvent } from "@/lib/analytics";
import { apiBaseUrl } from "@/lib/api";

import styles from "./lens.module.css";

interface LensItem {
  id: string;
  slug: string;
  title: string;
  channelId: string;
  channelHandle: string;
  channelName: string;
  score: number;
  reason: { code: string; label: string };
}

interface LensResponse {
  profileId: string;
  mode: "HEURISTIC_V1" | "SAFE_FALLBACK";
  algorithm: string;
  items: LensItem[];
}

export function AyinLensClient() {
  const [data, setData] = useState<LensResponse | null>(null);
  const [status, setStatus] = useState("Loading recommendations…");

  async function load() {
    const response = await fetch(`${apiBaseUrl}/recommendations/home?limit=18`, {
      credentials: "include",
      cache: "no-store",
    });
    if (response.status === 401 || response.status === 403) {
      setStatus("Sign in to inspect your AYIN Lens recommendations.");
      setData(null);
      return;
    }
    if (!response.ok) {
      setStatus("Recommendations are temporarily unavailable.");
      setData(null);
      return;
    }
    const next = (await response.json()) as LensResponse;
    setData(next);
    setStatus(next.items.length ? "" : "No eligible recommendations yet.");
    trackAnalyticsEvent("LENS_OPEN", { profileId: next.profileId });
    for (const item of next.items) {
      trackAnalyticsEvent("RECOMMENDATION_IMPRESSION", {
        profileId: next.profileId,
        videoId: item.id,
        channelId: item.channelId,
        metadata: { reason: item.reason.code, algorithm: next.algorithm },
      });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function notInterested(item: LensItem) {
    if (!data) return;
    const response = await fetch(`${apiBaseUrl}/recommendations/not-interested`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profileId: data.profileId, videoId: item.id }),
    });
    if (!response.ok) return;
    trackAnalyticsEvent("LENS_NOT_INTERESTED", {
      profileId: data.profileId,
      videoId: item.id,
      channelId: item.channelId,
    });
    setData({ ...data, items: data.items.filter((candidate) => candidate.id !== item.id) });
  }

  async function reset() {
    if (!data) return;
    const response = await fetch(`${apiBaseUrl}/recommendations/reset`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profileId: data.profileId }),
    });
    if (!response.ok) return;
    trackAnalyticsEvent("LENS_DISMISS", {
      profileId: data.profileId,
      metadata: { action: "reset_personalization" },
    });
    await load();
  }

  return (
    <section className={styles.panel} aria-live="polite">
      <div className={styles.toolbar}>
        <div>
          <strong>{data?.mode === "HEURISTIC_V1" ? "Personalized V1" : "Safe fallback"}</strong>
          <p>AYIN uses explainable weighted signals here; this is not presented as machine learning.</p>
        </div>
        <button type="button" onClick={() => void reset()} disabled={!data}>
          Reset personalization
        </button>
      </div>

      {status ? <p className={styles.status}>{status}</p> : null}
      <div className={styles.grid}>
        {data?.items.map((item) => (
          <article className={styles.card} key={item.id}>
            <p className={styles.reason}>{item.reason.label}</p>
            <h2>{item.title}</h2>
            <p>
              <Link href={`/c/${item.channelHandle}`}>{item.channelName}</Link>
            </p>
            <div className={styles.actions}>
              <Link
                href={`/watch/${item.slug}`}
                onClick={() =>
                  trackAnalyticsEvent("RECOMMENDATION_CLICK", {
                    profileId: data.profileId,
                    videoId: item.id,
                    channelId: item.channelId,
                    metadata: { reason: item.reason.code },
                  })
                }
              >
                Watch
              </Link>
              <button type="button" onClick={() => void notInterested(item)}>
                Not interested
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
