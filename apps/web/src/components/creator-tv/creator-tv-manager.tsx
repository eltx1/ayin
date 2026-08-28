"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiBaseUrl, type AyinIdentity } from "@/lib/api";
import {
  getCreatorTvManagement,
  type CreatorTvManagementResponse,
  updateCreatorTvVideoPreference,
} from "@/lib/creator-tv";

import styles from "./creator-tv.module.css";

type DraftPreference = {
  included: boolean;
  priority: string;
  sortOrder: string;
};

export function CreatorTvManager() {
  const [data, setData] = useState<CreatorTvManagementResponse | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftPreference>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const identityResponse = await fetch(`${apiBaseUrl}/auth/me`, {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!identityResponse.ok) throw new Error("Sign in to manage Creator TV.");
        const identity = (await identityResponse.json()) as AyinIdentity;
        const management = await getCreatorTvManagement(identity.channel.id);
        if (controller.signal.aborted) return;
        setData(management);
        setDrafts(
          Object.fromEntries(
            management.videos.map((video) => [
              video.id,
              {
                included: video.included,
                priority: String(video.priority),
                sortOrder: video.sortOrder === null ? "" : String(video.sortOrder),
              },
            ]),
          ),
        );
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "Creator TV could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  async function save(videoId: string) {
    if (!data) return;
    const draft = drafts[videoId];
    if (!draft) return;

    const priority = Number(draft.priority);
    const sortOrder = draft.sortOrder.trim() === "" ? null : Number(draft.sortOrder);
    if (!Number.isInteger(priority) || (sortOrder !== null && !Number.isInteger(sortOrder))) {
      setError("Priority and order must be whole numbers.");
      return;
    }

    setSavingId(videoId);
    setError(null);
    setMessage(null);
    try {
      await updateCreatorTvVideoPreference(data.tv.id, videoId, {
        included: draft.included,
        priority,
        sortOrder,
      });
      const refreshed = await getCreatorTvManagement(data.channel.id);
      setData(refreshed);
      setMessage("Creator TV rotation updated.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The TV preference could not be saved.");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return <main className={styles.manager}>Loading Creator TV…</main>;
  }
  if (error && !data) {
    return (
      <main className={styles.manager}>
        <p className={styles.error}>{error}</p>
        <Link className={styles.backLink} href="/">
          Back to AYIN
        </Link>
      </main>
    );
  }
  if (!data) return null;

  return (
    <main className={styles.manager}>
      <header className={styles.managerHeader}>
        <div>
          <span className={styles.eyebrow}>Automatic Creator TV</span>
          <h1>{data.tv.name}</h1>
          <p className={styles.muted}>
            New eligible public MP4 uploads enter rotation automatically. These controls are optional.
          </p>
        </div>
        <Link className={styles.backLink} href={`/c/${encodeURIComponent(data.channel.handle)}/tv`}>
          Watch TV
        </Link>
      </header>

      <section className={styles.managerCard}>
        <h2>Automatic programming</h2>
        <div className={styles.automationGrid}>
          <div className={styles.automationItem}>
            <strong>Platform</strong>
            <span>{data.automation.platformEnabled ? "Automatic TV enabled" : "Paused by AYIN"}</span>
          </div>
          <div className={styles.automationItem}>
            <strong>Channel</strong>
            <span>{data.automation.channelScheduleEnabled ? "Schedule active" : "Schedule paused"}</span>
          </div>
          <div className={styles.automationItem}>
            <strong>Guide</strong>
            <span>{data.automation.guideWindowMinutes} minute rolling window</span>
          </div>
        </div>
        <p className={styles.muted}>
          Higher priority plays first. Order is an optional tie-breaker; leave it blank to use AYIN's deterministic fallback order.
        </p>
      </section>

      <section aria-labelledby="tv-library-heading">
        <div className={styles.managerHeader}>
          <div>
            <h2 id="tv-library-heading">TV library</h2>
            <p className={styles.muted}>{data.videos.length} eligible published MP4 videos</p>
          </div>
        </div>

        {data.videos.length === 0 ? (
          <div className={styles.managerCard}>
            <p className={styles.muted}>
              Publish a public MP4 and it will appear here automatically. No manual TV scheduling is required.
            </p>
          </div>
        ) : (
          <div className={styles.videoList}>
            {data.videos.map((video) => {
              const draft = drafts[video.id] ?? {
                included: video.included,
                priority: String(video.priority),
                sortOrder: video.sortOrder === null ? "" : String(video.sortOrder),
              };
              return (
                <article className={styles.videoRow} key={video.id}>
                  <div>
                    <strong>{video.title}</strong>
                    <p className={styles.videoMeta}>
                      {formatDuration(video.effectiveDurationMs)} · {video.durationMs ? "measured duration" : "guide fallback duration"}
                    </p>
                  </div>
                  <label className={styles.includeControl}>
                    <input
                      checked={draft.included}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [video.id]: { ...draft, included: event.target.checked },
                        }))
                      }
                      type="checkbox"
                    />
                    Include
                  </label>
                  <label>
                    Priority
                    <input
                      max={100000}
                      min={-100000}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [video.id]: { ...draft, priority: event.target.value },
                        }))
                      }
                      type="number"
                      value={draft.priority}
                    />
                  </label>
                  <label>
                    Order
                    <input
                      max={1000000}
                      min={0}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [video.id]: { ...draft, sortOrder: event.target.value },
                        }))
                      }
                      placeholder="Auto"
                      type="number"
                      value={draft.sortOrder}
                    />
                  </label>
                  <button
                    className={styles.saveButton}
                    disabled={savingId === video.id}
                    onClick={() => void save(video.id)}
                    type="button"
                  >
                    {savingId === video.id ? "Saving…" : "Save"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {message ? <p className={styles.notice}>{message}</p> : null}
      {error ? <p className={`${styles.notice} ${styles.error}`}>{error}</p> : null}
    </main>
  );
}

function formatDuration(milliseconds: number): string {
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}
