"use client";

import { useCallback, useEffect, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { apiBaseUrl, readApiError } from "@/lib/api";

type EpisodeRow = {
  id: string;
  episodeNumber: number;
  title: string;
  synopsis: string;
  sortOrder: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  videoId: string | null;
  video: {
    id: string;
    slug: string;
    title: string;
    status: string;
    visibility: string;
  } | null;
};

type SeasonRow = {
  id: string;
  seasonNumber: number;
  title: string | null;
  sortOrder: number;
  episodes: EpisodeRow[];
};

type SeriesRow = {
  id: string;
  title: string;
  slug: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  releaseYear: number | null;
  maturityRating: string;
  originalLanguage: string;
  genres: Array<{ name: string }>;
  seasons: SeasonRow[];
};

export function AdminSeriesCatalog() {
  const [items, setItems] = useState<SeriesRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`${apiBaseUrl}/admin/catalog/series?limit=100`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await readApiError(response));
    const body = (await response.json()) as { items: SeriesRow[] };
    setItems(body.items);
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void load().catch((caught) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Series catalog could not be loaded.");
        }
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [load]);

  async function mutate(key: string, url: string, init: RequestInit, success: string) {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`${apiBaseUrl}${url}`, {
        credentials: "include",
        ...init,
        headers: init.body ? { "content-type": "application/json", ...init.headers } : init.headers,
      });
      if (!response.ok) throw new Error(await readApiError(response));
      await load();
      setMessage(success);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Series catalog action failed.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function createSeries(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = text(data, "title");
    const releaseYear = text(data, "releaseYear");
    const posterAssetId = text(data, "posterAssetId");
    const ok = await mutate(
      "create-series",
      "/admin/catalog/series",
      {
        method: "POST",
        body: JSON.stringify({
          title,
          ...(text(data, "slug") ? { slug: text(data, "slug") } : {}),
          synopsis: text(data, "synopsis"),
          ...(releaseYear ? { releaseYear: Number(releaseYear) } : {}),
          maturityRating: text(data, "maturityRating"),
          originalLanguage: text(data, "originalLanguage"),
          genres: csv(text(data, "genres")),
          artwork: posterAssetId
            ? [{ type: "POSTER", mediaAssetId: posterAssetId, altText: `${title} poster` }]
            : [],
        }),
      },
      "Series draft created. Add seasons and published playable episodes before publishing it.",
    );
    if (ok) form.reset();
  }

  async function createSeason(series: SeriesRow, event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ok = await mutate(
      `season-${series.id}`,
      `/admin/catalog/series/${series.id}/seasons`,
      {
        method: "POST",
        body: JSON.stringify({
          seasonNumber: Number(text(data, "seasonNumber")),
          ...(text(data, "title") ? { title: text(data, "title") } : {}),
        }),
      },
      `${series.title}: season created.`,
    );
    if (ok) form.reset();
  }

  async function createEpisode(season: SeasonRow, event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const videoId = text(data, "videoId");
    const ok = await mutate(
      `episode-${season.id}`,
      `/admin/catalog/series/seasons/${season.id}/episodes`,
      {
        method: "POST",
        body: JSON.stringify({
          episodeNumber: Number(text(data, "episodeNumber")),
          title: text(data, "title"),
          synopsis: text(data, "synopsis"),
          videoId: videoId || null,
        }),
      },
      `Season ${season.seasonNumber}: episode created.`,
    );
    if (ok) form.reset();
  }

  async function assignVideo(episode: EpisodeRow, event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const videoId = text(new FormData(event.currentTarget), "videoId");
    await mutate(
      `assign-${episode.id}`,
      `/admin/catalog/series/episodes/${episode.id}`,
      { method: "PATCH", body: JSON.stringify({ videoId: videoId || null }) },
      `${episode.title}: playable Video assignment updated.`,
    );
  }

  async function seriesLifecycle(series: SeriesRow, action: "publish" | "unpublish" | "archive") {
    if (action === "archive" && !window.confirm(`Archive “${series.title}”?`)) return;
    await mutate(
      `series-${series.id}`,
      `/admin/catalog/series/${series.id}/${action}`,
      { method: "POST" },
      `${series.title}: ${action} completed.`,
    );
  }

  async function episodeLifecycle(episode: EpisodeRow, action: "publish" | "unpublish") {
    await mutate(
      `episode-life-${episode.id}`,
      `/admin/catalog/series/episodes/${episode.id}/${action}`,
      { method: "POST" },
      `${episode.title}: ${action} completed.`,
    );
  }

  async function moveSeason(series: SeriesRow, index: number, delta: -1 | 1) {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= series.seasons.length) return;
    const ordered = series.seasons.map((season) => season.id);
    [ordered[index], ordered[nextIndex]] = [ordered[nextIndex]!, ordered[index]!];
    await mutate(
      `reorder-series-${series.id}`,
      `/admin/catalog/series/${series.id}/seasons/reorder`,
      { method: "POST", body: JSON.stringify({ orderedIds: ordered }) },
      `${series.title}: season order updated.`,
    );
  }

  async function moveEpisode(season: SeasonRow, index: number, delta: -1 | 1) {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= season.episodes.length) return;
    const ordered = season.episodes.map((episode) => episode.id);
    [ordered[index], ordered[nextIndex]] = [ordered[nextIndex]!, ordered[index]!];
    await mutate(
      `reorder-season-${season.id}`,
      `/admin/catalog/series/seasons/${season.id}/episodes/reorder`,
      { method: "POST", body: JSON.stringify({ orderedIds: ordered }) },
      `Season ${season.seasonNumber}: episode order updated.`,
    );
  }

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Catalog</span>
          <h1>Series</h1>
          <p className={styles.muted}>
            Series, seasons and episodes are deliberate catalog records. Playable media stays in
            existing Video rows; creator uploads are never classified automatically.
          </p>
        </div>
      </header>

      <form className={styles.card} onSubmit={(event) => void createSeries(event)}>
        <div className={styles.cardHeader}>
          <div>
            <strong>Create series draft</strong>
            <p className={styles.muted}>Reference existing MediaAsset IDs; no media bytes are copied.</p>
          </div>
        </div>
        <div className={styles.grid}>
          <label>
            Title
            <input name="title" required />
          </label>
          <label>
            Slug (optional)
            <input name="slug" placeholder="generated-from-title" />
          </label>
          <label>
            Release year (optional)
            <input inputMode="numeric" name="releaseYear" />
          </label>
          <label>
            Maturity
            <input defaultValue="TV-14" name="maturityRating" required />
          </label>
          <label>
            Original language
            <input defaultValue="en" name="originalLanguage" required />
          </label>
          <label>
            Genres (comma separated)
            <input name="genres" placeholder="Drama, Mystery" />
          </label>
          <label>
            Poster MediaAsset UUID
            <input name="posterAssetId" />
          </label>
        </div>
        <label>
          Synopsis
          <textarea name="synopsis" required rows={4} />
        </label>
        <div className={styles.actions}>
          <button className={styles.button} disabled={busy === "create-series"} type="submit">
            Create series
          </button>
        </div>
      </form>

      {message ? <p className={styles.notice}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.grid}>
        {items.map((series) => (
          <article className={styles.card} key={series.id}>
            <div className={styles.cardHeader}>
              <div>
                <strong>{series.title}</strong>
                <p className={styles.muted}>
                  /{series.slug} · {series.releaseYear ?? "year not set"} · {series.maturityRating} ·{" "}
                  {series.originalLanguage.toUpperCase()}
                </p>
              </div>
              <strong>{series.status}</strong>
            </div>
            <p className={styles.muted}>
              Genres: {series.genres.map((genre) => genre.name).join(", ") || "none"}
            </p>
            <div className={styles.actions}>
              {series.status === "DRAFT" ? (
                <button
                  className={styles.button}
                  disabled={busy === `series-${series.id}`}
                  onClick={() => void seriesLifecycle(series, "publish")}
                  type="button"
                >
                  Publish series
                </button>
              ) : null}
              {series.status === "PUBLISHED" ? (
                <button
                  className={styles.button}
                  disabled={busy === `series-${series.id}`}
                  onClick={() => void seriesLifecycle(series, "unpublish")}
                  type="button"
                >
                  Unpublish series
                </button>
              ) : null}
              {series.status !== "ARCHIVED" ? (
                <button
                  className={styles.button}
                  disabled={busy === `series-${series.id}`}
                  onClick={() => void seriesLifecycle(series, "archive")}
                  type="button"
                >
                  Archive
                </button>
              ) : null}
            </div>

            {series.status !== "ARCHIVED" ? (
              <form className={styles.card} onSubmit={(event) => void createSeason(series, event)}>
                <strong>Add season</strong>
                <div className={styles.grid}>
                  <label>
                    Season number
                    <input inputMode="numeric" name="seasonNumber" required />
                  </label>
                  <label>
                    Title (optional)
                    <input name="title" />
                  </label>
                </div>
                <div className={styles.actions}>
                  <button className={styles.button} disabled={busy === `season-${series.id}`} type="submit">
                    Add season
                  </button>
                </div>
              </form>
            ) : null}

            {series.seasons.map((season, seasonIndex) => (
              <section className={styles.card} key={season.id}>
                <div className={styles.cardHeader}>
                  <div>
                    <strong>{season.title ?? `Season ${season.seasonNumber}`}</strong>
                    <p className={styles.muted}>Catalog order {seasonIndex + 1}</p>
                  </div>
                  <div className={styles.actions}>
                    <button
                      className={styles.button}
                      disabled={seasonIndex === 0 || busy === `reorder-series-${series.id}`}
                      onClick={() => void moveSeason(series, seasonIndex, -1)}
                      type="button"
                    >
                      ↑
                    </button>
                    <button
                      className={styles.button}
                      disabled={
                        seasonIndex === series.seasons.length - 1 ||
                        busy === `reorder-series-${series.id}`
                      }
                      onClick={() => void moveSeason(series, seasonIndex, 1)}
                      type="button"
                    >
                      ↓
                    </button>
                  </div>
                </div>

                {series.status !== "ARCHIVED" ? (
                  <form onSubmit={(event) => void createEpisode(season, event)}>
                    <div className={styles.grid}>
                      <label>
                        Episode number
                        <input inputMode="numeric" name="episodeNumber" required />
                      </label>
                      <label>
                        Episode title
                        <input name="title" required />
                      </label>
                      <label>
                        Video UUID (optional until publish)
                        <input name="videoId" />
                      </label>
                    </div>
                    <label>
                      Synopsis
                      <textarea name="synopsis" required rows={3} />
                    </label>
                    <div className={styles.actions}>
                      <button
                        className={styles.button}
                        disabled={busy === `episode-${season.id}`}
                        type="submit"
                      >
                        Add episode
                      </button>
                    </div>
                  </form>
                ) : null}

                {season.episodes.map((episode, episodeIndex) => (
                  <article className={styles.card} key={episode.id}>
                    <div className={styles.cardHeader}>
                      <div>
                        <strong>
                          E{episode.episodeNumber} · {episode.title}
                        </strong>
                        <p className={styles.muted}>
                          {episode.status} · order {episodeIndex + 1} · Video:{" "}
                          {episode.video?.slug ?? episode.videoId ?? "not assigned"}
                        </p>
                      </div>
                      <div className={styles.actions}>
                        <button
                          className={styles.button}
                          disabled={episodeIndex === 0 || busy === `reorder-season-${season.id}`}
                          onClick={() => void moveEpisode(season, episodeIndex, -1)}
                          type="button"
                        >
                          ↑
                        </button>
                        <button
                          className={styles.button}
                          disabled={
                            episodeIndex === season.episodes.length - 1 ||
                            busy === `reorder-season-${season.id}`
                          }
                          onClick={() => void moveEpisode(season, episodeIndex, 1)}
                          type="button"
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                    <p>{episode.synopsis}</p>
                    <form onSubmit={(event) => void assignVideo(episode, event)}>
                      <label>
                        Assigned Video UUID
                        <input defaultValue={episode.videoId ?? ""} name="videoId" />
                      </label>
                      <div className={styles.actions}>
                        <button
                          className={styles.button}
                          disabled={busy === `assign-${episode.id}`}
                          type="submit"
                        >
                          Save Video assignment
                        </button>
                        {episode.status === "DRAFT" ? (
                          <button
                            className={styles.button}
                            disabled={busy === `episode-life-${episode.id}`}
                            onClick={() => void episodeLifecycle(episode, "publish")}
                            type="button"
                          >
                            Publish episode
                          </button>
                        ) : null}
                        {episode.status === "PUBLISHED" ? (
                          <button
                            className={styles.button}
                            disabled={busy === `episode-life-${episode.id}`}
                            onClick={() => void episodeLifecycle(episode, "unpublish")}
                            type="button"
                          >
                            Unpublish episode
                          </button>
                        ) : null}
                      </div>
                    </form>
                  </article>
                ))}
              </section>
            ))}
          </article>
        ))}
        {!items.length ? <p className={styles.muted}>No deliberate series catalog entries yet.</p> : null}
      </section>
    </>
  );
}

function text(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function csv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
