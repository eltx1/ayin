"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import {
  bulkAdminVideos,
  getAdminCollection,
  patchAdminResource,
  type AdminPagination,
} from "@/lib/admin-control";

type VideoItem = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: "DRAFT" | "UPLOADING" | "VALIDATING" | "SCHEDULED" | "PUBLISHED" | "REMOVED";
  visibility: "PUBLIC" | "UNLISTED" | "PRIVATE";
  commentsEnabled: boolean;
  updatedAt: string;
  channel: { id: string; handle: string; name: string; status: string };
  tvPreferences: Array<{
    tvChannelId: string;
    included: boolean;
    priority: number;
    sortOrder: number | null;
  }>;
  _count: { comments: number; reports: number };
};
type Response = { items: VideoItem[]; pagination: AdminPagination };
type Draft = {
  title: string;
  description: string;
  status: string;
  visibility: string;
  commentsEnabled: boolean;
  tvIncluded: boolean;
};

export function AdminVideos({ initialQuery = "" }: { initialQuery?: string }) {
  const [data, setData] = useState<Response | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState("");
  const [visibility, setVisibility] = useState("");
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const params = useMemo(() => {
    const value = new URLSearchParams({ page: String(page), take: "25" });
    if (query.trim()) value.set("query", query.trim());
    if (status) value.set("status", status);
    if (visibility) value.set("visibility", visibility);
    return value;
  }, [page, query, status, visibility]);

  function hydrate(response: Response) {
    setData(response);
    setDrafts(
      Object.fromEntries(
        response.items.map((video) => [
          video.id,
          {
            title: video.title,
            description: video.description ?? "",
            status: video.status,
            visibility: video.visibility,
            commentsEnabled: video.commentsEnabled,
            tvIncluded: video.tvPreferences[0]?.included ?? true,
          },
        ]),
      ),
    );
    setSelected((current) =>
      current.filter((id) => response.items.some((video) => video.id === id)),
    );
  }

  async function load() {
    hydrate(await getAdminCollection<Response>("videos", params));
  }

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void getAdminCollection<Response>("videos", params)
        .then((response) => {
          if (active) {
            hydrate(response);
            setError(null);
          }
        })
        .catch((caught) => {
          if (active)
            setError(caught instanceof Error ? caught.message : "Videos could not be loaded.");
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [params]);

  async function save(video: VideoItem) {
    const draft = drafts[video.id];
    if (!draft) return;
    const reason = window.prompt(`Audit reason for changing “${video.title}”:`);
    if (!reason?.trim()) return;
    setBusyId(video.id);
    setError(null);
    setMessage(null);
    try {
      await patchAdminResource("videos", video.id, {
        ...draft,
        description: draft.description || null,
        reason: reason.trim(),
      });
      await load();
      setMessage(`Updated “${draft.title}”.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Video could not be updated.");
    } finally {
      setBusyId(null);
    }
  }

  async function runBulk(action: "UNPUBLISH" | "DISABLE_COMMENTS" | "ENABLE_COMMENTS") {
    if (!selected.length) return;
    const reason = window.prompt(
      `Audit reason for ${action.toLowerCase().replaceAll("_", " ")} on ${selected.length} videos:`,
    );
    if (!reason?.trim()) return;
    setBusyId("bulk");
    setError(null);
    setMessage(null);
    try {
      const result = await bulkAdminVideos(selected, action, reason.trim());
      await load();
      setMessage(`${result.affected} videos updated.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Bulk video action failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Control Plane</span>
          <h1>Videos & Content</h1>
          <p className={styles.muted}>
            Search every video, edit state, comments and Creator TV inclusion, or apply safe bulk
            actions.
          </p>
        </div>
      </header>
      <div className={styles.toolbar}>
        <input
          aria-label="Search videos"
          onChange={(event) => {
            setPage(1);
            setQuery(event.target.value);
          }}
          placeholder="Search title, slug or channel"
          value={query}
        />
        <select
          aria-label="Filter video status"
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
          value={status}
        >
          <option value="">Active records</option>
          <option value="PUBLISHED">Published</option>
          <option value="DRAFT">Draft</option>
          <option value="UPLOADING">Uploading</option>
          <option value="VALIDATING">Validating</option>
          <option value="SCHEDULED">Scheduled</option>
          <option value="REMOVED">Removed</option>
        </select>
        <select
          aria-label="Filter video visibility"
          onChange={(event) => {
            setPage(1);
            setVisibility(event.target.value);
          }}
          value={visibility}
        >
          <option value="">All visibility</option>
          <option value="PUBLIC">Public</option>
          <option value="UNLISTED">Unlisted</option>
          <option value="PRIVATE">Private</option>
        </select>
      </div>
      {selected.length ? (
        <div className={styles.bulk}>
          <strong>{selected.length} selected</strong>
          <div className={styles.actions}>
            <button
              className={styles.button}
              disabled={busyId === "bulk"}
              onClick={() => void runBulk("UNPUBLISH")}
              type="button"
            >
              Unpublish selected
            </button>
            <button
              className={styles.button}
              disabled={busyId === "bulk"}
              onClick={() => void runBulk("DISABLE_COMMENTS")}
              type="button"
            >
              Disable comments
            </button>
            <button
              className={styles.button}
              disabled={busyId === "bulk"}
              onClick={() => void runBulk("ENABLE_COMMENTS")}
              type="button"
            >
              Enable comments
            </button>
          </div>
        </div>
      ) : null}
      {message ? <p className={styles.notice}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      <section className={styles.grid}>
        {data?.items.map((video) => {
          const draft = drafts[video.id];
          if (!draft) return null;
          const disabled = video.status === "REMOVED" || busyId === video.id;
          return (
            <article className={styles.card} key={video.id}>
              <div className={styles.cardHeader}>
                <label className={styles.check}>
                  <input
                    checked={selected.includes(video.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, video.id]
                          : current.filter((id) => id !== video.id),
                      )
                    }
                    type="checkbox"
                  />
                  Select
                </label>
                <div>
                  <strong>@{video.channel.handle}</strong>
                  <p className={styles.muted}>
                    {video._count.comments} comments · {video._count.reports} reports
                  </p>
                </div>
              </div>
              <div className={styles.form}>
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
                      [video.id]: { ...draft, status: event.target.value },
                    }))
                  }
                  value={draft.status}
                >
                  <option value="DRAFT">Draft</option>
                  <option value="SCHEDULED">Scheduled</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="REMOVED">Removed</option>
                </select>
                <textarea
                  disabled={disabled}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [video.id]: { ...draft, description: event.target.value },
                    }))
                  }
                  value={draft.description}
                />
                <select
                  disabled={disabled}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [video.id]: { ...draft, visibility: event.target.value },
                    }))
                  }
                  value={draft.visibility}
                >
                  <option value="PUBLIC">Public</option>
                  <option value="UNLISTED">Unlisted</option>
                  <option value="PRIVATE">Private</option>
                </select>
              </div>
              <div className={styles.actions}>
                <label className={styles.check}>
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
                <label className={styles.check}>
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
                <button
                  className={draft.status === "REMOVED" ? styles.danger : styles.button}
                  disabled={disabled}
                  onClick={() => void save(video)}
                  type="button"
                >
                  Save video
                </button>
              </div>
            </article>
          );
        })}
      </section>
      {data ? (
        <div className={styles.pager}>
          <button
            className={styles.button}
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            type="button"
          >
            Previous
          </button>
          <span className={styles.muted}>
            Page {data.pagination.page} of {data.pagination.pages} · {data.pagination.total} videos
          </span>
          <button
            className={styles.button}
            disabled={page >= data.pagination.pages}
            onClick={() => setPage((value) => value + 1)}
            type="button"
          >
            Next
          </button>
        </div>
      ) : null}
    </>
  );
}
