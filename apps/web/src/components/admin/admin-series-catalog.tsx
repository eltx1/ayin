"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { apiBaseUrl, readApiError } from "@/lib/api";
import { CatalogResourcePicker } from "./catalog-resource-picker";

type CatalogStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
type EpisodeStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
type ArtworkType = "POSTER" | "BACKDROP" | "LOGO";
type AvailabilityRule = "ALLOW" | "BLOCK";
type Validation = { status: "READY" | "BLOCKED"; publishable: boolean; issues: string[] };
type VideoRef = {
  id: string;
  title: string;
  slug: string;
  status?: string;
  visibility?: string;
} | null;

type ArtworkRow = {
  type: ArtworkType;
  mediaAssetId: string;
  altText: string | null;
  asset: {
    r2ObjectKey: string;
    width: number | null;
    height: number | null;
  } | null;
};

type AvailabilityRow = {
  territoryCode: string;
  rule: AvailabilityRule;
  startsAt: string | null;
  endsAt: string | null;
  note: string | null;
};

type EpisodeRow = {
  id: string;
  episodeNumber: number;
  title: string;
  synopsis: string;
  sortOrder: number;
  releaseDate: string | null;
  status: EpisodeStatus;
  videoId: string | null;
  video: VideoRef;
  validation: Validation;
};

type SeasonRow = {
  id: string;
  seasonNumber: number;
  title: string | null;
  sortOrder: number;
  artwork: ArtworkRow[];
  episodes: EpisodeRow[];
};

type SeriesRow = {
  id: string;
  title: string;
  slug: string;
  synopsis: string;
  status: CatalogStatus;
  releaseYear: number | null;
  maturityRating: string;
  originalLanguage: string;
  trailerVideoId: string | null;
  trailerVideo: VideoRef;
  genres: Array<{ name: string }>;
  artwork: ArtworkRow[];
  availability: AvailabilityRow[];
  seasons: SeasonRow[];
  validation: Validation;
};

type AvailabilityDraft = {
  territoryCode: string;
  rule: AvailabilityRule;
  startsAt: string;
  endsAt: string;
  note: string;
};

type ResourceSelection = { id: string | null; label: string | null };
type ArtworkSelections = Record<ArtworkType, ResourceSelection>;

type SeriesDraft = {
  title: string;
  slug: string;
  synopsis: string;
  releaseYear: string;
  maturityRating: string;
  originalLanguage: string;
  trailer: ResourceSelection;
  genres: string;
  artwork: ArtworkSelections;
  availability: AvailabilityDraft[];
};

type SeasonDraft = {
  seasonNumber: string;
  title: string;
  artwork: ArtworkSelections;
};

type EpisodeDraft = {
  episodeNumber: string;
  title: string;
  synopsis: string;
  releaseDate: string;
  video: ResourceSelection;
};

type Mutate = (key: string, url: string, init: RequestInit, success: string) => Promise<boolean>;

const emptyArtwork = (): ArtworkSelections => ({
  POSTER: { id: null, label: null },
  BACKDROP: { id: null, label: null },
  LOGO: { id: null, label: null },
});

const emptySeriesDraft = (): SeriesDraft => ({
  title: "",
  slug: "",
  synopsis: "",
  releaseYear: "",
  maturityRating: "TV-14",
  originalLanguage: "en",
  trailer: { id: null, label: null },
  genres: "",
  artwork: emptyArtwork(),
  availability: [],
});

const emptySeasonDraft = (): SeasonDraft => ({
  seasonNumber: "1",
  title: "",
  artwork: emptyArtwork(),
});

const emptyEpisodeDraft = (): EpisodeDraft => ({
  episodeNumber: "1",
  title: "",
  synopsis: "",
  releaseDate: "",
  video: { id: null, label: null },
});

export function AdminSeriesCatalog() {
  const [items, setItems] = useState<SeriesRow[]>([]);
  const [draft, setDraft] = useState<SeriesDraft>(emptySeriesDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"" | CatalogStatus>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: "100" });
    if (query.trim()) params.set("q", query.trim());
    if (status) params.set("status", status);
    const response = await fetch(`${apiBaseUrl}/admin/catalog/series?${params.toString()}`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await readApiError(response));
    const body = (await response.json()) as { items: SeriesRow[] };
    setItems(body.items);
    if (editingId) {
      const current = body.items.find((item) => item.id === editingId);
      if (current) setDraft(fromSeries(current));
    }
  }, [editingId, query, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Series catalog could not be loaded."),
      );
    }, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  const editing = useMemo(
    () => (editingId ? (items.find((item) => item.id === editingId) ?? null) : null),
    [editingId, items],
  );

  const mutate: Mutate = useCallback(
    async (key, url, init, success) => {
      setBusy(key);
      setError(null);
      setMessage(null);
      try {
        const requestInit: RequestInit = { ...init, credentials: "include" };
        if (init.body) {
          const headers = new Headers(init.headers);
          headers.set("content-type", "application/json");
          requestInit.headers = headers;
        }
        const response = await fetch(`${apiBaseUrl}${url}`, requestInit);
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
    },
    [load],
  );

  async function saveSeries(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = toSeriesPayload(draft);
    const ok = await mutate(
      "save-series",
      `/admin/catalog/series${editingId ? `/${editingId}` : ""}`,
      {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      },
      editingId ? "Series changes saved." : "Series draft created.",
    );
    if (!ok || editingId) return;
    const params = new URLSearchParams({ limit: "100", q: draft.title.trim() });
    const response = await fetch(`${apiBaseUrl}/admin/catalog/series?${params.toString()}`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) return;
    const body = (await response.json()) as { items: SeriesRow[] };
    const created = body.items[0];
    if (created) {
      setEditingId(created.id);
      setDraft(fromSeries(created));
    }
  }

  async function lifecycle(series: SeriesRow, action: "publish" | "unpublish" | "archive") {
    if (action === "archive" && !window.confirm(`Archive “${series.title}”?`)) return;
    await mutate(
      `${action}:${series.id}`,
      `/admin/catalog/series/${series.id}/${action}`,
      { method: "POST" },
      `Series ${action === "publish" ? "published" : action === "unpublish" ? "unpublished" : "archived"}.`,
    );
  }

  async function moveSeason(series: SeriesRow, index: number, delta: -1 | 1) {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= series.seasons.length) return;
    const ordered = series.seasons.map((season) => season.id);
    [ordered[index], ordered[nextIndex]] = [ordered[nextIndex]!, ordered[index]!];
    await mutate(
      `reorder-seasons:${series.id}`,
      `/admin/catalog/series/${series.id}/seasons/reorder`,
      { method: "POST", body: JSON.stringify({ orderedIds: ordered }) },
      "Season ordering updated.",
    );
  }

  function beginEdit(series: SeriesRow) {
    setEditingId(series.id);
    setDraft(fromSeries(series));
    setError(null);
    setMessage(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function beginCreate() {
    setEditingId(null);
    setDraft(emptySeriesDraft());
    setError(null);
    setMessage(null);
  }

  return (
    <>
      <section className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Catalog operations</span>
          <h1>Series</h1>
          <p className={styles.muted}>
            Manage Series, Seasons and Episodes as deliberate catalog records. Playable media is
            selected by title and channel context, while internal database identifiers stay hidden.
          </p>
        </div>
        <button className={styles.button} onClick={beginCreate} type="button">
          New series draft
        </button>
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}
      {message ? <div className={styles.notice}>{message}</div> : null}

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <span className={styles.eyebrow}>{editing ? "Edit series" : "Create draft"}</span>
            <h2>{editing?.title ?? "New series"}</h2>
          </div>
          {editing ? (
            <ValidationBadge validation={editing.validation} />
          ) : (
            <span className={styles.statusPill}>DRAFT</span>
          )}
        </div>

        {editing?.validation.issues.length ? (
          <div className={styles.error}>Validation: {editing.validation.issues.join(" · ")}</div>
        ) : null}

        <form className={styles.formGrid} onSubmit={saveSeries}>
          <label>
            Title
            <input
              disabled={editing?.status === "ARCHIVED"}
              maxLength={200}
              required
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          <label>
            Slug
            <input
              disabled={editing?.status === "ARCHIVED"}
              maxLength={160}
              placeholder="generated from title when blank"
              value={draft.slug}
              onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
            />
          </label>
          <label className={styles.fullField}>
            Synopsis
            <textarea
              disabled={editing?.status === "ARCHIVED"}
              required
              value={draft.synopsis}
              onChange={(event) => setDraft({ ...draft, synopsis: event.target.value })}
            />
          </label>
          <label>
            Release year
            <input
              disabled={editing?.status === "ARCHIVED"}
              max="2200"
              min="1888"
              placeholder="Optional"
              type="number"
              value={draft.releaseYear}
              onChange={(event) => setDraft({ ...draft, releaseYear: event.target.value })}
            />
          </label>
          <label>
            Maturity
            <input
              disabled={editing?.status === "ARCHIVED"}
              maxLength={32}
              placeholder="TV-14"
              required
              value={draft.maturityRating}
              onChange={(event) => setDraft({ ...draft, maturityRating: event.target.value })}
            />
          </label>
          <label>
            Original language
            <input
              disabled={editing?.status === "ARCHIVED"}
              maxLength={16}
              placeholder="en"
              required
              value={draft.originalLanguage}
              onChange={(event) => setDraft({ ...draft, originalLanguage: event.target.value })}
            />
          </label>
          <label>
            Genres / categories
            <input
              disabled={editing?.status === "ARCHIVED"}
              placeholder="Drama, Mystery"
              required
              value={draft.genres}
              onChange={(event) => setDraft({ ...draft, genres: event.target.value })}
            />
          </label>
          <div className={styles.fullField}>
            <CatalogResourcePicker
              disabled={editing?.status === "ARCHIVED"}
              kind="video"
              label="Series trailer"
              selectedLabel={draft.trailer.label}
              value={draft.trailer.id}
              onChange={(id, label) => setDraft({ ...draft, trailer: { id, label } })}
            />
          </div>

          {(["POSTER", "BACKDROP", "LOGO"] as const).map((type) => (
            <div className={styles.fullField} key={type}>
              <CatalogResourcePicker
                disabled={editing?.status === "ARCHIVED"}
                kind="artwork"
                label={`${titleCase(type)} artwork`}
                required={type === "POSTER"}
                selectedLabel={draft.artwork[type].label}
                value={draft.artwork[type].id}
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
                <p className={styles.muted}>
                  Leave empty for unrestricted Series availability, or add explicit global/territory
                  rules with optional windows.
                </p>
              </div>
              <button
                className={styles.button}
                disabled={editing?.status === "ARCHIVED"}
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
                  <input
                    disabled={editing?.status === "ARCHIVED"}
                    maxLength={2}
                    value={rule.territoryCode}
                    onChange={(event) =>
                      updateAvailability(setDraft, draft, index, {
                        territoryCode: event.target.value.toUpperCase(),
                      })
                    }
                  />
                </label>
                <label>
                  Rule
                  <select
                    disabled={editing?.status === "ARCHIVED"}
                    value={rule.rule}
                    onChange={(event) =>
                      updateAvailability(setDraft, draft, index, {
                        rule: event.target.value as AvailabilityRule,
                      })
                    }
                  >
                    <option value="ALLOW">Allow</option>
                    <option value="BLOCK">Block</option>
                  </select>
                </label>
                <label>
                  Starts
                  <input
                    disabled={editing?.status === "ARCHIVED"}
                    type="datetime-local"
                    value={rule.startsAt}
                    onChange={(event) =>
                      updateAvailability(setDraft, draft, index, { startsAt: event.target.value })
                    }
                  />
                </label>
                <label>
                  Ends
                  <input
                    disabled={editing?.status === "ARCHIVED"}
                    type="datetime-local"
                    value={rule.endsAt}
                    onChange={(event) =>
                      updateAvailability(setDraft, draft, index, { endsAt: event.target.value })
                    }
                  />
                </label>
                <label className={styles.fullField}>
                  Note
                  <input
                    disabled={editing?.status === "ARCHIVED"}
                    maxLength={240}
                    value={rule.note}
                    onChange={(event) =>
                      updateAvailability(setDraft, draft, index, { note: event.target.value })
                    }
                  />
                </label>
                <div className={`${styles.actions} ${styles.fullField}`}>
                  <button
                    className={styles.danger}
                    disabled={editing?.status === "ARCHIVED"}
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        availability: draft.availability.filter(
                          (_, itemIndex) => itemIndex !== index,
                        ),
                      })
                    }
                  >
                    Remove rule
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className={`${styles.actions} ${styles.fullField}`}>
            <button
              className={styles.button}
              disabled={busy === "save-series" || editing?.status === "ARCHIVED"}
              type="submit"
            >
              {busy === "save-series" ? "Saving…" : editingId ? "Save series" : "Create draft"}
            </button>
            {editing?.status === "DRAFT" ? (
              <>
                <button
                  className={styles.button}
                  disabled={Boolean(busy) || !editing.validation.publishable}
                  type="button"
                  onClick={() => void lifecycle(editing, "publish")}
                >
                  Publish series
                </button>
                <button
                  className={styles.danger}
                  disabled={Boolean(busy)}
                  type="button"
                  onClick={() => void lifecycle(editing, "archive")}
                >
                  Archive
                </button>
              </>
            ) : null}
            {editing?.status === "PUBLISHED" ? (
              <button
                className={styles.danger}
                disabled={Boolean(busy)}
                type="button"
                onClick={() => void lifecycle(editing, "unpublish")}
              >
                Unpublish series
              </button>
            ) : null}
          </div>
        </form>
      </section>

      {editing && editing.status !== "ARCHIVED" ? (
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <span className={styles.eyebrow}>Season & episode management</span>
              <h2>{editing.title}</h2>
              <p className={styles.muted}>
                Ordering is conflict-safe. Episodes must reference an accessible playable Video
                before publication.
              </p>
            </div>
            <span className={styles.statusPill}>{editing.seasons.length} seasons</span>
          </div>

          <NewSeasonForm busy={busy} mutate={mutate} series={editing} />

          <div className={styles.grid}>
            {editing.seasons.map((season, seasonIndex) => (
              <section className={styles.cardInset} key={season.id}>
                <div className={styles.cardHeader}>
                  <div>
                    <strong>{season.title || `Season ${season.seasonNumber}`}</strong>
                    <p className={styles.muted}>
                      Season {season.seasonNumber} · catalog position {seasonIndex + 1} ·{" "}
                      {season.episodes.length} episodes
                    </p>
                  </div>
                  <div className={styles.actions}>
                    <button
                      aria-label={`Move season ${season.seasonNumber} up`}
                      className={styles.button}
                      disabled={seasonIndex === 0 || busy === `reorder-seasons:${editing.id}`}
                      type="button"
                      onClick={() => void moveSeason(editing, seasonIndex, -1)}
                    >
                      ↑
                    </button>
                    <button
                      aria-label={`Move season ${season.seasonNumber} down`}
                      className={styles.button}
                      disabled={
                        seasonIndex === editing.seasons.length - 1 ||
                        busy === `reorder-seasons:${editing.id}`
                      }
                      type="button"
                      onClick={() => void moveSeason(editing, seasonIndex, 1)}
                    >
                      ↓
                    </button>
                  </div>
                </div>

                <SeasonEditor busy={busy} mutate={mutate} season={season} />
                <NewEpisodeForm busy={busy} mutate={mutate} season={season} />

                <div className={styles.grid}>
                  {season.episodes.map((episode, episodeIndex) => (
                    <EpisodeEditor
                      busy={busy}
                      episode={episode}
                      episodeIndex={episodeIndex}
                      key={episode.id}
                      mutate={mutate}
                      season={season}
                    />
                  ))}
                  {!season.episodes.length ? (
                    <p className={styles.muted}>No episodes in this season yet.</p>
                  ) : null}
                </div>
              </section>
            ))}
            {!editing.seasons.length ? (
              <p className={styles.muted}>Add the first season to start episode management.</p>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <span className={styles.eyebrow}>Catalog browser</span>
            <h2>Series</h2>
          </div>
          <span className={styles.statusPill}>{items.length} results</span>
        </div>
        <div className={styles.toolbar}>
          <input
            placeholder="Search title, slug, synopsis or genre…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Series</th>
                <th>Status</th>
                <th>Validation</th>
                <th>Seasons</th>
                <th>Episodes</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((series) => (
                <tr key={series.id}>
                  <td>
                    <strong>{series.title}</strong>
                    <div className={styles.muted}>
                      /{series.slug} · {series.releaseYear ?? "year unset"} ·{" "}
                      {series.originalLanguage.toUpperCase()}
                    </div>
                  </td>
                  <td>
                    <span className={styles.statusPill}>{series.status}</span>
                  </td>
                  <td>
                    <ValidationBadge validation={series.validation} />
                  </td>
                  <td>{series.seasons.length}</td>
                  <td>
                    {series.seasons.reduce((total, season) => total + season.episodes.length, 0)}
                  </td>
                  <td>
                    <button
                      className={styles.button}
                      type="button"
                      onClick={() => beginEdit(series)}
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
              {!items.length ? (
                <tr>
                  <td colSpan={6} className={styles.muted}>
                    No series match these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function NewSeasonForm({
  series,
  mutate,
  busy,
}: {
  series: SeriesRow;
  mutate: Mutate;
  busy: string | null;
}) {
  const [draft, setDraft] = useState<SeasonDraft>(emptySeasonDraft);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await mutate(
      `create-season:${series.id}`,
      `/admin/catalog/series/${series.id}/seasons`,
      {
        method: "POST",
        body: JSON.stringify({
          seasonNumber: Number(draft.seasonNumber),
          title: draft.title.trim() || null,
          artwork: artworkPayload(draft.artwork, `Season ${draft.seasonNumber}`),
        }),
      },
      `Season ${draft.seasonNumber} created.`,
    );
    if (ok) setDraft(emptySeasonDraft());
  }

  return (
    <form className={styles.cardInset} onSubmit={submit}>
      <div className={styles.cardHeader}>
        <div>
          <strong>Add season</strong>
          <p className={styles.muted}>Create the season as a catalog child; artwork is optional.</p>
        </div>
      </div>
      <div className={styles.formGrid}>
        <label>
          Season number
          <input
            min="0"
            required
            type="number"
            value={draft.seasonNumber}
            onChange={(event) => setDraft({ ...draft, seasonNumber: event.target.value })}
          />
        </label>
        <label>
          Title
          <input
            maxLength={200}
            placeholder="Optional"
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>
        <div className={styles.fullField}>
          <CatalogResourcePicker
            kind="artwork"
            label="Season poster"
            selectedLabel={draft.artwork.POSTER.label}
            value={draft.artwork.POSTER.id}
            onChange={(id, label) =>
              setDraft({ ...draft, artwork: { ...draft.artwork, POSTER: { id, label } } })
            }
          />
        </div>
        <div className={`${styles.actions} ${styles.fullField}`}>
          <button
            className={styles.button}
            disabled={busy === `create-season:${series.id}`}
            type="submit"
          >
            Add season
          </button>
        </div>
      </div>
    </form>
  );
}

function SeasonEditor({
  season,
  mutate,
  busy,
}: {
  season: SeasonRow;
  mutate: Mutate;
  busy: string | null;
}) {
  const [draft, setDraft] = useState<SeasonDraft>(() => fromSeason(season));

  useEffect(() => {
    const timer = window.setTimeout(() => setDraft(fromSeason(season)), 0);
    return () => window.clearTimeout(timer);
  }, [season]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutate(
      `save-season:${season.id}`,
      `/admin/catalog/series/seasons/${season.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          seasonNumber: Number(draft.seasonNumber),
          title: draft.title.trim() || null,
          artwork: artworkPayload(draft.artwork, `Season ${draft.seasonNumber}`),
        }),
      },
      `Season ${draft.seasonNumber} saved.`,
    );
  }

  return (
    <form className={styles.formGrid} onSubmit={submit}>
      <label>
        Season number
        <input
          min="0"
          required
          type="number"
          value={draft.seasonNumber}
          onChange={(event) => setDraft({ ...draft, seasonNumber: event.target.value })}
        />
      </label>
      <label>
        Season title
        <input
          maxLength={200}
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
      </label>
      {(["POSTER", "BACKDROP", "LOGO"] as const).map((type) => (
        <div className={styles.fullField} key={type}>
          <CatalogResourcePicker
            kind="artwork"
            label={`Season ${titleCase(type)}`}
            selectedLabel={draft.artwork[type].label}
            value={draft.artwork[type].id}
            onChange={(id, label) =>
              setDraft({ ...draft, artwork: { ...draft.artwork, [type]: { id, label } } })
            }
          />
        </div>
      ))}
      <div className={`${styles.actions} ${styles.fullField}`}>
        <button
          className={styles.button}
          disabled={busy === `save-season:${season.id}`}
          type="submit"
        >
          Save season metadata
        </button>
      </div>
    </form>
  );
}

function NewEpisodeForm({
  season,
  mutate,
  busy,
}: {
  season: SeasonRow;
  mutate: Mutate;
  busy: string | null;
}) {
  const [draft, setDraft] = useState<EpisodeDraft>(emptyEpisodeDraft);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ok = await mutate(
      `create-episode:${season.id}`,
      `/admin/catalog/series/seasons/${season.id}/episodes`,
      {
        method: "POST",
        body: JSON.stringify({
          episodeNumber: Number(draft.episodeNumber),
          title: draft.title.trim(),
          synopsis: draft.synopsis.trim(),
          releaseDate: draft.releaseDate ? new Date(draft.releaseDate).toISOString() : null,
          videoId: draft.video.id,
        }),
      },
      `Episode ${draft.episodeNumber} created.`,
    );
    if (ok) setDraft(emptyEpisodeDraft());
  }

  return (
    <form className={styles.cardInset} onSubmit={submit}>
      <div className={styles.cardHeader}>
        <div>
          <strong>Add episode</strong>
          <p className={styles.muted}>
            Draft episodes may omit playback; publication requires a playable Video.
          </p>
        </div>
      </div>
      <div className={styles.formGrid}>
        <label>
          Episode number
          <input
            min="0"
            required
            type="number"
            value={draft.episodeNumber}
            onChange={(event) => setDraft({ ...draft, episodeNumber: event.target.value })}
          />
        </label>
        <label>
          Title
          <input
            maxLength={200}
            required
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>
        <label>
          Release date
          <input
            type="datetime-local"
            value={draft.releaseDate}
            onChange={(event) => setDraft({ ...draft, releaseDate: event.target.value })}
          />
        </label>
        <label className={styles.fullField}>
          Synopsis
          <textarea
            required
            value={draft.synopsis}
            onChange={(event) => setDraft({ ...draft, synopsis: event.target.value })}
          />
        </label>
        <div className={styles.fullField}>
          <CatalogResourcePicker
            kind="video"
            label="Episode playback"
            selectedLabel={draft.video.label}
            value={draft.video.id}
            onChange={(id, label) => setDraft({ ...draft, video: { id, label } })}
          />
        </div>
        <div className={`${styles.actions} ${styles.fullField}`}>
          <button
            className={styles.button}
            disabled={busy === `create-episode:${season.id}`}
            type="submit"
          >
            Add episode draft
          </button>
        </div>
      </div>
    </form>
  );
}

function EpisodeEditor({
  season,
  episode,
  episodeIndex,
  mutate,
  busy,
}: {
  season: SeasonRow;
  episode: EpisodeRow;
  episodeIndex: number;
  mutate: Mutate;
  busy: string | null;
}) {
  const [draft, setDraft] = useState<EpisodeDraft>(() => fromEpisode(episode));

  useEffect(() => {
    const timer = window.setTimeout(() => setDraft(fromEpisode(episode)), 0);
    return () => window.clearTimeout(timer);
  }, [episode]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutate(
      `save-episode:${episode.id}`,
      `/admin/catalog/series/episodes/${episode.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          episodeNumber: Number(draft.episodeNumber),
          title: draft.title.trim(),
          synopsis: draft.synopsis.trim(),
          releaseDate: draft.releaseDate ? new Date(draft.releaseDate).toISOString() : null,
          videoId: draft.video.id,
        }),
      },
      `${draft.title || `Episode ${draft.episodeNumber}`} saved.`,
    );
  }

  async function lifecycle(action: "publish" | "unpublish") {
    await mutate(
      `${action}-episode:${episode.id}`,
      `/admin/catalog/series/episodes/${episode.id}/${action}`,
      { method: "POST" },
      `${episode.title} ${action === "publish" ? "published" : "unpublished"}.`,
    );
  }

  async function move(delta: -1 | 1) {
    const nextIndex = episodeIndex + delta;
    if (nextIndex < 0 || nextIndex >= season.episodes.length) return;
    const ordered = season.episodes.map((item) => item.id);
    [ordered[episodeIndex], ordered[nextIndex]] = [ordered[nextIndex]!, ordered[episodeIndex]!];
    await mutate(
      `reorder-episodes:${season.id}`,
      `/admin/catalog/series/seasons/${season.id}/episodes/reorder`,
      { method: "POST", body: JSON.stringify({ orderedIds: ordered }) },
      "Episode ordering updated.",
    );
  }

  return (
    <article className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <strong>
            E{episode.episodeNumber} · {episode.title}
          </strong>
          <p className={styles.muted}>
            {episode.status} · catalog position {episodeIndex + 1} ·{" "}
            {episode.video?.title ?? "playback not assigned"}
          </p>
        </div>
        <ValidationBadge validation={episode.validation} />
      </div>
      {episode.validation.issues.length ? (
        <div className={styles.error}>Validation: {episode.validation.issues.join(" · ")}</div>
      ) : null}
      <form className={styles.formGrid} onSubmit={save}>
        <label>
          Episode number
          <input
            min="0"
            required
            type="number"
            value={draft.episodeNumber}
            onChange={(event) => setDraft({ ...draft, episodeNumber: event.target.value })}
          />
        </label>
        <label>
          Title
          <input
            maxLength={200}
            required
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </label>
        <label>
          Release date
          <input
            type="datetime-local"
            value={draft.releaseDate}
            onChange={(event) => setDraft({ ...draft, releaseDate: event.target.value })}
          />
        </label>
        <label className={styles.fullField}>
          Synopsis
          <textarea
            required
            value={draft.synopsis}
            onChange={(event) => setDraft({ ...draft, synopsis: event.target.value })}
          />
        </label>
        <div className={styles.fullField}>
          <CatalogResourcePicker
            kind="video"
            label="Episode playback"
            required={episode.status === "PUBLISHED"}
            selectedLabel={draft.video.label}
            value={draft.video.id}
            onChange={(id, label) => setDraft({ ...draft, video: { id, label } })}
          />
        </div>
        <div className={`${styles.actions} ${styles.fullField}`}>
          <button
            className={styles.button}
            disabled={busy === `save-episode:${episode.id}`}
            type="submit"
          >
            Save episode
          </button>
          <button
            aria-label={`Move ${episode.title} up`}
            className={styles.button}
            disabled={episodeIndex === 0 || busy === `reorder-episodes:${season.id}`}
            type="button"
            onClick={() => void move(-1)}
          >
            ↑
          </button>
          <button
            aria-label={`Move ${episode.title} down`}
            className={styles.button}
            disabled={
              episodeIndex === season.episodes.length - 1 ||
              busy === `reorder-episodes:${season.id}`
            }
            type="button"
            onClick={() => void move(1)}
          >
            ↓
          </button>
          {episode.status === "DRAFT" ? (
            <button
              className={styles.button}
              disabled={Boolean(busy) || !episode.validation.publishable}
              type="button"
              onClick={() => void lifecycle("publish")}
            >
              Publish episode
            </button>
          ) : null}
          {episode.status === "PUBLISHED" ? (
            <button
              className={styles.danger}
              disabled={Boolean(busy)}
              type="button"
              onClick={() => void lifecycle("unpublish")}
            >
              Unpublish episode
            </button>
          ) : null}
        </div>
      </form>
    </article>
  );
}

function ValidationBadge({ validation }: { validation: Validation }) {
  return (
    <span className={styles.statusPill} title={validation.issues.join(", ") || "Ready to publish"}>
      {validation.status === "READY" ? "READY" : `${validation.issues.length} BLOCKERS`}
    </span>
  );
}

function fromSeries(series: SeriesRow): SeriesDraft {
  return {
    title: series.title,
    slug: series.slug,
    synopsis: series.synopsis,
    releaseYear: series.releaseYear === null ? "" : String(series.releaseYear),
    maturityRating: series.maturityRating,
    originalLanguage: series.originalLanguage,
    trailer: {
      id: series.trailerVideoId,
      label: series.trailerVideo
        ? `${series.trailerVideo.title} · /${series.trailerVideo.slug}`
        : null,
    },
    genres: series.genres.map((genre) => genre.name).join(", "),
    artwork: artworkSelections(series.artwork),
    availability: series.availability.map((rule) => ({
      territoryCode: rule.territoryCode,
      rule: rule.rule,
      startsAt: toLocalInput(rule.startsAt),
      endsAt: toLocalInput(rule.endsAt),
      note: rule.note ?? "",
    })),
  };
}

function fromSeason(season: SeasonRow): SeasonDraft {
  return {
    seasonNumber: String(season.seasonNumber),
    title: season.title ?? "",
    artwork: artworkSelections(season.artwork),
  };
}

function fromEpisode(episode: EpisodeRow): EpisodeDraft {
  return {
    episodeNumber: String(episode.episodeNumber),
    title: episode.title,
    synopsis: episode.synopsis,
    releaseDate: toLocalInput(episode.releaseDate),
    video: {
      id: episode.videoId,
      label: episode.video ? `${episode.video.title} · /${episode.video.slug}` : null,
    },
  };
}

function toSeriesPayload(draft: SeriesDraft) {
  return {
    title: draft.title.trim(),
    ...(draft.slug.trim() ? { slug: draft.slug.trim() } : {}),
    synopsis: draft.synopsis.trim(),
    releaseYear: draft.releaseYear.trim() ? Number(draft.releaseYear) : null,
    maturityRating: draft.maturityRating.trim(),
    originalLanguage: draft.originalLanguage.trim(),
    trailerVideoId: draft.trailer.id,
    genres: csv(draft.genres),
    artwork: artworkPayload(draft.artwork, draft.title.trim() || "Series"),
    availability: draft.availability.map((rule) => ({
      territoryCode: rule.territoryCode.trim().toUpperCase(),
      rule: rule.rule,
      startsAt: rule.startsAt ? new Date(rule.startsAt).toISOString() : null,
      endsAt: rule.endsAt ? new Date(rule.endsAt).toISOString() : null,
      note: rule.note.trim() || null,
    })),
  };
}

function artworkPayload(artwork: ArtworkSelections, label: string) {
  return (Object.keys(artwork) as ArtworkType[]).flatMap((type) => {
    const selection = artwork[type];
    return selection.id
      ? [{ type, mediaAssetId: selection.id, altText: `${label} ${type.toLowerCase()}` }]
      : [];
  });
}

function artworkSelections(rows: ArtworkRow[]): ArtworkSelections {
  const next = emptyArtwork();
  for (const row of rows) {
    next[row.type] = {
      id: row.mediaAssetId,
      label: artworkLabel(row),
    };
  }
  return next;
}

function artworkLabel(row: ArtworkRow) {
  const objectName = row.asset?.r2ObjectKey.split("/").at(-1) ?? titleCase(row.type);
  const dimensions =
    row.asset?.width && row.asset.height ? ` · ${row.asset.width}×${row.asset.height}` : "";
  return `${objectName}${dimensions}`;
}

function updateAvailability(
  setDraft: React.Dispatch<React.SetStateAction<SeriesDraft>>,
  draft: SeriesDraft,
  index: number,
  patch: Partial<AvailabilityDraft>,
) {
  setDraft({
    ...draft,
    availability: draft.availability.map((rule, itemIndex) =>
      itemIndex === index ? { ...rule, ...patch } : rule,
    ),
  });
}

function csv(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function titleCase(value: string) {
  return `${value[0]}${value.slice(1).toLowerCase()}`;
}

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
