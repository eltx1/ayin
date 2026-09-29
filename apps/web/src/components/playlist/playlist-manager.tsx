"use client";

import { useEffect, useRef, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { DataTable, PageControls, type TableColumn } from "@/components/ui/data-presentation";
import {
  ActionButton,
  ActionLink,
  DataBadge,
  FormSection,
  PageHeader,
  SelectField,
  StatusNotice,
  TextField,
} from "@/components/ui/design-system";
import { apiBaseUrl, type AyinIdentity } from "@/lib/api";
import {
  createCreatorPlaylist,
  listCreatorPlaylists,
  type PlaylistVisibility,
  type CreatorPlaylistSummary,
} from "@/lib/playlist";
import { playlistLibraryPage, type PlaylistFilter } from "@/lib/playlist-library";

import styles from "./playlist-library.module.css";

type Snapshot = {
  identity: AyinIdentity;
  playlists: Awaited<ReturnType<typeof listCreatorPlaylists>>;
};
type Notice = "created" | "createdRefresh" | "createUnconfirmed" | null;

export function PlaylistManager({ embedded = false }: { embedded?: boolean } = {}) {
  const Surface = embedded ? "div" : "main";
  const { t, href, formatNumber } = useI18n();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [signInNeeded, setSignInNeeded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<PlaylistVisibility>("PUBLIC");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PlaylistFilter>("ALL");
  const [requestedPage, setRequestedPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const activeRead = useRef<AbortController | null>(null);
  const submitting = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    activeRead.current = controller;
    void (async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/auth/me`, {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          if (!controller.signal.aborted) {
            setSignInNeeded(response.status === 401);
            setLoadState("error");
          }
          return;
        }
        const identity = (await response.json()) as AyinIdentity;
        const playlists = await listCreatorPlaylists(identity.channel.id, controller.signal);
        if (controller.signal.aborted) return;
        setSnapshot({ identity, playlists });
        setLoadState("ready");
        setNotice((previous) => (previous === "createdRefresh" ? "created" : null));
      } catch {
        if (!controller.signal.aborted) setLoadState("error");
      }
    })();
    return () => {
      controller.abort();
      if (activeRead.current === controller) activeRead.current = null;
    };
  }, [attempt]);

  function reload() {
    if (submitting.current) return;
    activeRead.current?.abort();
    setSnapshot(null);
    setSignInNeeded(false);
    setLoadState("loading");
    setAttempt((value) => value + 1);
  }

  function clearFilters() {
    setQuery("");
    setFilter("ALL");
    setRequestedPage(1);
  }

  async function createPlaylist() {
    const controller = activeRead.current;
    if (submitting.current || loadState !== "ready" || !snapshot || !name.trim() || !controller) {
      return;
    }
    if (controller.signal.aborted) return;
    submitting.current = true;
    setBusy(true);
    setNotice(null);
    let created = false;
    try {
      // No automatic replay: a lost mutation response can mean it already committed.
      await createCreatorPlaylist(snapshot.identity.channel.id, { name: name.trim(), visibility });
      created = true;
      if (controller.signal.aborted) return;
      setName("");
      const playlists = await listCreatorPlaylists(snapshot.identity.channel.id, controller.signal);
      if (controller.signal.aborted) return;
      setSnapshot({ identity: snapshot.identity, playlists });
      clearFilters();
      setNotice("created");
    } catch {
      if (controller.signal.aborted) return;
      setNotice(created ? "createdRefresh" : "createUnconfirmed");
      // Reload is read-only and must succeed before another creation is offered.
      setLoadState("error");
    } finally {
      submitting.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const library = playlistLibraryPage(snapshot?.playlists ?? [], query, filter, requestedPage);
  const visibilityLabel = (value: PlaylistVisibility) =>
    t(
      value === "PUBLIC"
        ? "playlists.public"
        : value === "UNLISTED"
          ? "playlists.unlisted"
          : "playlists.private",
    );

  const columns: TableColumn<CreatorPlaylistSummary>[] = [
    {
      key: "playlist",
      heading: t("playlists.playlist"),
      rowHeader: true,
      render: (playlist) => (
        <div className={styles.name}>
          <h3 dir="auto">{playlist.name}</h3>
          <div className={styles.badges}>
            <DataBadge>{visibilityLabel(playlist.visibility)}</DataBadge>
            {playlist.systemKey === "UPLOADS" ? (
              <DataBadge>{t("playlists.system")}</DataBadge>
            ) : null}
          </div>
          {playlist.description ? <p dir="auto">{playlist.description}</p> : null}
        </div>
      ),
    },
    {
      key: "videos",
      heading: t("playlists.videos"),
      compact: true,
      render: (playlist) => (
        <span className={styles.number}>{formatNumber(playlist.itemCount)}</span>
      ),
    },
    {
      key: "actions",
      heading: t("playlists.actions"),
      render: (playlist) => (
        <div className={styles.actions}>
          <ActionLink
            tone="quiet"
            aria-label={t("playlists.manageNamed", { name: playlist.name })}
            href={href(`/channel/playlists/${playlist.id}`)}
          >
            {t("playlists.manage")}
          </ActionLink>
          {snapshot && playlist.visibility !== "PRIVATE" ? (
            <ActionLink
              tone="quiet"
              aria-label={t("playlists.previewNamed", { name: playlist.name })}
              href={href(`/c/${snapshot.identity.channel.handle}/playlists/${playlist.slug}`)}
            >
              {t("playlists.preview")}
            </ActionLink>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <Surface className={styles.page}>
      <PageHeader
        title={t("playlists.title")}
        eyebrow={t("playlists.eyebrow")}
        description={t("playlists.description")}
        actions={
          snapshot ? (
            <ActionLink href={href(`/c/${snapshot.identity.channel.handle}?tab=playlists`)}>
              {t("playlists.channel")}
            </ActionLink>
          ) : null
        }
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void createPlaylist();
        }}
      >
        <FormSection
          id="playlist-create-fields"
          layout="inline"
          legend={t("playlists.new")}
          description={t("playlists.newDescription")}
          disabled={busy || loadState !== "ready"}
        >
          <TextField
            id="playlist-name"
            label={t("playlists.name")}
            value={name}
            required
            maxLength={160}
            placeholder={t("playlists.placeholder")}
            onChange={(event) => setName(event.target.value)}
          />
          <SelectField
            id="playlist-visibility"
            label={t("playlists.visibility")}
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as PlaylistVisibility)}
          >
            {(["PUBLIC", "UNLISTED", "PRIVATE"] as const).map((value) => (
              <option key={value} value={value}>
                {visibilityLabel(value)}
              </option>
            ))}
          </SelectField>
          <ActionButton
            pending={busy}
            disabled={loadState !== "ready" || !name.trim()}
            type="submit"
          >
            {t("playlists.create")}
          </ActionButton>
        </FormSection>
      </form>
      {notice ? (
        <StatusNotice tone={notice === "created" ? "success" : "warning"} announce="polite">
          {t(`playlists.${notice}`)}
        </StatusNotice>
      ) : null}
      <section className={styles.library} aria-labelledby="playlist-library-title">
        <h2 id="playlist-library-title">{t("playlists.library")}</h2>
        {loadState === "loading" ? (
          <StatusNotice announce="polite">{t("playlists.loading")}</StatusNotice>
        ) : loadState === "error" ? (
          <StatusNotice tone="warning" announce="polite">
            <p>{t(signInNeeded ? "playlists.signInNeeded" : "playlists.loadFailed")}</p>
            {signInNeeded ? (
              <ActionLink href={href("/login")}>{t("playlists.signIn")}</ActionLink>
            ) : null}
            <ActionButton tone="secondary" disabled={busy} onClick={reload}>
              {t("playlists.reload")}
            </ActionButton>
          </StatusNotice>
        ) : (
          <>
            <FormSection
              id="playlist-filter-fields"
              legend={t("playlists.filters")}
              layout="inline"
            >
              <TextField
                id="playlist-search"
                type="search"
                label={t("playlists.search")}
                value={query}
                maxLength={160}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setRequestedPage(1);
                }}
              />
              <SelectField
                id="playlist-filter"
                label={t("playlists.filterVisibility")}
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value as PlaylistFilter);
                  setRequestedPage(1);
                }}
              >
                <option value="ALL">{t("playlists.all")}</option>
                {(["PUBLIC", "UNLISTED", "PRIVATE"] as const).map((value) => (
                  <option key={value} value={value}>
                    {visibilityLabel(value)}
                  </option>
                ))}
              </SelectField>
              {query || filter !== "ALL" ? (
                <ActionButton tone="quiet" onClick={clearFilters}>
                  {t("playlists.clear")}
                </ActionButton>
              ) : null}
            </FormSection>
            <p className={styles.count} role="status">
              {t("playlists.results", { count: formatNumber(library.total) })}
            </p>
            {library.total > 0 ? (
              <DataTable
                caption={t("playlists.library")}
                scrollLabel={t("playlists.scroll")}
                rows={library.items}
                columns={columns}
                rowKey={(playlist) => playlist.id}
              />
            ) : (
              <StatusNotice>
                {t(snapshot?.playlists.length ? "playlists.noMatches" : "playlists.empty")}
              </StatusNotice>
            )}
            {library.pageCount > 1 ? (
              <PageControls
                label={t("playlists.pages")}
                summary={t("playlists.page", {
                  page: formatNumber(library.page),
                  pages: formatNumber(library.pageCount),
                })}
                previousLabel={t("playlists.previous")}
                nextLabel={t("playlists.next")}
                hasPrevious={library.page > 1}
                hasNext={library.page < library.pageCount}
                onPrevious={() => setRequestedPage(library.page - 1)}
                onNext={() => setRequestedPage(library.page + 1)}
              />
            ) : null}
          </>
        )}
      </section>
    </Surface>
  );
}
