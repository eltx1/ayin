"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { catalogRecord, catalogList } from "@/lib/catalog-editor-contract";
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
  artwork: Record<
    ArtworkType,
    { id: string | null; label: string | null; altText?: string | null }
  >;
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
  return (
    <CatalogEditorWorkspace kind="movie">
      <MovieCatalogContent />
    </CatalogEditorWorkspace>
  );
}

function MovieCatalogContent() {
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
  const recovered = restoredForm<Draft>("movie");
  const initialRecord = restoredRecord<MovieRow>();
  const [items, setItems] = useState<MovieRow[]>([]);
  const [draft, setDraft] = useState<Draft>(
    () => recovered?.draft ?? (initialRecord ? fromMovie(initialRecord) : emptyDraft()),
  );
  const [baseline, setBaseline] = useState<Draft>(
    () => recovered?.baseline ?? (initialRecord ? fromMovie(initialRecord) : emptyDraft()),
  );
  const [sourceFingerprint, setSourceFingerprint] = useState(
    () => recovered?.sourceFingerprint ?? catalogFormFingerprint("movie", initialRecord),
  );
  const [editing, setEditing] = useState<MovieRow | null>(initialRecord);
  const editingId = editing?.id ?? null;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"" | MovieRow["status"]>("");
  const [busy, setBusy] = useState<string | null>(null);
  const lock = useRef(false);
  const [writeBlocked, setWriteBlocked] = useState(restoredBlocked);
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
    const body = await request<{ items: MovieRow[] }>(`/admin/catalog/movies?${params}`);
    if (read === reads.current && latestBrowseKey.current === browseKey && current())
      setItems(catalogList<MovieRow>(body, "movie"));
  }, [query, status, request, current, browseKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((caught: unknown) => {
        if (current())
          setError(
            caught instanceof Error ? caught.message : t("Movie catalog could not be loaded."),
          );
      });
    }, 200);
    return () => {
      cancelBrowseReads();
      window.clearTimeout(timer);
    };
  }, [load, current, t, cancelBrowseReads]);

  async function refreshBrowse() {
    try {
      await load();
    } catch {
      if (current())
        setError(
          t(
            "Changes were saved, but the catalog list could not refresh. Use Refresh list; do not submit again.",
          ),
        );
    }
  }

  async function saveDraft() {
    if (lock.current || writeBlocked || !current() || !form.current?.reportValidity()) return false;
    lock.current = true;
    markPending(true);
    setBusy("save");
    setError(null);
    setMessage(null);
    const snapshot = draft;
    try {
      const body = await request<{ movie: MovieRow }>(
        `/admin/catalog/movies${editingId ? `/${editingId}` : ""}`,
        {
          method: editingId ? "PATCH" : "POST",
          body: JSON.stringify(
            editingId
              ? changedCatalogFields(toPayload(baseline), toPayload(snapshot))
              : toPayload(snapshot),
          ),
        },
      );
      body.movie = catalogRecord<MovieRow>(body, "movie", editingId ?? undefined);
      clearRestoration();
      acknowledgeRecord(body.movie);
      setEditing(body.movie);
      setSourceFingerprint(catalogFormFingerprint("movie", body.movie));
      const saved = fromMovie(body.movie);
      setBaseline(saved);
      setDraft(saved);
      setMessage(t(editingId ? "Movie changes saved." : "Movie draft created."));
      await refreshBrowse();
      return true;
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
      return false;
    } finally {
      lock.current = false;
      markPending(false);
      if (current()) setBusy(null);
    }
  }
  useCatalogDirty("movie", draftChanged(draft, baseline), saveDraft, {
    draft,
    baseline,
    sourceFingerprint,
  });
  useCatalogTarget(editing, writeBlocked);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveDraft();
  }

  async function lifecycle(action: "publish" | "unpublish" | "archive") {
    if (!editing || lock.current || writeBlocked || dirty || !current()) return;
    lock.current = true;
    markPending(true);
    setBusy(action);
    setConfirm(null);
    setError(null);
    setMessage(null);
    try {
      const body = await request<{ movie: MovieRow }>(
        `/admin/catalog/movies/${editing.id}/${action}`,
        { method: "POST" },
      );
      body.movie = catalogRecord<MovieRow>(body, "movie", editing.id);
      clearRestoration();
      acknowledgeRecord(body.movie);
      setEditing(body.movie);
      setSourceFingerprint(catalogFormFingerprint("movie", body.movie));
      setWriteBlocked(false);
      setDraft(fromMovie(body.movie));
      setBaseline(fromMovie(body.movie));
      setMessage(
        t(
          action === "publish"
            ? "Movie published."
            : action === "unpublish"
              ? "Movie unpublished."
              : "Movie archived.",
        ),
      );
      await refreshBrowse();
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
    } finally {
      lock.current = false;
      markPending(false);
      if (current()) setBusy(null);
    }
  }

  async function openMovie(movie: MovieRow) {
    if (lock.current) return;
    const read = ++targetRead.current;
    setBusy("open");
    setError(null);
    setMessage(null);
    try {
      const body = await request<{ movie: MovieRow }>(`/admin/catalog/movies/${movie.id}`);
      if (read !== targetRead.current || !current()) return;
      body.movie = catalogRecord<MovieRow>(body, "movie", movie.id);
      clearRestoration();
      setEditing(body.movie);
      setSourceFingerprint(catalogFormFingerprint("movie", body.movie));
      setWriteBlocked(false);
      setDraft(fromMovie(body.movie));
      setBaseline(fromMovie(body.movie));
    } catch (caught) {
      if (read === targetRead.current && current())
        setError(
          caught instanceof Error ? caught.message : t("Movie catalog could not be loaded."),
        );
    } finally {
      if (read === targetRead.current && current()) setBusy(null);
    }
  }
  function beginEdit(movie: MovieRow) {
    if (!lock.current)
      navigate(() => {
        void openMovie(movie);
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
      const next = emptyDraft();
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
          <h1>{t("Movies")}</h1>
          <p className={styles.muted}>
            {t(
              "Draft, validate and publish movie identities without exposing database IDs or unsafe media.",
            )}
          </p>
        </div>
        <ActionButton className={styles.button} onClick={beginCreate} type="button">
          {t("New movie draft")}
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
            <span className={styles.eyebrow}>{editing ? t("Edit movie") : t("Create draft")}</span>
            <h2>{editing?.title ?? t("New movie")}</h2>
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
            aria-label={t("Movie details")}
            className={styles.formGrid}
            onSubmit={save}
          >
            <label>
              {t("Title")}
              <input
                required
                maxLength={200}
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </label>
            <label>
              {t("Slug")}
              <input
                maxLength={160}
                placeholder={t("generated from title when blank")}
                value={draft.slug}
                onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
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
            <label>
              {t("Release year")}
              <input
                min="1888"
                max="2200"
                required
                type="number"
                value={draft.releaseYear}
                onChange={(event) => setDraft({ ...draft, releaseYear: event.target.value })}
              />
            </label>
            <label>
              {t("Runtime (minutes)")}
              <input
                min="1"
                max="1440"
                required
                type="number"
                value={draft.runtimeMinutes}
                onChange={(event) => setDraft({ ...draft, runtimeMinutes: event.target.value })}
              />
            </label>
            <label>
              {t("Release date")}
              <input
                type="date"
                value={draft.releaseDate}
                onChange={(event) => setDraft({ ...draft, releaseDate: event.target.value })}
              />
            </label>
            <label>
              {t("Maturity")}
              <input
                required
                maxLength={32}
                placeholder={t("PG-13")}
                value={draft.maturityRating}
                onChange={(event) => setDraft({ ...draft, maturityRating: event.target.value })}
              />
            </label>
            <label>
              {t("Original language")}
              <input
                required
                maxLength={16}
                placeholder={t("en")}
                value={draft.originalLanguage}
                onChange={(event) => setDraft({ ...draft, originalLanguage: event.target.value })}
              />
            </label>
            <label>
              {t("Genres / categories")}
              <input
                required
                placeholder={t("Drama, Mystery")}
                value={draft.genres}
                onChange={(event) => setDraft({ ...draft, genres: event.target.value })}
              />
            </label>
            <div className={styles.fullField}>
              <CatalogResourcePicker
                kind="video"
                label={t("Primary playback")}
                required
                value={draft.primaryVideoId}
                selectedLabel={draft.primaryVideoLabel}
                onChange={(id, label) =>
                  setDraft({ ...draft, primaryVideoId: id, primaryVideoLabel: label })
                }
              />
            </div>
            <div className={styles.fullField}>
              <CatalogResourcePicker
                kind="video"
                label={t("Trailer")}
                value={draft.trailerVideoId}
                selectedLabel={draft.trailerVideoLabel}
                onChange={(id, label) =>
                  setDraft({ ...draft, trailerVideoId: id, trailerVideoLabel: label })
                }
              />
            </div>
            {(["POSTER", "BACKDROP", "LOGO"] as const).map((type) => (
              <div className={styles.fullField} key={type}>
                <CatalogResourcePicker
                  kind="artwork"
                  label={t(`${type[0]}${type.slice(1).toLowerCase()} artwork`)}
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
                  <strong>{t("Availability")}</strong>
                  <p className={styles.muted}>
                    {t("Use * for global rights or a two-letter territory code.")}
                  </p>
                </div>
                <ActionButton
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
                  {t("Add rule")}
                </ActionButton>
              </div>
              {draft.availability.map((rule, index) => (
                <div className={styles.formGrid} key={index}>
                  <label>
                    {t("Territory")}
                    <input
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
              <ActionButton className={styles.button} disabled={busy === "save"} type="submit">
                {busy === "save" ? t("Saving…") : editingId ? t("Save movie") : t("Create draft")}
              </ActionButton>
              {editing ? (
                <>
                  {editing.status === "PUBLISHED" ? (
                    <ActionButton
                      className={styles.danger}
                      disabled={Boolean(busy) || dirty}
                      type="button"
                      onClick={() => setConfirm("unpublish")}
                    >
                      {t("Unpublish")}
                    </ActionButton>
                  ) : editing.status === "DRAFT" ? (
                    <ActionButton
                      className={styles.button}
                      disabled={Boolean(busy) || dirty || !editing.validation.publishable}
                      type="button"
                      onClick={() => setConfirm("publish")}
                    >
                      {t("Publish")}
                    </ActionButton>
                  ) : null}
                  {editing.status === "DRAFT" ? (
                    <ActionButton
                      className={styles.danger}
                      disabled={Boolean(busy) || dirty}
                      type="button"
                      onClick={() => setConfirm("archive")}
                    >
                      {t("Archive")}
                    </ActionButton>
                  ) : null}
                </>
              ) : null}
            </div>
          </form>
        </fieldset>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <span className={styles.eyebrow}>{t("Catalog browser")}</span>
            <h2>{t("Movies")}</h2>
          </div>
          <span className={styles.statusPill}>
            {items.length} {t("results")}
          </span>
        </div>
        <div className={styles.toolbar}>
          {editing ? (
            <ActionButton disabled={Boolean(busy)} onClick={() => beginEdit(editing)}>
              {t("Refresh record")}
            </ActionButton>
          ) : null}
          <ActionButton
            onClick={() =>
              void load().catch(() => setError(t("Movie catalog could not be loaded.")))
            }
          >
            {t("Refresh list")}
          </ActionButton>
          <input
            aria-label={t("Search movies")}
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
        <div className={styles.grid}>
          {items.map((movie) => (
            <article className={styles.cardInset} key={movie.id}>
              <div className={styles.cardHeader}>
                <div>
                  <strong>{movie.title}</strong>
                  <p className={styles.muted}>
                    /{movie.slug} · {movie.releaseYear} · {movie.runtimeMinutes} {t("min ·")}{" "}
                    {movie.originalLanguage.toUpperCase()}
                  </p>
                </div>
                <ValidationBadge validation={movie.validation} />
              </div>
              <p>{movie.genres.map((genre) => genre.name).join(" · ") || t("No genres")}</p>
              <p className={styles.muted}>
                {t("Primary:")}{" "}
                {movie.primaryVideo
                  ? `${movie.primaryVideo.title} (${movie.primaryVideo.slug})`
                  : t("Not assigned")}
              </p>
              <div className={styles.actions}>
                <span className={styles.statusPill}>{t(movie.status)}</span>
                <ActionButton
                  className={styles.button}
                  type="button"
                  onClick={() => beginEdit(movie)}
                >
                  {t("Edit")}
                </ActionButton>
              </div>
            </article>
          ))}
        </div>
      </section>
      <ConfirmationDialog
        open={confirm !== null}
        direction={direction}
        title={t("Change movie status?")}
        description={t("This changes the saved record’s public availability.")}
        confirmLabel={t("Confirm")}
        cancelLabel={t("Cancel")}
        busy={Boolean(busy)}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) void lifecycle(confirm);
        }}
      />
    </>
  );
}

function ValidationBadge({ validation }: { validation: Validation }) {
  const t = useCatalogCopy();
  const { locale } = useI18n();
  return (
    <span
      className={styles.statusPill}
      title={validation.issues.map((issue) => catalogValidationReason(issue, locale)).join(" ")}
    >
      {validation.status === "READY"
        ? t("Ready")
        : `${validation.issues.length} ${t("validation issues")}`}
    </span>
  );
}

function fromMovie(movie: MovieRow): Draft {
  const artwork = emptyDraft().artwork;
  for (const item of movie.artwork) {
    artwork[item.type] = {
      id: item.mediaAssetId,
      altText: item.altText,
      label: item.asset
        ? `${item.type} · ${item.asset.r2ObjectKey.split("/").at(-1) ?? "image"}`
        : item.type,
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
    primaryVideoLabel: movie.primaryVideo
      ? `${movie.primaryVideo.title} · ${movie.primaryVideo.slug}`
      : null,
    trailerVideoId: movie.trailerVideoId,
    trailerVideoLabel: movie.trailerVideo
      ? `${movie.trailerVideo.title} · ${movie.trailerVideo.slug}`
      : null,
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
    artwork: (
      Object.entries(draft.artwork) as Array<[ArtworkType, Draft["artwork"][ArtworkType]]>
    ).flatMap(([type, item]) =>
      item.id
        ? [
            {
              type,
              mediaAssetId: item.id,
              altText:
                item.altText !== undefined ? item.altText : `${draft.title} ${type.toLowerCase()}`,
            },
          ]
        : [],
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
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
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
