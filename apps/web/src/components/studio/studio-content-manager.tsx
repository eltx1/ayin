"use client";

import { useCallback, useState } from "react";

import { useContentI18n } from "@/lib/i18n/content-copy";
import { DataTable, type TableColumn } from "@/components/ui/data-presentation";
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
import { getStudioContent, type StudioVideo } from "@/lib/studio";
import { useRemoteResource } from "@/lib/use-remote-resource";
import type { ContentTranslationKey } from "@/lib/i18n/content-copy";

import { StudioVideoEditor } from "./studio-video-editor";
import styles from "./studio-content.module.css";

export function StudioContentManager() {
  const { t, href, formatDate } = useContentI18n();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [visibility, setVisibility] = useState("");
  const [filters, setFilters] = useState({ query: "", status: "", visibility: "" });
  const load = useCallback((signal: AbortSignal) => getStudioContent(filters, signal), [filters]);
  const { state, reload } = useRemoteResource(load);
  const [selected, setSelected] = useState<StudioVideo | null>(null);
  const [notice, setNotice] = useState<ContentTranslationKey | null>(null);

  function close() {
    setSelected(null);
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
        <DataBadge tone={video.status === "PUBLISHED" ? "success" : "neutral"}>
          {t(contentStatuses[video.status] ?? "content.other")}
        </DataBadge>
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
      <PageHeader
        title={t("studio.content")}
        description={t("content.intro")}
        actions={
          !selected ? (
            <ActionLink href={href("/upload")}>{t("content.upload")}</ActionLink>
          ) : undefined
        }
      />
      {selected ? (
        <StudioVideoEditor
          key={selected.id}
          video={selected}
          onClose={close}
          onCommitted={(message) => {
            setNotice(message);
            close();
          }}
        />
      ) : (
        <div className={styles.library}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setNotice(null);
              setFilters({ query: query.trim(), status, visibility });
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
              <p className={styles.hint}>{t("content.limit")}</p>
              <DataTable
                caption={t("content.count", { count: state.data.videos.length })}
                scrollLabel={t("content.library")}
                rows={state.data.videos}
                columns={columns}
                rowKey={(video) => video.id}
              />
            </>
          ) : null}
        </div>
      )}
    </>
  );
}
