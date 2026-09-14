"use client";

import { useCallback, useEffect, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { apiBaseUrl, readApiError } from "@/lib/api";

type MovieRow = {
  id: string;
  title: string;
  slug: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  releaseYear: number;
  runtimeMinutes: number;
  maturityRating: string;
  originalLanguage: string;
  primaryVideoId: string | null;
  primaryVideo: { slug: string; status: string; visibility: string } | null;
  genres: Array<{ name: string }>;
  artwork: Array<{ type: string; mediaAssetId: string }>;
  availability: Array<{ territoryCode: string; rule: string }>;
};

type Draft = {
  title: string;
  slug: string;
  synopsis: string;
  releaseYear: string;
  runtimeMinutes: string;
  maturityRating: string;
  originalLanguage: string;
  primaryVideoId: string;
  posterAssetId: string;
  genres: string;
};

const emptyDraft: Draft = {
  title: "",
  slug: "",
  synopsis: "",
  releaseYear: String(new Date().getFullYear()),
  runtimeMinutes: "90",
  maturityRating: "NR",
  originalLanguage: "en",
  primaryVideoId: "",
  posterAssetId: "",
  genres: "",
};

export function AdminMovieCatalog() {
  const [items, setItems] = useState<MovieRow[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`${apiBaseUrl}/admin/catalog/movies?limit=100`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await readApiError(response));
    const body = (await response.json()) as { items: MovieRow[] };
    setItems(body.items);
  }, []);

  useEffect(() => {
    void load().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Movie catalog could not be loaded."),
    );
  }, [load]);

  async function createMovie(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/catalog/movies`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          ...(draft.slug.trim() ? { slug: draft.slug.trim() } : {}),
          synopsis: draft.synopsis,
          releaseYear: Number(draft.releaseYear),
          runtimeMinutes: Number(draft.runtimeMinutes),
          maturityRating: draft.maturityRating,
          originalLanguage: draft.originalLanguage,
          primaryVideoId: draft.primaryVideoId || null,
          trailerVideoId: null,
          genres: draft.genres
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          artwork: draft.posterAssetId
            ? [
                {
                  type: "POSTER",
                  mediaAssetId: draft.posterAssetId,
                  altText: `${draft.title} poster`,
                },
              ]
            : [],
          availability: [{ territoryCode: "*", rule: "ALLOW" }],
          localizations: [],
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      setDraft(emptyDraft);
      await load();
      setMessage(
        "Movie draft created. Publishing remains blocked until all eligibility checks pass.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Movie could not be created.");
    } finally {
      setBusy(null);
    }
  }

  async function lifecycle(movie: MovieRow, action: "publish" | "unpublish" | "archive") {
    if (action === "archive" && !window.confirm(`Archive “${movie.title}”?`)) return;
    setBusy(movie.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/catalog/movies/${movie.id}/${action}`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error(await readApiError(response));
      await load();
      setMessage(`${movie.title}: ${action} completed.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Catalog action failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Catalog</span>
          <h1>Movies</h1>
          <p className={styles.muted}>
            Movie identity is separate from uploaded videos. Only records created here enter the
            movie catalog.
          </p>
        </div>
      </header>

      <form className={styles.card} onSubmit={(event) => void createMovie(event)}>
        <div className={styles.cardHeader}>
          <div>
            <strong>Create movie draft</strong>
            <p className={styles.muted}>
              Reference existing Video and MediaAsset IDs; media bytes are never copied.
            </p>
          </div>
        </div>
        <div className={styles.grid}>
          <label>
            Title
            <input
              required
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          <label>
            Slug (optional)
            <input
              value={draft.slug}
              onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
              placeholder="generated-from-title"
            />
          </label>
          <label>
            Release year
            <input
              required
              inputMode="numeric"
              value={draft.releaseYear}
              onChange={(event) => setDraft({ ...draft, releaseYear: event.target.value })}
            />
          </label>
          <label>
            Runtime minutes
            <input
              required
              inputMode="numeric"
              value={draft.runtimeMinutes}
              onChange={(event) => setDraft({ ...draft, runtimeMinutes: event.target.value })}
            />
          </label>
          <label>
            Maturity
            <input
              required
              value={draft.maturityRating}
              onChange={(event) => setDraft({ ...draft, maturityRating: event.target.value })}
            />
          </label>
          <label>
            Original language
            <input
              required
              value={draft.originalLanguage}
              onChange={(event) => setDraft({ ...draft, originalLanguage: event.target.value })}
            />
          </label>
          <label>
            Primary Video UUID
            <input
              value={draft.primaryVideoId}
              onChange={(event) => setDraft({ ...draft, primaryVideoId: event.target.value })}
            />
          </label>
          <label>
            Poster MediaAsset UUID
            <input
              value={draft.posterAssetId}
              onChange={(event) => setDraft({ ...draft, posterAssetId: event.target.value })}
            />
          </label>
          <label>
            Genres (comma separated)
            <input
              value={draft.genres}
              onChange={(event) => setDraft({ ...draft, genres: event.target.value })}
              placeholder="Drama, Thriller"
            />
          </label>
        </div>
        <label>
          Synopsis
          <textarea
            required
            rows={4}
            value={draft.synopsis}
            onChange={(event) => setDraft({ ...draft, synopsis: event.target.value })}
          />
        </label>
        <div className={styles.actions}>
          <button className={styles.button} disabled={busy === "create"} type="submit">
            Create draft
          </button>
        </div>
      </form>

      {message ? <p className={styles.notice}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.grid}>
        {items.map((movie) => (
          <article className={styles.card} key={movie.id}>
            <div className={styles.cardHeader}>
              <div>
                <strong>{movie.title}</strong>
                <p className={styles.muted}>
                  /{movie.slug} · {movie.releaseYear} · {movie.runtimeMinutes} min
                </p>
              </div>
              <strong>{movie.status}</strong>
            </div>
            <p className={styles.muted}>
              Video: {movie.primaryVideo?.slug ?? movie.primaryVideoId ?? "not assigned"}
              <br />
              Genres: {movie.genres.map((genre) => genre.name).join(", ") || "none"}
              <br />
              Rights:{" "}
              {movie.availability
                .map((right) => `${right.territoryCode}:${right.rule}`)
                .join(", ") || "none"}
            </p>
            <div className={styles.actions}>
              {movie.status === "DRAFT" ? (
                <button
                  className={styles.button}
                  disabled={busy === movie.id}
                  onClick={() => void lifecycle(movie, "publish")}
                  type="button"
                >
                  Publish
                </button>
              ) : null}
              {movie.status === "PUBLISHED" ? (
                <button
                  className={styles.button}
                  disabled={busy === movie.id}
                  onClick={() => void lifecycle(movie, "unpublish")}
                  type="button"
                >
                  Unpublish
                </button>
              ) : null}
              {movie.status !== "ARCHIVED" ? (
                <button
                  className={styles.button}
                  disabled={busy === movie.id}
                  onClick={() => void lifecycle(movie, "archive")}
                  type="button"
                >
                  Archive
                </button>
              ) : null}
            </div>
          </article>
        ))}
        {!items.length ? (
          <p className={styles.muted}>No deliberate movie catalog entries yet.</p>
        ) : null}
      </section>
    </>
  );
}
