"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { apiBaseUrl, readApiError } from "@/lib/api";
import { CatalogResourcePicker } from "./catalog-resource-picker";

type VideoRef = { id: string; title: string; slug: string } | null;
type ArtworkType = "POSTER" | "BACKDROP" | "LOGO";
type AvailabilityRule = "ALLOW" | "BLOCK";
type Validation = { status: "READY" | "BLOCKED"; publishable: boolean; issues: string[] };

type MovieRow = {
  id: string;
  title: string;
  slug: string;
  synopsis: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  releaseDate: string | null;
  releaseYear: number;
  runtimeMinutes: number;
  maturityRating: string;
  originalLanguage: string;
  primaryVideoId: string | null;
  trailerVideoId: string | null;
  primaryVideo: VideoRef;
  trailerVideo: VideoRef;
  genres: Array<{ name: string }>;
  artwork: Array<{
    type: ArtworkType;
    mediaAssetId: string;
    altText: string | null;
    asset: { r2ObjectKey: string; width: number | null; height: number | null } | null;
  }>;
  availability: Array<{
    territoryCode: string;
    rule: AvailabilityRule;
    startsAt: string | null;
    endsAt: string | null;
    note: string | null;
  }>;
  validation: Validation;
};

type AvailabilityDraft = {
  territoryCode: string;
  rule: AvailabilityRule;
  startsAt: string;
  endsAt: string;
  note: string;
};

type Draft = {
  title: string;
  slug: string;
  synopsis: string;
  releaseDate: string;
  releaseYear: string;
  runtimeMinutes: string;
  maturityRating: string;
  originalLanguage: string;
  primaryVideoId: string | null;
  primaryVideoLabel: string | null;
  trailerVideoId: string | null;
  trailerVideoLabel: string | null;
  genres: string;
  artwork: Record<ArtworkType, { id: string | null; label: string | null }>;
  availability: AvailabilityDraft[];
};

const emptyDraft = (): Draft => ({
  title: "",
  slug: "",
  synopsis: "",
  releaseDate: "",
  releaseYear: String(new Date().getFullYear()),
  runtimeMinutes: "90",
  maturityRating: "NR",
  originalLanguage: "en",
  primaryVideoId: null,
  primaryVideoLabel: null,
  trailerVideoId: null,
  trailerVideoLabel: null,
  genres: "",
  artwork: {
    POSTER: { id: null, label: null },
    BACKDROP: { id: null, label: null },
    LOGO: { id: null, label: null },
  },
  availability: [{ territoryCode: "*", rule: "ALLOW", startsAt: "", endsAt: "", note: "" }],
});

export function AdminMovieCatalog() {
  const [items, setItems] = useState<MovieRow[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"" | MovieRow["status"]>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: "100" });
    if (query.trim()) params.set("q", query.trim());
    if (status) params.set("status", status);
    const response = await fetch(`${apiBaseUrl}/admin/catalog/movies?${params.toString()}`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await readApiError(response));
    const body = (await response.json()) as { items: MovieRow[] };
    setItems(body.items);
    if (editingId) {
      const current = body.items.find((item) => item.id === editingId);
      if (current) setDraft(fromMovie(current));
    }
  }, [editingId, query, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Movie catalog could not be loaded."),
      );
    }, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  const editing = useMemo(
    () => (editingId ? items.find((item) => item.id === editingId) ?? null : null),
    [editingId, items],
  );

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("save");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `${apiBaseUrl}/admin/catalog/movies${editingId ? `/${editingId}` : ""}`,
        {
          method: editingId ? "PATCH" : "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(toPayload(draft)),
        },
      );
      if (!response.ok) throw new Error(await readApiError(response));
      const body = (await response.json()) as { movie: MovieRow };
      setEditingId(body.movie.id);
      setMessage(editingId ? "Movie changes saved." : "Movie draft created.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Movie could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  async function lifecycle(movie: MovieRow, action: "publish" | "unpublish" | "archive") {
    setBusy(`${action}:${movie.id}`);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/catalog/movies/${movie.id}/${action}`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error(await readApiError(response));
      setMessage(`Movie ${action === "publish" ? "published" : action === "unpublish" ? "unpublished" : "archived"}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Movie could not ${action}.`);
    } finally {
      setBusy(null);
    }
  }

  function beginEdit(movie: MovieRow) {
    setEditingId(movie.id);
    setDraft(fromMovie(movie));
    setError(null);
    setMessage(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function beginCreate() {
    setEditingId(null);
    setDraft(emptyDraft());
    setError(null);
    setMessage(null);
  }

  return (
    <>
      <section className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Catalog operations</span>
          <h1>Movies</h1>
          <p className={styles.muted}>
            Draft, validate and publish movie identities without exposing database IDs or unsafe media.
          </p>
        </div>
        <button className={styles.button} onClick={beginCreate} type="button">
          New movie draft
        </button>
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}
      {message ? <div className={styles.notice}>{message}</div> : null}

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <span className={styles.eyebrow}>{editing ? "Edit movie" : "Create draft"}</span>
            <h2>{editing?.title ?? "New movie"}</h2>
          </div>
          {editing ? <ValidationBadge validation={editing.validation} /> : <span className={styles.statusPill}>DRAFT</span>}
        </div>
        {editing?.validation.issues.length ? (
          <div className={styles.error}>Validation: {editing.validation.issues.join(" · ")}</div>
        ) : null}
        <form className={styles.formGrid} onSubmit={save}>
          <label>
            Title
            <input required maxLength={200} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <label>
            Slug
            <input maxLength={160} placeholder="generated from title when blank" value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} />
          </label>
          <label className={styles.fullField}>
            Synopsis
            <textarea required value={draft.synopsis} onChange={(event) => setDraft({ ...draft, synopsis: event.target.value })} />
          </label>
          <label>
            Release year
            <input min="1888" max="2200" required type="number" value={draft.releaseYear} onChange={(event) => setDraft({ ...draft, releaseYear: event.target.value })} />
          </label>
          <label>
            Runtime (minutes)
            <input min="1" max="1440" required type="number" value={draft.runtimeMinutes} onChange={(event) => setDraft({ ...draft, runtimeMinutes: event.target.value })} />
          </label>
          <label>
            Release date
            <input type="date" value={draft.releaseDate} onChange={(event) => setDraft({ ...draft, releaseDate: event.target.value })} />
          </label>
          <label>
            Maturity
            <input required maxLength={32} placeholder="PG-13" value={draft.maturityRating} onChange={(event) => setDraft({ ...draft, maturityRating: event.target.value })} />
          </label>
          <label>
            Original language
            <input required maxLength={16} placeholder="en" value={draft.originalLanguage} onChange={(event) => setDraft({ ...draft, originalLanguage: event.target.value })} />
          </label>
          <label>
            Genres / categories
            <input required placeholder="Drama, Mystery" value={draft.genres} onChange={(event) => setDraft({ ...draft, genres: event.target.value })} />
          </label>
          <div className={styles.fullField}>
            <CatalogResourcePicker
              kind="video"
              label="Primary playback"
              required
              value={draft.primaryVideoId}
              selectedLabel={draft.primaryVideoLabel}
              onChange={(id, label) => setDraft({ ...draft, primaryVideoId: id, primaryVideoLabel: label })}
            />
          </div>
          <div className={styles.fullField}>
            <CatalogResourcePicker
              kind="video"
              label="Trailer"
              value={draft.trailerVideoId}
              selectedLabel={draft.trailerVideoLabel}
              onChange={(id, label) => setDraft({ ...draft, trailerVideoId: id, trailerVideoLabel: label })}
            />
          </div>
          {(["POSTER", "BACKDROP", "LOGO"] as const).map((type) => (
            <div className={styles.fullField} key={type}>
              <CatalogResourcePicker
                kind="artwork"
                label={`${type[0]}${type.slice(1).toLowerCase()} artwork`}
                required={type === "POSTER"}
                value={draft.artwork[type].id}
                selectedLabel={draft.artwork[type].label}
                onChange={(id, label) =>
                  setDraft({
                    ...draft,
                    artwork: { ...draft.artwork, [type]: { id, label } },
                  })
                }
              />
            </div>
          ))}
          <div className={`${styles.cardInset} ${styles.fullField}`}>
            <div className={styles.cardHeader}>
              <div>
                <strong>Availability</strong>
                <p className={styles.muted}>Use * for global rights or a two-letter territory code.</p>
              </div>
              <button
                className={styles.button}
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    availability: [
                      ...draft.availability,
                      { territoryCode: "*", rule: "ALLOW", startsAt: "", endsAt: "", note: "" },
                    ],
                  })
                }
              >
                Add rule
              </button>
            </div>
            {draft.availability.map((rule, index) => (
              <div className={styles.formGrid} key={`${index}-${rule.territoryCode}`}>
                <label>
                  Territory
                  <input maxLength={2} value={rule.territoryCode} onChange={(event) => updateAvailability(setDraft, draft, index, { territoryCode: event.target.value.toUpperCase() })} />
                </label>
                <label>
                  Rule
                  <select value={rule.rule} onChange={(event) => updateAvailability(setDraft, draft, index, { rule: event.target.value as AvailabilityRule })}>
                    <option value="ALLOW">Allow</option>
                    <option value="BLOCK">Block</option>
                  </select>
                </label>
                <label>
                  Starts
                  <input type="datetime-local" value={rule.startsAt} onChange={(event) => updateAvailability(setDraft, draft, index, { startsAt: event.target.value })} />
                </label>
                <label>
                  Ends
                  <input type="datetime-local" value={rule.endsAt} onChange={(event) => updateAvailability(setDraft, draft, index, { endsAt: event.target.value })} />
                </label>
                <label className={styles.fullField}>
                  Note
                  <input maxLength={240} value={rule.note} onChange={(event) => updateAvailability(setDraft, draft, index, { note: event.target.value })} />
                </label>
                <div className={`${styles.actions} ${styles.fullField}`}>
                  <button className={styles.danger} type="button" onClick={() => setDraft({ ...draft, availability: draft.availability.filter((_, itemIndex) => itemIndex !== index) })}>
                    Remove rule
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className={`${styles.actions} ${styles.fullField}`}>
            <button className={styles.button} disabled={busy === "save"} type="submit">
              {busy === "save" ? "Saving…" : editingId ? "Save movie" : "Create draft"}
            </button>
            {editing ? (
              <>
                {editing.status === "PUBLISHED" ? (
                  <button className={styles.danger} disabled={Boolean(busy)} type="button" onClick={() => void lifecycle(editing, "unpublish")}>
                    Unpublish
                  </button>
                ) : editing.status === "DRAFT" ? (
                  <button className={styles.button} disabled={Boolean(busy) || !editing.validation.publishable} type="button" onClick={() => void lifecycle(editing, "publish")}>
                    Publish
                  </button>
                ) : null}
                {editing.status === "DRAFT" ? (
                  <button className={styles.danger} disabled={Boolean(busy)} type="button" onClick={() => void lifecycle(editing, "archive")}>
                    Archive
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </form>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <span className={styles.eyebrow}>Catalog browser</span>
            <h2>Movies</h2>
          </div>
          <span className={styles.statusPill}>{items.length} results</span>
        </div>
        <div className={styles.toolbar}>
          <input placeholder="Search title, slug, synopsis or genre…" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>
        <div className={styles.grid}>
          {items.map((movie) => (
            <article className={styles.cardInset} key={movie.id}>
              <div className={styles.cardHeader}>
                <div>
                  <strong>{movie.title}</strong>
                  <p className={styles.muted}>/{movie.slug} · {movie.releaseYear} · {movie.runtimeMinutes} min · {movie.originalLanguage.toUpperCase()}</p>
                </div>
                <ValidationBadge validation={movie.validation} />
              </div>
              <p>{movie.genres.map((genre) => genre.name).join(" · ") || "No genres"}</p>
              <p className={styles.muted}>
                Primary: {movie.primaryVideo ? `${movie.primaryVideo.title} (${movie.primaryVideo.slug})` : "Not assigned"}
              </p>
              <div className={styles.actions}>
                <span className={styles.statusPill}>{movie.status}</span>
                <button className={styles.button} type="button" onClick={() => beginEdit(movie)}>Edit</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function ValidationBadge({ validation }: { validation: Validation }) {
  return (
    <span className={styles.statusPill} title={validation.issues.join(", ")}>
      {validation.status === "READY" ? "Ready" : `${validation.issues.length} validation issue${validation.issues.length === 1 ? "" : "s"}`}
    </span>
  );
}

function fromMovie(movie: MovieRow): Draft {
  const artwork = emptyDraft().artwork;
  for (const item of movie.artwork) {
    artwork[item.type] = {
      id: item.mediaAssetId,
      label: item.asset ? `${item.type} · ${item.asset.r2ObjectKey.split("/").at(-1) ?? "image"}` : item.type,
    };
  }
  return {
    title: movie.title,
    slug: movie.slug,
    synopsis: movie.synopsis,
    releaseDate: movie.releaseDate?.slice(0, 10) ?? "",
    releaseYear: String(movie.releaseYear),
    runtimeMinutes: String(movie.runtimeMinutes),
    maturityRating: movie.maturityRating,
    originalLanguage: movie.originalLanguage,
    primaryVideoId: movie.primaryVideoId,
    primaryVideoLabel: movie.primaryVideo ? `${movie.primaryVideo.title} · ${movie.primaryVideo.slug}` : null,
    trailerVideoId: movie.trailerVideoId,
    trailerVideoLabel: movie.trailerVideo ? `${movie.trailerVideo.title} · ${movie.trailerVideo.slug}` : null,
    genres: movie.genres.map((genre) => genre.name).join(", "),
    artwork,
    availability: movie.availability.map((item) => ({
      territoryCode: item.territoryCode,
      rule: item.rule,
      startsAt: toLocalDateTime(item.startsAt),
      endsAt: toLocalDateTime(item.endsAt),
      note: item.note ?? "",
    })),
  };
}

function toPayload(draft: Draft) {
  return {
    title: draft.title,
    ...(draft.slug.trim() ? { slug: draft.slug.trim() } : {}),
    synopsis: draft.synopsis,
    releaseDate: draft.releaseDate ? new Date(`${draft.releaseDate}T00:00:00`).toISOString() : null,
    releaseYear: Number(draft.releaseYear),
    runtimeMinutes: Number(draft.runtimeMinutes),
    maturityRating: draft.maturityRating,
    originalLanguage: draft.originalLanguage,
    primaryVideoId: draft.primaryVideoId,
    trailerVideoId: draft.trailerVideoId,
    genres: splitGenres(draft.genres),
    artwork: (Object.entries(draft.artwork) as Array<[ArtworkType, Draft["artwork"][ArtworkType]]>).flatMap(([type, item]) =>
      item.id ? [{ type, mediaAssetId: item.id, altText: `${draft.title} ${type.toLowerCase()}` }] : [],
    ),
    availability: draft.availability.map((item) => ({
      territoryCode: item.territoryCode,
      rule: item.rule,
      startsAt: item.startsAt ? new Date(item.startsAt).toISOString() : null,
      endsAt: item.endsAt ? new Date(item.endsAt).toISOString() : null,
      note: item.note.trim() || null,
    })),
  };
}

function splitGenres(value: string) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function updateAvailability(
  setDraft: React.Dispatch<React.SetStateAction<Draft>>,
  draft: Draft,
  index: number,
  patch: Partial<AvailabilityDraft>,
) {
  setDraft({
    ...draft,
    availability: draft.availability.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item,
    ),
  });
}
