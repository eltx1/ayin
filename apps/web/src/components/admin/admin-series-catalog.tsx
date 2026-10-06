"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import {
  catalogRecord,
  catalogList,
  catalogChildAcknowledged,
} from "@/lib/catalog-editor-contract";
import { useI18n } from "@/components/i18n/i18n-provider";
import { ActionButton } from "@/components/ui/design-system";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  CatalogEditorWorkspace,
  useCatalogRequest,
  useCatalogDrafts,
  useCatalogDirty,
  useCatalogTarget,
  draftChanged,
  changedCatalogFields,
  catalogOutcomeUncertain,
} from "./catalog-editor-workspace";
import { CatalogValidationIssues } from "./catalog-validation";
import { catalogValidationReason } from "@/lib/catalog-validation-copy";
import { catalogFormFingerprint } from "@/lib/catalog-draft-retention";
import { useCatalogCopy } from "./catalog-editor-copy";
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

type ResourceSelection = { id: string | null; label: string | null; altText?: string | null };
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

type MutationResult = {
  series?: SeriesRow;
  season?: SeasonRow;
  episode?: EpisodeRow;
  authoritative?: SeriesRow;
};
type Mutate = (
  key: string,
  url: string,
  init: RequestInit,
  success: string,
) => Promise<MutationResult | null>;

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
  return (
    <CatalogEditorWorkspace kind="series">
      <SeriesCatalogContent />
    </CatalogEditorWorkspace>
  );
}

function SeriesCatalogContent() {
  const t = useCatalogCopy();
  const { direction } = useI18n();
  const { request, current } = useCatalogRequest();
  const {
    navigate,
    dirty,
    restoredForm,
    restoredRecord,
    restoredBlocked,
    markPending,
    acknowledgeRecord,
    clearRestoration,
  } = useCatalogDrafts();
  const recovered = restoredForm<SeriesDraft>("series");
  const initialRecord = restoredRecord<SeriesRow>();
  const [items, setItems] = useState<SeriesRow[]>([]);
  const [draft, setDraft] = useState<SeriesDraft>(
    () => recovered?.draft ?? (initialRecord ? fromSeries(initialRecord) : emptySeriesDraft()),
  );
  const [baseline, setBaseline] = useState<SeriesDraft>(
    () => recovered?.baseline ?? (initialRecord ? fromSeries(initialRecord) : emptySeriesDraft()),
  );
  const [sourceFingerprint, setSourceFingerprint] = useState(
    () => recovered?.sourceFingerprint ?? catalogFormFingerprint("series", initialRecord),
  );
  const [editing, setEditing] = useState<SeriesRow | null>(initialRecord);
  const editingId = editing?.id ?? null;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"" | CatalogStatus>("");
  const [busy, setBusy] = useState<string | null>(null);
  const lock = useRef(false);
  const [writeBlocked, setWriteBlocked] = useState(restoredBlocked);
  const [editorRevision, setEditorRevision] = useState(0);
  const reads = useRef(0);
  const cancelBrowseReads = useCallback(() => {
    reads.current++;
  }, []);
  const browseKey = `${query}\0${status}`;
  const latestBrowseKey = useRef(browseKey);
  useLayoutEffect(() => {
    latestBrowseKey.current = browseKey;
  }, [browseKey]);
  const targetRead = useRef(0);
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"publish" | "unpublish" | "archive" | null>(null);

  const load = useCallback(async () => {
    if (latestBrowseKey.current !== browseKey) return;
    const read = ++reads.current;
    const params = new URLSearchParams({ limit: "100" });
    if (query.trim()) params.set("q", query.trim());
    if (status) params.set("status", status);
    const body = await request<{ items: SeriesRow[] }>(`/admin/catalog/series?${params}`);
    if (read === reads.current && latestBrowseKey.current === browseKey && current())
      setItems(catalogList<SeriesRow>(body, "series"));
  }, [query, status, request, current, browseKey]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((caught: unknown) => {
        if (current())
          setError(
            caught instanceof Error ? caught.message : t("Series catalog could not be loaded."),
          );
      });
    }, 200);
    return () => {
      cancelBrowseReads();
      window.clearTimeout(timer);
    };
  }, [load, current, t, cancelBrowseReads]);

  const refreshSelected = useCallback(
    async (id: string) => {
      const body = await request<{ series: SeriesRow }>(`/admin/catalog/series/${id}`);
      body.series = catalogRecord<SeriesRow>(body, "series", id);
      if (current()) {
        acknowledgeRecord(body.series);
        setEditing(body.series);
      }
      return body.series;
    },
    [current, request, acknowledgeRecord],
  );

  const mutate: Mutate = async (key, url, init, success) => {
    if (lock.current || writeBlocked || !current()) return null;
    lock.current = true;
    markPending(true);
    setBusy(key);
    setError(null);
    setMessage(null);
    let result: MutationResult;
    try {
      result = await request<MutationResult>(url, init);
      if (
        key === "save-series" ||
        (!key.includes("episode") && !key.includes("create-season") && !key.includes("save-season"))
      ) {
        result.series = catalogRecord<SeriesRow>(result, "series", editingId ?? undefined);
      } else {
        const [operation, id] = key.split(":");
        const kind =
          operation?.includes("episode") && operation !== "reorder-episodes" ? "episode" : "season";
        const parentId =
          kind === "season"
            ? editingId
            : operation === "create-episode"
              ? id
              : editing?.seasons.find((item) => item.episodes.some((episode) => episode.id === id))
                  ?.id;
        if (
          !parentId ||
          !catalogChildAcknowledged(
            result,
            kind,
            operation?.startsWith("create-") ? null : (id ?? null),
            { key: kind === "season" ? "seriesId" : "seasonId", id: parentId },
          )
        )
          throw new Error(t("The save result could not be verified. Refresh before trying again."));
      }
      clearRestoration();
      if (result.series) acknowledgeRecord(result.series);
      else markPending(false);
      setMessage(success);
    } catch (caught) {
      if (current() && catalogOutcomeUncertain(caught)) {
        setWriteBlocked(true);
        markPending(false, true);
      }
      if (current())
        setError(
          caught instanceof Error
            ? caught.message
            : t("The outcome is uncertain. Refresh the record before trying again."),
        );
      lock.current = false;
      markPending(false);
      if (current()) setBusy(null);
      return null;
    }
    // A successful write is acknowledged independently of later read failures.
    try {
      if (result.series) {
        setEditing(result.series);
        result.authoritative = result.series;
      } else if (editingId) result.authoritative = await refreshSelected(editingId);
      await load();
    } catch {
      if (current())
        setError(
          t(
            "Changes were saved, but the catalog could not refresh. Use Refresh record; do not submit again.",
          ),
        );
    } finally {
      lock.current = false;
      markPending(false);
      if (current()) setBusy(null);
    }
    return current() ? result : null;
  };

  async function saveDraft() {
    if (!form.current?.reportValidity()) return false;
    const body = await mutate(
      "save-series",
      `/admin/catalog/series${editingId ? `/${editingId}` : ""}`,
      {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(
          editingId
            ? changedCatalogFields(toSeriesPayload(baseline), toSeriesPayload(draft))
            : toSeriesPayload(draft),
        ),
      },
      t(editingId ? "Series changes saved." : "Series draft created."),
    );
    if (!body?.series || (editingId && body.series.id !== editingId)) return false;
    // The returned stable identity is authoritative even with duplicate titles.
    setEditing(body.series);
    setSourceFingerprint(catalogFormFingerprint("series", body.series));
    const saved = fromSeries(body.series);
    setDraft(saved);
    setBaseline(saved);
    return true;
  }
  useCatalogDirty("series", draftChanged(draft, baseline), saveDraft, {
    draft,
    baseline,
    sourceFingerprint,
  });
  useCatalogTarget(editing, writeBlocked);
  async function saveSeries(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveDraft();
  }

  async function lifecycle(series: SeriesRow, action: "publish" | "unpublish" | "archive") {
    if (dirty || lock.current) return;
    setConfirm(null);
    const ack = await mutate(
      `${action}:${series.id}`,
      `/admin/catalog/series/${series.id}/${action}`,
      { method: "POST" },
      t(
        action === "publish"
          ? "Series published."
          : action === "unpublish"
            ? "Series unpublished."
            : "Series archived.",
      ),
    );
    if (ack?.series) setSourceFingerprint(catalogFormFingerprint("series", ack.series));
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
      t("Season ordering updated."),
    );
  }

  async function openSeries(series: SeriesRow) {
    if (lock.current) return;
    const read = ++targetRead.current;
    setBusy("open");
    setError(null);
    setMessage(null);
    try {
      const body = await request<{ series: SeriesRow }>(`/admin/catalog/series/${series.id}`);
      if (read !== targetRead.current || !current()) return;
      body.series = catalogRecord<SeriesRow>(body, "series", series.id);
      clearRestoration();
      setEditing(body.series);
      setSourceFingerprint(catalogFormFingerprint("series", body.series));
      setWriteBlocked(false);
      setEditorRevision((value) => value + 1);
      setDraft(fromSeries(body.series));
      setBaseline(fromSeries(body.series));
    } catch (caught) {
      if (read === targetRead.current && current())
        setError(
          caught instanceof Error ? caught.message : t("Series catalog could not be loaded."),
        );
    } finally {
      if (read === targetRead.current && current()) setBusy(null);
    }
  }
  function beginEdit(series: SeriesRow) {
    if (!lock.current)
      navigate(() => {
        void openSeries(series);
      });
  }
  function beginCreate() {
    if (lock.current) return;
    navigate(() => {
      ++targetRead.current;
      clearRestoration();
      setBusy(null);
      setEditing(null);
      setSourceFingerprint(null);
      setWriteBlocked(false);
      setEditorRevision((value) => value + 1);
      const next = emptySeriesDraft();
      setDraft(next);
      setBaseline(next);
      setError(null);
      setMessage(null);
    });
  }
  return (
    <>
      <section className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{t("Catalog operations")}</span>
          <h1>{t("Series")}</h1>
          <p className={styles.muted}>
            {t(
              "Manage Series, Seasons and Episodes as deliberate catalog records. Playable media is selected by title and channel context, while internal database identifiers stay hidden.",
            )}
          </p>
        </div>
        <ActionButton className={styles.button} onClick={beginCreate} type="button">
          {t("New series draft")}
        </ActionButton>
      </section>

      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      {writeBlocked ? (
        <div className={styles.error} role="alert">
          {t(
            "The outcome is uncertain. Reopen a saved record to review it before making another change. No request was repeated.",
          )}
        </div>
      ) : null}
      {message ? (
        <div className={styles.notice} role="status">
          {message}
        </div>
      ) : null}

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <span className={styles.eyebrow}>{editing ? t("Edit series") : t("Create draft")}</span>
            <h2>{editing?.title ?? t("New series")}</h2>
          </div>
          {editing ? (
            <ValidationBadge validation={editing.validation} />
          ) : (
            <span className={styles.statusPill}>{t("DRAFT")}</span>
          )}
        </div>

        {editing?.validation.issues.length ? (
          <CatalogValidationIssues issues={editing.validation.issues} />
        ) : null}

        <fieldset disabled={Boolean(busy) || writeBlocked}>
          <form
            ref={form}
            aria-label={t("Series details")}
            className={styles.formGrid}
            onSubmit={saveSeries}
          >
            <label>
              {t("Title")}
              <input
                disabled={editing?.status === "ARCHIVED"}
                maxLength={200}
                required
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </label>
            <label>
              {t("Slug")}
              <input
                disabled={editing?.status === "ARCHIVED"}
                maxLength={160}
                placeholder={t("generated from title when blank")}
                value={draft.slug}
                onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
              />
            </label>
            <label className={styles.fullField}>
              {t("Synopsis")}
              <textarea
                disabled={editing?.status === "ARCHIVED"}
                required
                value={draft.synopsis}
                onChange={(event) => setDraft({ ...draft, synopsis: event.target.value })}
              />
            </label>
            <label>
              {t("Release year")}
              <input
                disabled={editing?.status === "ARCHIVED"}
                max="2200"
                min="1888"
                placeholder={t("Optional")}
                type="number"
                value={draft.releaseYear}
                onChange={(event) => setDraft({ ...draft, releaseYear: event.target.value })}
              />
            </label>
            <label>
              {t("Maturity")}
              <input
                disabled={editing?.status === "ARCHIVED"}
                maxLength={32}
                placeholder={t("TV-14")}
                required
                value={draft.maturityRating}
                onChange={(event) => setDraft({ ...draft, maturityRating: event.target.value })}
              />
            </label>
            <label>
              {t("Original language")}
              <input
                disabled={editing?.status === "ARCHIVED"}
                maxLength={16}
                placeholder={t("en")}
                required
                value={draft.originalLanguage}
                onChange={(event) => setDraft({ ...draft, originalLanguage: event.target.value })}
              />
            </label>
            <label>
              {t("Genres / categories")}
              <input
                disabled={editing?.status === "ARCHIVED"}
                placeholder={t("Drama, Mystery")}
                required
                value={draft.genres}
                onChange={(event) => setDraft({ ...draft, genres: event.target.value })}
              />
            </label>
            <div className={styles.fullField}>
              <CatalogResourcePicker
                disabled={editing?.status === "ARCHIVED"}
                kind="video"
                label={t("Series trailer")}
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
                  label={t(`${titleCase(type)} artwork`)}
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
                  <strong>{t("Availability")}</strong>
                  <p className={styles.muted}>
                    {t(
                      "Leave empty for unrestricted Series availability, or add explicit global/territory rules with optional windows.",
                    )}
                  </p>
                </div>
                <ActionButton
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
                  {t("Add rule")}
                </ActionButton>
              </div>
              {draft.availability.map((rule, index) => (
                <div className={styles.formGrid} key={index}>
                  <label>
                    {t("Territory")}
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
                    {t("Rule")}
                    <select
                      disabled={editing?.status === "ARCHIVED"}
                      value={rule.rule}
                      onChange={(event) =>
                        updateAvailability(setDraft, draft, index, {
                          rule: event.target.value as AvailabilityRule,
                        })
                      }
                    >
                      <option value="ALLOW">{t("Allow")}</option>
                      <option value="BLOCK">{t("Block")}</option>
                    </select>
                  </label>
                  <label>
                    {t("Starts")}
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
                    {t("Ends")}
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
                    {t("Note")}
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
                    <ActionButton
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
                      {t("Remove rule")}
                    </ActionButton>
                  </div>
                </div>
              ))}
            </div>

            <div className={`${styles.actions} ${styles.fullField}`}>
              <ActionButton
                className={styles.button}
                disabled={busy === "save-series" || editing?.status === "ARCHIVED"}
                type="submit"
              >
                {busy === "save-series"
                  ? t("Saving…")
                  : editingId
                    ? t("Save series")
                    : t("Create draft")}
              </ActionButton>
              {editing?.status === "DRAFT" ? (
                <>
                  <ActionButton
                    className={styles.button}
                    disabled={Boolean(busy) || dirty || !editing.validation.publishable}
                    type="button"
                    onClick={() => setConfirm("publish")}
                  >
                    {t("Publish series")}
                  </ActionButton>
                  <ActionButton
                    className={styles.danger}
                    disabled={Boolean(busy) || dirty}
                    type="button"
                    onClick={() => setConfirm("archive")}
                  >
                    {t("Archive")}
                  </ActionButton>
                </>
              ) : null}
              {editing?.status === "PUBLISHED" ? (
                <ActionButton
                  className={styles.danger}
                  disabled={Boolean(busy) || dirty}
                  type="button"
                  onClick={() => setConfirm("unpublish")}
                >
                  {t("Unpublish series")}
                </ActionButton>
              ) : null}
            </div>
          </form>
        </fieldset>
      </section>

      {editing && editing.status !== "ARCHIVED" ? (
        <fieldset disabled={Boolean(busy) || writeBlocked} key={`${editing.id}:${editorRevision}`}>
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.eyebrow}>{t("Season & episode management")}</span>
                <h2>{editing.title}</h2>
                <p className={styles.muted}>
                  {t(
                    "Ordering is conflict-safe. Episodes must reference an accessible playable Video before publication.",
                  )}
                </p>
              </div>
              <span className={styles.statusPill}>
                {editing.seasons.length} {t("seasons")}
              </span>
            </div>

            <NewSeasonForm key={editing.id} busy={busy} mutate={mutate} series={editing} />

            <div className={styles.grid}>
              {editing.seasons.map((season, seasonIndex) => (
                <section className={styles.cardInset} key={season.id}>
                  <div className={styles.cardHeader}>
                    <div>
                      <strong>{season.title || `${t("Season")} ${season.seasonNumber}`}</strong>
                      <p className={styles.muted}>
                        {t("Season")}
                        {season.seasonNumber} {t("· catalog position")}
                        {seasonIndex + 1} · {season.episodes.length} {t("episodes")}
                      </p>
                    </div>
                    <div className={styles.actions}>
                      <ActionButton
                        aria-label={`${t("Move up")}: ${t("Season")} ${season.seasonNumber}`}
                        className={styles.button}
                        disabled={seasonIndex === 0 || busy === `reorder-seasons:${editing.id}`}
                        type="button"
                        onClick={() => void moveSeason(editing, seasonIndex, -1)}
                      >
                        ↑
                      </ActionButton>
                      <ActionButton
                        aria-label={`${t("Move down")}: ${t("Season")} ${season.seasonNumber}`}
                        className={styles.button}
                        disabled={
                          seasonIndex === editing.seasons.length - 1 ||
                          busy === `reorder-seasons:${editing.id}`
                        }
                        type="button"
                        onClick={() => void moveSeason(editing, seasonIndex, 1)}
                      >
                        ↓
                      </ActionButton>
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
                      <p className={styles.muted}>{t("No episodes in this season yet.")}</p>
                    ) : null}
                  </div>
                </section>
              ))}
              {!editing.seasons.length ? (
                <p className={styles.muted}>
                  {t("Add the first season to start episode management.")}
                </p>
              ) : null}
            </div>
          </section>
        </fieldset>
      ) : null}

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <span className={styles.eyebrow}>{t("Catalog browser")}</span>
            <h2>{t("Series")}</h2>
          </div>
          <span className={styles.statusPill}>
            {items.length} {t("results")}
          </span>
        </div>
        <div className={styles.toolbar}>
          <ActionButton
            disabled={Boolean(busy)}
            onClick={() => {
              if (editing) beginEdit(editing);
              else void load().catch(() => setError(t("Series catalog could not be loaded.")));
            }}
          >
            {t(editingId ? "Refresh record" : "Refresh list")}
          </ActionButton>
          <input
            aria-label={t("Search series")}
            placeholder={t("Search title, slug, synopsis or genre…")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            aria-label={t("Filter by status")}
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="">{t("All statuses")}</option>
            <option value="DRAFT">{t("Draft")}</option>
            <option value="PUBLISHED">{t("Published")}</option>
            <option value="ARCHIVED">{t("Archived")}</option>
          </select>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("Series")}</th>
                <th>{t("Status")}</th>
                <th>{t("Validation")}</th>
                <th>{t("Seasons")}</th>
                <th>{t("Episodes")}</th>
                <th>{t("Action")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((series) => (
                <tr key={series.id}>
                  <td>
                    <strong>{series.title}</strong>
                    <div className={styles.muted}>
                      /{series.slug} · {series.releaseYear ?? t("year unset")} ·{" "}
                      {series.originalLanguage.toUpperCase()}
                    </div>
                  </td>
                  <td>
                    <span className={styles.statusPill}>{t(series.status)}</span>
                  </td>
                  <td>
                    <ValidationBadge validation={series.validation} />
                  </td>
                  <td>{series.seasons.length}</td>
                  <td>
                    {series.seasons.reduce((total, season) => total + season.episodes.length, 0)}
                  </td>
                  <td>
                    <ActionButton
                      className={styles.button}
                      type="button"
                      onClick={() => beginEdit(series)}
                    >
                      {t("Manage")}
                    </ActionButton>
                  </td>
                </tr>
              ))}
              {!items.length ? (
                <tr>
                  <td colSpan={6} className={styles.muted}>
                    {t("No series match these filters.")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      <ConfirmationDialog
        open={confirm !== null}
        direction={direction}
        title={t("Change series status?")}
        description={t("This changes the saved record’s public availability.")}
        confirmLabel={t("Confirm")}
        cancelLabel={t("Cancel")}
        busy={Boolean(busy)}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm && editing) void lifecycle(editing, confirm);
        }}
      />
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
  const t = useCatalogCopy();
  const { restoredForm } = useCatalogDrafts();
  const recovered = restoredForm<SeasonDraft>(`new-season:${series.id}`);
  const [sourceFingerprint, setSourceFingerprint] = useState(
    () => recovered?.sourceFingerprint ?? catalogFormFingerprint(`new-season:${series.id}`, series),
  );
  const form = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<SeasonDraft>(() => recovered?.draft ?? emptySeasonDraft());
  const [baseline, setBaseline] = useState<SeasonDraft>(
    () => recovered?.baseline ?? emptySeasonDraft(),
  );

  async function saveDraft() {
    if (!form.current?.reportValidity()) return false;
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
      t("Season created."),
    );
    if (!ok) return false;
    setSourceFingerprint(catalogFormFingerprint(`new-season:${series.id}`, ok.authoritative));
    const next = emptySeasonDraft();
    setDraft(next);
    setBaseline(next);
    return true;
  }

  useCatalogDirty(`new-season:${series.id}`, draftChanged(draft, baseline), saveDraft, {
    draft,
    baseline,
    sourceFingerprint,
  });
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveDraft();
  }

  return (
    <fieldset disabled={Boolean(busy)}>
      <form ref={form} aria-label={t("New season")} className={styles.cardInset} onSubmit={submit}>
        <div className={styles.cardHeader}>
          <div>
            <strong>{t("Add season")}</strong>
            <p className={styles.muted}>
              {t("Create the season as a catalog child; artwork is optional.")}
            </p>
          </div>
        </div>
        <div className={styles.formGrid}>
          <label>
            {t("Season number")}
            <input
              min="0"
              required
              type="number"
              value={draft.seasonNumber}
              onChange={(event) => setDraft({ ...draft, seasonNumber: event.target.value })}
            />
          </label>
          <label>
            {t("Title")}
            <input
              maxLength={200}
              placeholder={t("Optional")}
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          <div className={styles.fullField}>
            <CatalogResourcePicker
              kind="artwork"
              label={t("Season poster")}
              selectedLabel={draft.artwork.POSTER.label}
              value={draft.artwork.POSTER.id}
              onChange={(id, label) =>
                setDraft({ ...draft, artwork: { ...draft.artwork, POSTER: { id, label } } })
              }
            />
          </div>
          <div className={`${styles.actions} ${styles.fullField}`}>
            <ActionButton
              className={styles.button}
              disabled={busy === `create-season:${series.id}`}
              type="submit"
            >
              {t("Add season")}
            </ActionButton>
          </div>
        </div>
      </form>
    </fieldset>
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
  const t = useCatalogCopy();
  const { restoredForm } = useCatalogDrafts();
  const recovered = restoredForm<SeasonDraft>(`season:${season.id}`);
  const [sourceFingerprint, setSourceFingerprint] = useState(
    () => recovered?.sourceFingerprint ?? catalogFormFingerprint(`season:${season.id}`, season),
  );
  const form = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<SeasonDraft>(() => recovered?.draft ?? fromSeason(season));

  const [baseline, setBaseline] = useState(() => recovered?.baseline ?? fromSeason(season));

  async function saveDraft() {
    if (!form.current?.reportValidity()) return false;
    const ok = await mutate(
      `save-season:${season.id}`,
      `/admin/catalog/series/seasons/${season.id}`,
      {
        method: "PATCH",
        body: JSON.stringify(changedCatalogFields(seasonPayload(baseline), seasonPayload(draft))),
      },
      t("Season saved."),
    );
    if (!ok) return false;
    setSourceFingerprint(
      catalogFormFingerprint(
        `season:${season.id}`,
        ok.authoritative?.seasons.find((item) => item.id === season.id) ?? ok.season,
      ),
    );
    setBaseline(draft);
    return true;
  }

  useCatalogDirty(`season:${season.id}`, draftChanged(draft, baseline), saveDraft, {
    draft,
    baseline,
    sourceFingerprint,
  });
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveDraft();
  }

  return (
    <fieldset disabled={Boolean(busy)}>
      <form
        ref={form}
        aria-label={t("Season details")}
        className={styles.formGrid}
        onSubmit={submit}
      >
        <label>
          {t("Season number")}
          <input
            min="0"
            required
            type="number"
            value={draft.seasonNumber}
            onChange={(event) => setDraft({ ...draft, seasonNumber: event.target.value })}
          />
        </label>
        <label>
          {t("Season title")}
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
              label={t(`Season ${titleCase(type)}`)}
              selectedLabel={draft.artwork[type].label}
              value={draft.artwork[type].id}
              onChange={(id, label) =>
                setDraft({ ...draft, artwork: { ...draft.artwork, [type]: { id, label } } })
              }
            />
          </div>
        ))}
        <div className={`${styles.actions} ${styles.fullField}`}>
          <ActionButton
            className={styles.button}
            disabled={busy === `save-season:${season.id}`}
            type="submit"
          >
            {t("Save season metadata")}
          </ActionButton>
        </div>
      </form>
    </fieldset>
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
  const t = useCatalogCopy();
  const { restoredForm } = useCatalogDrafts();
  const recovered = restoredForm<EpisodeDraft>(`new-episode:${season.id}`);
  const [sourceFingerprint, setSourceFingerprint] = useState(
    () =>
      recovered?.sourceFingerprint ?? catalogFormFingerprint(`new-episode:${season.id}`, season),
  );
  const form = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<EpisodeDraft>(() => recovered?.draft ?? emptyEpisodeDraft());
  const [baseline, setBaseline] = useState<EpisodeDraft>(
    () => recovered?.baseline ?? emptyEpisodeDraft(),
  );

  async function saveDraft() {
    if (!form.current?.reportValidity()) return false;
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
      t("Episode created."),
    );
    if (!ok) return false;
    setSourceFingerprint(
      catalogFormFingerprint(
        `new-episode:${season.id}`,
        ok.authoritative?.seasons.find((item) => item.id === season.id),
      ),
    );
    const next = emptyEpisodeDraft();
    setDraft(next);
    setBaseline(next);
    return true;
  }

  useCatalogDirty(`new-episode:${season.id}`, draftChanged(draft, baseline), saveDraft, {
    draft,
    baseline,
    sourceFingerprint,
  });
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveDraft();
  }

  return (
    <fieldset disabled={Boolean(busy)}>
      <form ref={form} aria-label={t("New episode")} className={styles.cardInset} onSubmit={submit}>
        <div className={styles.cardHeader}>
          <div>
            <strong>{t("Add episode")}</strong>
            <p className={styles.muted}>
              {t("Draft episodes may omit playback; publication requires a playable Video.")}
            </p>
          </div>
        </div>
        <div className={styles.formGrid}>
          <label>
            {t("Episode number")}
            <input
              min="0"
              required
              type="number"
              value={draft.episodeNumber}
              onChange={(event) => setDraft({ ...draft, episodeNumber: event.target.value })}
            />
          </label>
          <label>
            {t("Title")}
            <input
              maxLength={200}
              required
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          <label>
            {t("Release date")}
            <input
              type="datetime-local"
              value={draft.releaseDate}
              onChange={(event) => setDraft({ ...draft, releaseDate: event.target.value })}
            />
          </label>
          <label className={styles.fullField}>
            {t("Synopsis")}
            <textarea
              required
              value={draft.synopsis}
              onChange={(event) => setDraft({ ...draft, synopsis: event.target.value })}
            />
          </label>
          <div className={styles.fullField}>
            <CatalogResourcePicker
              kind="video"
              label={t("Episode playback")}
              selectedLabel={draft.video.label}
              value={draft.video.id}
              onChange={(id, label) => setDraft({ ...draft, video: { id, label } })}
            />
          </div>
          <div className={`${styles.actions} ${styles.fullField}`}>
            <ActionButton
              className={styles.button}
              disabled={busy === `create-episode:${season.id}`}
              type="submit"
            >
              {t("Add episode draft")}
            </ActionButton>
          </div>
        </div>
      </form>
    </fieldset>
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
  const t = useCatalogCopy();
  const { restoredForm } = useCatalogDrafts();
  const recovered = restoredForm<EpisodeDraft>(`episode:${episode.id}`);
  const [sourceFingerprint, setSourceFingerprint] = useState(
    () => recovered?.sourceFingerprint ?? catalogFormFingerprint(`episode:${episode.id}`, episode),
  );
  const form = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<EpisodeDraft>(() => recovered?.draft ?? fromEpisode(episode));

  const [baseline, setBaseline] = useState(() => recovered?.baseline ?? fromEpisode(episode));

  async function saveDraft() {
    if (!form.current?.reportValidity()) return false;
    const ok = await mutate(
      `save-episode:${episode.id}`,
      `/admin/catalog/series/episodes/${episode.id}`,
      {
        method: "PATCH",
        body: JSON.stringify(changedCatalogFields(episodePayload(baseline), episodePayload(draft))),
      },
      t("Episode saved."),
    );
    if (!ok) return false;
    setSourceFingerprint(
      catalogFormFingerprint(
        `episode:${episode.id}`,
        ok.authoritative?.seasons
          .flatMap((item) => item.episodes)
          .find((item) => item.id === episode.id) ?? ok.episode,
      ),
    );
    setBaseline(draft);
    return true;
  }

  useCatalogDirty(`episode:${episode.id}`, draftChanged(draft, baseline), saveDraft, {
    draft,
    baseline,
    sourceFingerprint,
  });
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveDraft();
  }

  async function lifecycle(action: "publish" | "unpublish") {
    if (draftChanged(draft, baseline)) return;
    const ok = await mutate(
      `${action}-episode:${episode.id}`,
      `/admin/catalog/series/episodes/${episode.id}/${action}`,
      { method: "POST" },
      t(action === "publish" ? "Episode published." : "Episode unpublished."),
    );
    if (ok)
      setSourceFingerprint(
        catalogFormFingerprint(
          `episode:${episode.id}`,
          ok.authoritative?.seasons
            .flatMap((item) => item.episodes)
            .find((item) => item.id === episode.id) ?? ok.episode,
        ),
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
      t("Episode ordering updated."),
    );
  }

  return (
    <article className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <strong>
            {t("E")}
            {episode.episodeNumber} · {episode.title}
          </strong>
          <p className={styles.muted}>
            {t(episode.status)} {t("· catalog position")}
            {episodeIndex + 1} · {episode.video?.title ?? t("playback not assigned")}
          </p>
        </div>
        <ValidationBadge validation={episode.validation} />
      </div>
      {episode.validation.issues.length ? (
        <CatalogValidationIssues issues={episode.validation.issues} />
      ) : null}
      <fieldset disabled={Boolean(busy)}>
        <form
          ref={form}
          aria-label={t("Episode details")}
          className={styles.formGrid}
          onSubmit={save}
        >
          <label>
            {t("Episode number")}
            <input
              min="0"
              required
              type="number"
              value={draft.episodeNumber}
              onChange={(event) => setDraft({ ...draft, episodeNumber: event.target.value })}
            />
          </label>
          <label>
            {t("Title")}
            <input
              maxLength={200}
              required
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          <label>
            {t("Release date")}
            <input
              type="datetime-local"
              value={draft.releaseDate}
              onChange={(event) => setDraft({ ...draft, releaseDate: event.target.value })}
            />
          </label>
          <label className={styles.fullField}>
            {t("Synopsis")}
            <textarea
              required
              value={draft.synopsis}
              onChange={(event) => setDraft({ ...draft, synopsis: event.target.value })}
            />
          </label>
          <div className={styles.fullField}>
            <CatalogResourcePicker
              kind="video"
              label={t("Episode playback")}
              required={episode.status === "PUBLISHED"}
              selectedLabel={draft.video.label}
              value={draft.video.id}
              onChange={(id, label) => setDraft({ ...draft, video: { id, label } })}
            />
          </div>
          <div className={`${styles.actions} ${styles.fullField}`}>
            <ActionButton
              className={styles.button}
              disabled={busy === `save-episode:${episode.id}`}
              type="submit"
            >
              {t("Save episode")}
            </ActionButton>
            <ActionButton
              aria-label={`${t("Move up")}: ${episode.title}`}
              className={styles.button}
              disabled={episodeIndex === 0 || busy === `reorder-episodes:${season.id}`}
              type="button"
              onClick={() => void move(-1)}
            >
              ↑
            </ActionButton>
            <ActionButton
              aria-label={`${t("Move down")}: ${episode.title}`}
              className={styles.button}
              disabled={
                episodeIndex === season.episodes.length - 1 ||
                busy === `reorder-episodes:${season.id}`
              }
              type="button"
              onClick={() => void move(1)}
            >
              ↓
            </ActionButton>
            {episode.status === "DRAFT" ? (
              <ActionButton
                className={styles.button}
                disabled={
                  Boolean(busy) || draftChanged(draft, baseline) || !episode.validation.publishable
                }
                type="button"
                onClick={() => void lifecycle("publish")}
              >
                {t("Publish episode")}
              </ActionButton>
            ) : null}
            {episode.status === "PUBLISHED" ? (
              <ActionButton
                className={styles.danger}
                disabled={Boolean(busy) || draftChanged(draft, baseline)}
                type="button"
                onClick={() => void lifecycle("unpublish")}
              >
                {t("Unpublish episode")}
              </ActionButton>
            ) : null}
          </div>
        </form>
      </fieldset>
    </article>
  );
}

function ValidationBadge({ validation }: { validation: Validation }) {
  const t = useCatalogCopy();
  const { locale } = useI18n();
  return (
    <span
      className={styles.statusPill}
      title={
        validation.issues.map((issue) => catalogValidationReason(issue, locale)).join(" ") ||
        t("Ready to publish")
      }
    >
      {validation.status === "READY"
        ? t("READY")
        : `${validation.issues.length} ${t("validation issues")}`}
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
      ? [
          {
            type,
            mediaAssetId: selection.id,
            altText:
              selection.altText !== undefined
                ? selection.altText
                : `${label} ${type.toLowerCase()}`,
          },
        ]
      : [];
  });
}

function artworkSelections(rows: ArtworkRow[]): ArtworkSelections {
  const next = emptyArtwork();
  for (const row of rows) {
    next[row.type] = {
      id: row.mediaAssetId,
      altText: row.altText,
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

function seasonPayload(draft: SeasonDraft) {
  return {
    seasonNumber: Number(draft.seasonNumber),
    title: draft.title.trim() || null,
    artwork: artworkPayload(draft.artwork, `Season ${draft.seasonNumber}`),
  };
}
function episodePayload(draft: EpisodeDraft) {
  return {
    episodeNumber: Number(draft.episodeNumber),
    title: draft.title.trim(),
    synopsis: draft.synopsis.trim(),
    releaseDate: draft.releaseDate ? new Date(draft.releaseDate).toISOString() : null,
    videoId: draft.video.id,
  };
}
