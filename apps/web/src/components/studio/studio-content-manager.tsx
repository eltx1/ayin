"use client";

import { useCallback, useRef, useState } from "react";

import { useContentI18n } from "@/lib/i18n/content-copy";
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
import { contentStatuses, contentVisibility } from "@/lib/content-editor";
import type { StudioVideo } from "@/lib/studio";
import {
  firstStudioContentPage,
  nextStudioContentPage,
  previousStudioContentPage,
  readStudioContentPage,
} from "@/lib/studio-content-page";
import { useRemoteResource } from "@/lib/use-remote-resource";
import type { ContentTranslationKey } from "@/lib/i18n/content-copy";

import { StudioVideoEditor } from "./studio-video-editor";
import styles from "./studio-content.module.css";
import pageStyles from "./studio-content-pagination.module.css";

export function StudioContentManager() {
  const { t, href, formatDate, formatNumber } = useContentI18n();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [visibility, setVisibility] = useState("");
  const [location, setLocation] = useState(() =>
    firstStudioContentPage({ query: "", status: "", visibility: "" }),
  );
  const actor = useRef<{ accountId: string; channelId: string } | undefined>(undefined);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const page = await readStudioContentPage(
        location.filters,
        location.cursors.at(-1) ?? null,
        signal,
        actor.current,
      );
      signal.throwIfAborted();
      actor.current = { accountId: page.actorAccountId, channelId: page.channel.id };
      return page;
    },
    [location],
  );
  const { state, reload } = useRemoteResource(load);
  const [selected, setSelected] = useState<StudioVideo | null>(null);
  const [notice, setNotice] = useState<ContentTranslationKey | null>(null);

  function close(committed = false) {
    setSelected(null);
    if (committed) setLocation(firstStudioContentPage(location.filters));
    reload();
    window.requestAnimationFrame(() => document.getElementById("content-search")?.focus());
  }

  const columns: TableColumn<StudioVideo>[] = [
    {
      key: "title",
      heading: t("content.title"),
      rowHeader: true,
      render: (video) => <strong dir="auto">{video.title}</strong>,
    },
    {
      key: "status",
      heading: t("content.status"),
      render: (video) => (
        <span className={pageStyles.status}>
          <DataBadge tone={video.status === "PUBLISHED" ? "success" : "neutral"}>
            {t(contentStatuses[video.status] ?? "content.other")}
          </DataBadge>
        </span>
      ),
    },
    {
      key: "visibility",
      heading: t("content.visibility"),
      render: (video) => t(contentVisibility[video.visibility] ?? "content.other"),
    },
    {
      key: "updated",
      heading: t("content.updated"),
      render: (video) => formatDate(video.updatedAt),
    },
    {
      key: "actions",
      heading: t("content.actions"),
      render: (video) => (
        <ActionButton
          tone="secondary"
          onClick={() => {
            setNotice(null);
            setSelected(video);
          }}
        >
          {t("content.edit")}
        </ActionButton>
      ),
    },
  ];

  return (
    <>
      {!selected ? (
        <PageHeader
          title={t("studio.content")}
          description={t("content.intro")}
          actions={<ActionLink href={href("/upload")}>{t("content.upload")}</ActionLink>}
        />
      ) : null}
      {selected ? (
        <StudioVideoEditor
          key={selected.id}
          video={selected}
          onClose={() => close()}
          onCommitted={(message) => {
            setNotice(message);
            close(true);
          }}
        />
      ) : (
        <div className={styles.library}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setNotice(null);
              const filters = { query: query.trim(), status, visibility };
              if (
                Object.entries(filters).some(
                  ([key, value]) => location.filters[key as keyof typeof filters] !== value,
                )
              ) {
                setLocation(firstStudioContentPage(filters));
              } else reload();
            }}
          >
            <FormSection id="content-filters" legend={t("content.filters")} layout="inline">
              <TextField
                id="content-search"
                label={t("content.search")}
                placeholder={t("content.searchHint")}
                value={query}
                maxLength={200}
                onChange={(event) => setQuery(event.target.value)}
              />
              <SelectField
                id="content-filter-status"
                label={t("content.status")}
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">{t("content.allStatus")}</option>
                {Object.entries(contentStatuses).map(([value, key]) => (
                  <option key={value} value={value}>
                    {t(key)}
                  </option>
                ))}
              </SelectField>
              <SelectField
                id="content-filter-visibility"
                label={t("content.visibility")}
                value={visibility}
                onChange={(event) => setVisibility(event.target.value)}
              >
                <option value="">{t("content.allVisibility")}</option>
                {Object.entries(contentVisibility).map(([value, key]) => (
                  <option key={value} value={value}>
                    {t(key)}
                  </option>
                ))}
              </SelectField>
            </FormSection>
            <div className={styles.actions}>
              <ActionButton type="submit" pending={state.status === "loading"}>
                {t("content.apply")}
              </ActionButton>
              <ActionButton tone="secondary" onClick={reload} disabled={state.status === "loading"}>
                {t("content.retry")}
              </ActionButton>
            </div>
          </form>
          {notice ? (
            <StatusNotice tone="success" announce="polite">
              {t(notice)}
            </StatusNotice>
          ) : null}
          {state.status === "loading" ? (
            <StatusNotice announce="polite">{t("content.loading")}</StatusNotice>
          ) : null}
          {state.status === "error" ? (
            <StatusNotice tone="danger" announce="assertive">
              {t("content.loadError")}
            </StatusNotice>
          ) : null}
          {state.status === "ready" && !state.data.videos.length ? (
            <StatusNotice>{t("content.empty")}</StatusNotice>
          ) : null}
          {state.status === "ready" && state.data.videos.length > 0 ? (
            <>
              <p className={styles.hint}>{t("content.pagingHint")}</p>
              <DataTable
                caption={t("content.count", { count: formatNumber(state.data.videos.length) })}
                scrollLabel={t("content.library")}
                rows={state.data.videos}
                columns={columns}
                rowKey={(video) => video.id}
              />
            </>
          ) : null}
          <PageControls
            label={t("content.pages")}
            summary={t("content.pageNumber", { page: formatNumber(location.page) })}
            previousLabel={t("content.previousPage")}
            nextLabel={t("content.nextPage")}
            hasPrevious={location.cursors.length > 1}
            hasNext={state.status === "ready" && state.data.nextCursor !== null}
            onPrevious={() => setLocation(previousStudioContentPage(location))}
            onNext={() => {
              if (state.status === "ready" && state.data.nextCursor)
                setLocation(nextStudioContentPage(location, state.data.nextCursor));
            }}
          />
          {location.page > 1 && location.cursors.length === 1 ? (
            <p className={styles.hint}>{t("content.historyBoundary")}</p>
          ) : null}
          {location.page > 1 || state.status === "error" ? (
            <div>
              <ActionButton
                tone="secondary"
                onClick={() => {
                  // Explicit recovery may review a new account; an ordinary page
                  // reload or editor commit always stays pinned to its actor.
                  if (state.status === "error") actor.current = undefined;
                  setLocation(firstStudioContentPage(location.filters));
                }}
              >
                {t("content.firstPage")}
              </ActionButton>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
