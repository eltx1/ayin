"use client";

import { useMemo, useState } from "react";

import { useI18n } from "@/components/i18n/i18n-provider";
import { DataTable, Disclosure, type TableColumn } from "@/components/ui/data-presentation";
import {
  ActionButton,
  ActionLink,
  DataBadge,
  PageHeader,
  SelectField,
  StatusNotice,
  TextField,
} from "@/components/ui/design-system";
import { getStudioComments, type StudioComment } from "@/lib/studio";
import { filterRecentComments, type CommentVisibility } from "@/lib/studio-feedback";
import { useRemoteResource } from "@/lib/use-remote-resource";

import styles from "./studio-feedback.module.css";

export function StudioComments() {
  const { t, href, formatNumber, formatDate } = useI18n();
  const { state, reload } = useRemoteResource(getStudioComments);
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState<CommentVisibility>("ALL");
  const comments = state.status === "ready" ? state.data.comments : null;
  const rows = useMemo(
    () => filterRecentComments(comments ?? [], query, visibility),
    [comments, query, visibility],
  );
  const columns: TableColumn<StudioComment>[] = [
    {
      key: "comment",
      heading: t("feedback.comment"),
      rowHeader: true,
      render: (comment) => (
        <>
          <strong dir="auto">{comment.authorProfile.name}</strong>
          <time dateTime={comment.createdAt} className={styles.date}>
            {formatDate(comment.createdAt)}
          </time>
          {comment.body.length > 180 ? (
            <>
              <p dir="auto" className={styles.commentBody}>
                {comment.body.slice(0, 180)}…
              </p>
              <Disclosure summary={t("feedback.readComment")}>
                <p dir="auto">{comment.body}</p>
              </Disclosure>
            </>
          ) : (
            <p dir="auto" className={styles.commentBody}>
              {comment.body}
            </p>
          )}
        </>
      ),
    },
    {
      key: "video",
      heading: t("feedback.video"),
      render: (comment) => (
        <>
          <p dir="auto">{comment.video.title}</p>
          <DataBadge tone={comment.status === "HIDDEN" ? "warning" : "neutral"}>
            {t(
              comment.status === "PUBLISHED"
                ? "feedback.published"
                : comment.status === "HIDDEN"
                  ? "feedback.hidden"
                  : "feedback.other",
            )}
          </DataBadge>
          {!comment.video.commentsEnabled ? (
            <p className={styles.secondary}>{t("feedback.commentsOff")}</p>
          ) : null}
        </>
      ),
    },
    {
      key: "activity",
      heading: t("feedback.activity"),
      compact: true,
      render: (comment) => (
        <dl className={styles.activity}>
          <div>
            <dt>{t("feedback.likes")}</dt>
            <dd>{formatNumber(comment._count.reactions)}</dd>
          </div>
          <div>
            <dt>{t("feedback.replies")}</dt>
            <dd>{formatNumber(comment._count.replies)}</dd>
          </div>
          <div>
            <dt>{t("feedback.reports")}</dt>
            <dd>{formatNumber(comment._count.reports)}</dd>
          </div>
        </dl>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("feedback.comments")}
        eyebrow={t("studio.brand")}
        description={t("feedback.commentDescription")}
        actions={
          <ActionButton tone="secondary" pending={state.status === "loading"} onClick={reload}>
            {t("feedback.refresh")}
          </ActionButton>
        }
      />
      <div className={styles.filters} role="group" aria-label={t("feedback.filters")}>
        <TextField
          id="comments-query"
          type="search"
          label={t("feedback.search")}
          value={query}
          maxLength={200}
          onChange={(event) => setQuery(event.target.value)}
        />
        <SelectField
          id="comments-visibility"
          label={t("feedback.visibility")}
          value={visibility}
          onChange={(event) => setVisibility(event.target.value as CommentVisibility)}
        >
          <option value="ALL">{t("feedback.all")}</option>
          <option value="PUBLISHED">{t("feedback.published")}</option>
          <option value="HIDDEN">{t("feedback.hidden")}</option>
        </SelectField>
        {query || visibility !== "ALL" ? (
          <ActionButton
            tone="quiet"
            onClick={() => {
              setQuery("");
              setVisibility("ALL");
            }}
          >
            {t("feedback.clearFilters")}
          </ActionButton>
        ) : null}
      </div>
      {state.status === "loading" ? (
        <StatusNotice announce="polite">{t("feedback.commentsLoading")}</StatusNotice>
      ) : null}
      {state.status === "error" ? (
        <div className={styles.recovery}>
          <StatusNotice announce="assertive" tone="danger">
            {t("feedback.commentsError")}
          </StatusNotice>
          <div className={styles.actions}>
            <ActionButton tone="secondary" onClick={reload}>
              {t("feedback.retry")}
            </ActionButton>
            <ActionLink href={href("/login")}>{t("feedback.signIn")}</ActionLink>
          </div>
        </div>
      ) : null}
      {comments ? (
        <>
          <p role="status" className={styles.resultCount}>
            {t("feedback.results", {
              shown: formatNumber(rows.length),
              total: formatNumber(comments.length),
            })}
          </p>
          {rows.length ? (
            <DataTable
              caption={t("feedback.table")}
              rows={rows}
              columns={columns}
              rowKey={(comment) => comment.id}
            />
          ) : (
            <StatusNotice tone="neutral">
              {t(comments.length ? "feedback.noMatches" : "feedback.commentsEmpty")}
            </StatusNotice>
          )}
        </>
      ) : null}
    </>
  );
}
