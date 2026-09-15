"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { apiBaseUrl, readApiError } from "@/lib/api";
import { CatalogResourcePicker } from "./catalog-resource-picker";

type EntityType = "MOVIE" | "SERIES" | "SEASON" | "EPISODE";

type EntityOption = {
  id: string;
  type: EntityType;
  label: string;
  parentLabel?: string;
};

type MovieRow = { id: string; title: string; slug: string };
type EpisodeRow = { id: string; episodeNumber: number; title: string };
type SeasonRow = {
  id: string;
  seasonNumber: number;
  title: string | null;
  episodes: EpisodeRow[];
};
type SeriesRow = { id: string; title: string; slug: string; seasons: SeasonRow[] };

type LocalizationRow = {
  id: string;
  locale: string;
  title: string | null;
  synopsis?: string | null;
  shortDescription?: string | null;
  posterMediaAssetId?: string | null;
  backdropMediaAssetId?: string | null;
};

type Draft = {
  locale: string;
  title: string;
  synopsis: string;
  shortDescription: string;
  posterMediaAssetId: string | null;
  posterLabel: string | null;
  backdropMediaAssetId: string | null;
  backdropLabel: string | null;
};

const emptyDraft = (): Draft => ({
  locale: "ar",
  title: "",
  synopsis: "",
  shortDescription: "",
  posterMediaAssetId: null,
  posterLabel: null,
  backdropMediaAssetId: null,
  backdropLabel: null,
});

export function AdminCatalogLocalizations() {
  const [entityType, setEntityType] = useState<EntityType>("MOVIE");
  const [entityId, setEntityId] = useState("");
  const [movies, setMovies] = useState<MovieRow[]>([]);
  const [series, setSeries] = useState<SeriesRow[]>([]);
  const [localizations, setLocalizations] = useState<LocalizationRow[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const entityOptions = useMemo<EntityOption[]>(() => {
    if (entityType === "MOVIE") {
      return movies.map((movie) => ({
        id: movie.id,
        type: "MOVIE",
        label: movie.title,
        parentLabel: movie.slug,
      }));
    }
    if (entityType === "SERIES") {
      return series.map((item) => ({
        id: item.id,
        type: "SERIES",
        label: item.title,
        parentLabel: item.slug,
      }));
    }
    if (entityType === "SEASON") {
      return series.flatMap((item) =>
        item.seasons.map((season) => ({
          id: season.id,
          type: "SEASON" as const,
          label: season.title ?? `Season ${season.seasonNumber}`,
          parentLabel: item.title,
        })),
      );
    }
    return series.flatMap((item) =>
      item.seasons.flatMap((season) =>
        season.episodes.map((episode) => ({
          id: episode.id,
          type: "EPISODE" as const,
          label: `E${episode.episodeNumber} · ${episode.title}`,
          parentLabel: `${item.title} · ${season.title ?? `Season ${season.seasonNumber}`}`,
        })),
      ),
    );
  }, [entityType, movies, series]);

  const loadEntities = useCallback(async () => {
    const [movieResponse, seriesResponse] = await Promise.all([
      fetch(`${apiBaseUrl}/admin/catalog/movies?limit=100`, {
        credentials: "include",
        cache: "no-store",
      }),
      fetch(`${apiBaseUrl}/admin/catalog/series?limit=100`, {
        credentials: "include",
        cache: "no-store",
      }),
    ]);
    if (!movieResponse.ok) throw new Error(await readApiError(movieResponse));
    if (!seriesResponse.ok) throw new Error(await readApiError(seriesResponse));
    const movieBody = (await movieResponse.json()) as { items: MovieRow[] };
    const seriesBody = (await seriesResponse.json()) as { items: SeriesRow[] };
    setMovies(movieBody.items);
    setSeries(seriesBody.items);
  }, []);

  const loadLocalizations = useCallback(async () => {
    if (!entityId) {
      setLocalizations([]);
      return;
    }
    const params = new URLSearchParams({ entityType, entityId });
    const response = await fetch(`${apiBaseUrl}/admin/catalog/localizations?${params.toString()}`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await readApiError(response));
    const body = (await response.json()) as { items: LocalizationRow[] };
    setLocalizations(body.items);
  }, [entityId, entityType]);

  useEffect(() => {
    void loadEntities().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Catalog entities could not be loaded."),
    );
  }, [loadEntities]);

  useEffect(() => {
    setEntityId("");
    setDraft(emptyDraft());
    setLocalizations([]);
  }, [entityType]);

  useEffect(() => {
    void loadLocalizations().catch((caught) =>
      setError(
        caught instanceof Error ? caught.message : "Localized metadata could not be loaded.",
      ),
    );
  }, [loadLocalizations]);

  function selectLocalization(row: LocalizationRow) {
    setDraft({
      locale: row.locale,
      title: row.title ?? "",
      synopsis: row.synopsis ?? "",
      shortDescription: row.shortDescription ?? "",
      posterMediaAssetId: row.posterMediaAssetId ?? null,
      posterLabel: row.posterMediaAssetId ? "Localized poster override" : null,
      backdropMediaAssetId: row.backdropMediaAssetId ?? null,
      backdropLabel: row.backdropMediaAssetId ? "Localized backdrop override" : null,
    });
    setError(null);
    setMessage(null);
  }

  function beginLocale() {
    setDraft(emptyDraft());
    setError(null);
    setMessage(null);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!entityId) {
      setError("Choose a catalog entity first.");
      return;
    }
    setBusy("save");
    setError(null);
    setMessage(null);
    try {
      const body: Record<string, string | null> = {
        title: draft.title.trim() || null,
        shortDescription: draft.shortDescription.trim() || null,
      };
      if (entityType !== "SEASON") body.synopsis = draft.synopsis.trim() || null;
      if (entityType === "MOVIE" || entityType === "SERIES") {
        body.posterMediaAssetId = draft.posterMediaAssetId;
        body.backdropMediaAssetId = draft.backdropMediaAssetId;
      }
      const response = await fetch(
        `${apiBaseUrl}/admin/catalog/localizations/${entityType}/${entityId}/${encodeURIComponent(draft.locale.trim())}`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) throw new Error(await readApiError(response));
      setMessage(`Localized metadata saved for ${draft.locale.trim()}.`);
      await loadLocalizations();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Localized metadata could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: LocalizationRow) {
    if (!entityId) return;
    setBusy(`remove:${row.locale}`);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `${apiBaseUrl}/admin/catalog/localizations/${entityType}/${entityId}/${encodeURIComponent(row.locale)}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!response.ok) throw new Error(await readApiError(response));
      setMessage(`Removed ${row.locale} localized metadata.`);
      if (draft.locale.toLowerCase() === row.locale.toLowerCase()) setDraft(emptyDraft());
      await loadLocalizations();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Localized metadata could not be removed.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Catalog operations</span>
          <h1>Localized metadata</h1>
          <p className={styles.muted}>
            Edit human-provided catalog translations without duplicating Movies, Series, Seasons or
            Episodes. No automatic translation is performed.
          </p>
        </div>
        <button className={styles.button} onClick={beginLocale} type="button">
          New locale
        </button>
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}
      {message ? <div className={styles.notice}>{message}</div> : null}

      <section className={styles.card}>
        <div className={styles.formGrid}>
          <label>
            Catalog entity type
            <select
              value={entityType}
              onChange={(event) => setEntityType(event.target.value as EntityType)}
            >
              <option value="MOVIE">Movie</option>
              <option value="SERIES">Series</option>
              <option value="SEASON">Season</option>
              <option value="EPISODE">Episode</option>
            </select>
          </label>
          <label>
            Catalog entity
            <select
              value={entityId}
              onChange={(event) => {
                setEntityId(event.target.value);
                setDraft(emptyDraft());
                setMessage(null);
              }}
            >
              <option value="">Choose…</option>
              {entityOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.parentLabel ? ` — ${item.parentLabel}` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {entityId ? (
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <span className={styles.eyebrow}>Existing locales</span>
              <h2>
                {localizations.length
                  ? `${localizations.length} localized version${localizations.length === 1 ? "" : "s"}`
                  : "No localized metadata yet"}
              </h2>
            </div>
          </div>
          <div className={styles.searchResults}>
            {localizations.map((row) => (
              <div className={styles.searchResult} key={row.locale}>
                <button
                  className={styles.button}
                  onClick={() => selectLocalization(row)}
                  type="button"
                >
                  {row.locale}
                </button>
                <span>{row.title || "Uses primary title"}</span>
                <button
                  className={styles.danger}
                  disabled={Boolean(busy)}
                  onClick={() => void remove(row)}
                  type="button"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {entityId ? (
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <span className={styles.eyebrow}>Manual localization</span>
              <h2>{draft.locale || "New locale"}</h2>
              <p className={styles.muted}>
                Blank fields fall back to the primary/original catalog metadata, then the English
                global localization when applicable.
              </p>
            </div>
          </div>
          <form className={styles.formGrid} onSubmit={save}>
            <label>
              Locale
              <input
                required
                maxLength={35}
                placeholder="ar"
                value={draft.locale}
                onChange={(event) => setDraft({ ...draft, locale: event.target.value })}
              />
            </label>
            <label>
              Localized title
              <input
                maxLength={200}
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </label>
            {entityType !== "SEASON" ? (
              <label className={styles.fullField}>
                Localized synopsis
                <textarea
                  maxLength={20_000}
                  value={draft.synopsis}
                  onChange={(event) => setDraft({ ...draft, synopsis: event.target.value })}
                />
              </label>
            ) : null}
            <label className={styles.fullField}>
              Short description
              <textarea
                maxLength={500}
                value={draft.shortDescription}
                onChange={(event) => setDraft({ ...draft, shortDescription: event.target.value })}
              />
            </label>
            {entityType === "MOVIE" || entityType === "SERIES" ? (
              <>
                <div className={styles.fullField}>
                  <CatalogResourcePicker
                    kind="artwork"
                    label="Localized poster override"
                    value={draft.posterMediaAssetId}
                    selectedLabel={draft.posterLabel}
                    onChange={(id, label) =>
                      setDraft({ ...draft, posterMediaAssetId: id, posterLabel: label })
                    }
                  />
                </div>
                <div className={styles.fullField}>
                  <CatalogResourcePicker
                    kind="artwork"
                    label="Localized backdrop override"
                    value={draft.backdropMediaAssetId}
                    selectedLabel={draft.backdropLabel}
                    onChange={(id, label) =>
                      setDraft({ ...draft, backdropMediaAssetId: id, backdropLabel: label })
                    }
                  />
                </div>
              </>
            ) : null}
            <div className={`${styles.actions} ${styles.fullField}`}>
              <button className={styles.button} disabled={busy === "save"} type="submit">
                {busy === "save" ? "Saving…" : "Save localized metadata"}
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
