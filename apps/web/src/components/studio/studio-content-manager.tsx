"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "@/app/studio/studio.module.css";
import {
  getStudioContent,
  removeStudioVideo,
  type StudioVideo,
  unpublishStudioVideo,
  updateStudioVideo,
} from "@/lib/studio";

type Draft = Pick<
  StudioVideo,
  "title" | "description" | "visibility" | "commentsEnabled" | "tvIncluded"
>;

export function StudioContentManager() {
  const [videos, setVideos] = useState<StudioVideo[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [visibility, setVisibility] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const filters = useMemo(() => ({ query, status, visibility }), [query, status, visibility]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void getStudioContent(filters)
        .then((response) => {
          if (!active) return;
          setVideos(response.videos);
          setDrafts(
            Object.fromEntries(
              response.videos.map((video) => [
                video.id,
                {
                  title: video.title,
                  description: video.description,
                  visibility: video.visibility,
                  commentsEnabled: video.commentsEnabled,
                  tvIncluded: video.tvIncluded,
                },
              ]),
            ),
          );
          setError(null);
        })
        .catch((caught) => {
          if (active)
            setError(caught instanceof Error ? caught.message : "Content could not be loaded.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [filters]);

  async function refresh() {
    const response = await getStudioContent(filters);
    setVideos(response.videos);
  }

  async function save(video: StudioVideo) {
    const draft = drafts[video.id];
    if (!draft) return;
    setBusyId(video.id);
    setMessage(null);
    setError(null);
    try {
      await updateStudioVideo(video.id, draft);
      await refresh();
      setMessage(`Saved “${draft.title}”.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The video could not be saved.");
    } finally {
      setBusyId(null);
    }
  }

  async function unpublish(video: StudioVideo) {
    setBusyId(video.id);
    setMessage(null);
    setError(null);
    try {
      await unpublishStudioVideo(video.id);
      await refresh();
      setMessage(`“${video.title}” is now unpublished.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The video could not be unpublished.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(video: StudioVideo) {
    if (!window.confirm(`Remove “${video.title}”? This keeps a soft-delete record.`)) return;
    setBusyId(video.id);
    setMessage(null);
    setError(null);
    try {
      await removeStudioVideo(video.id);
      await refresh();
      setMessage(`“${video.title}” was removed.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The video could not be removed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Creator Studio</span>
          <h1>Content</h1>
          <p className={styles.muted}>
            Edit only what you need. Publishing remains a separate Quick Upload flow.
          </p>
        </div>
      </header>

      <section aria-label="Content filters" className={styles.filters}>
        <input
          aria-label="Search videos"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your videos"
          value={query}
        />
        <select
          aria-label="Filter by status"
          onChange={(event) => setStatus(event.target.value)}
          value={status}
        >
          <option value="">All statuses</option>
          <option value="PUBLISHED">Published</option>
          <option value="DRAFT">Draft</option>
          <option value="UPLOADING">Uploading</option>
          <option value="VALIDATING">Validating</option>
          <option value="SCHEDULED">Scheduled</option>
          <option value="REMOVED">Removed</option>
        </select>
        <select
          aria-label="Filter by visibility"
          onChange={(event) => setVisibility(event.target.value)}
          value={visibility}
        >
          <option value="">All visibility</option>
          <option value="PUBLIC">Public</option>
          <option value="UNLISTED">Unlisted</option>
          <option value="PRIVATE">Private</option>
        </select>
      </section>

      {message ? <p className={styles.notice}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <p className={styles.muted}>Loading content…</p> : null}

      <section className={styles.videoGrid}>
        {!loading && videos.length === 0 ? (
          <p className={styles.muted}>No videos match these filters.</p>
        ) : null}
        {videos.map((video) => {
          const draft = drafts[video.id] ?? {
            title: video.title,
            description: video.description,
            visibility: video.visibility,
            commentsEnabled: video.commentsEnabled,
            tvIncluded: video.tvIncluded,
          };
          const disabled = busyId === video.id || video.status === "REMOVED";
          return (
            <article className={styles.card} key={video.id}>
              <div className={styles.cardHeader}>
                <div>
                  <strong>{video.title}</strong>
                  <p className={styles.muted}>
                    {video.status.toLowerCase()} · updated{" "}
                    {new Date(video.updatedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>

              <div className={styles.formGrid}>
                <input
                  disabled={disabled}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [video.id]: { ...draft, title: event.target.value },
                    }))
                  }
                  value={draft.title}
                />
                <select
                  disabled={disabled}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [video.id]: {
                        ...draft,
                        visibility: event.target.value as Draft["visibility"],
                      },
                    }))
                  }
                  value={draft.visibility}
                >
                  <option value="PUBLIC">Public</option>
                  <option value="UNLISTED">Unlisted</option>
                  <option value="PRIVATE">Private</option>
                </select>
                <textarea
                  disabled={disabled}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [video.id]: { ...draft, description: event.target.value || null },
                    }))
                  }
                  placeholder="Optional description"
                  value={draft.description ?? ""}
                />
              </div>

              <div className={styles.toggleRow}>
                <label>
                  <input
                    checked={draft.commentsEnabled}
                    disabled={disabled}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [video.id]: { ...draft, commentsEnabled: event.target.checked },
                      }))
                    }
                    type="checkbox"
                  />
                  Comments
                </label>
                <label>
                  <input
                    checked={draft.tvIncluded}
                    disabled={disabled}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [video.id]: { ...draft, tvIncluded: event.target.checked },
                      }))
                    }
                    type="checkbox"
                  />
                  Creator TV
                </label>
              </div>

              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  disabled={disabled}
                  onClick={() => void save(video)}
                  type="button"
                >
                  {busyId === video.id ? "Working…" : "Save"}
                </button>
                {video.status === "PUBLISHED" ? (
                  <button
                    className={styles.secondary}
                    disabled={disabled}
                    onClick={() => void unpublish(video)}
                    type="button"
                  >
                    Unpublish
                  </button>
                ) : null}
                <button
                  className={styles.danger}
                  disabled={disabled}
                  onClick={() => void remove(video)}
                  type="button"
                >
                  Remove
                </button>
              </div>
            </article>
          );
        })}
      </section>
    </>
  );
}
