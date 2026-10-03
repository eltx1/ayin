"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/i18n-provider";
import {
  ActionButton,
  ActionLink,
  PageHeader,
  SelectField,
  StatusNotice,
} from "@/components/ui/design-system";
import { Disclosure, PageControls } from "@/components/ui/data-presentation";
import { getAdminCollection } from "@/lib/admin-control";
import { canReadModeration, parseModerationPage, reportStatuses } from "@/lib/admin-moderation";
import { moderationAr, moderationEn } from "@/lib/i18n/resources/admin-moderation";
import { useAdminAccess } from "./admin-access";
import styles from "./admin-moderation.module.css";

export function AdminModeration() {
  const { locale } = useI18n();
  const copy = locale === "ar" ? moderationAr : moderationEn;
  const { session, loading, refresh } = useAdminAccess();
  if (session && canReadModeration(session.roles))
    return <ModerationQueue key={`${session.accountId}:${session.roles.join(":")}`} />;
  return (
    <>
      <PageHeader title={copy.title} description={copy.description} />
      {loading ? (
        <StatusNotice announce="polite">{copy.accessLoading}</StatusNotice>
      ) : session ? (
        <StatusNotice tone="warning">{copy.denied}</StatusNotice>
      ) : (
        <StatusNotice tone="danger" announce="assertive">
          {copy.accessError} <ActionButton onClick={refresh}>{copy.retryAccess}</ActionButton>
        </StatusNotice>
      )}
    </>
  );
}
function ModerationQueue() {
  const { locale, href } = useI18n();
  const copy = locale === "ar" ? moderationAr : moderationEn;
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((value) => value + 1);
  return (
    <div className={styles.workspace}>
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <ActionLink tone="secondary" href={href("/admin/trust")}>
            {copy.safety}
          </ActionLink>
        }
      />
      <div className={styles.toolbar}>
        <SelectField
          id="moderation-status"
          label={copy.filter}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">{copy.active}</option>
          {reportStatuses.map((value) => (
            <option key={value} value={value}>
              {copy.statuses[value]}
            </option>
          ))}
        </SelectField>
        <ActionButton tone="secondary" onClick={refresh}>
          {copy.refresh}
        </ActionButton>
      </div>
      <ReportPage
        key={`${page}:${status}:${revision}`}
        page={page}
        status={status}
        onRetry={refresh}
        onPage={setPage}
      />
    </div>
  );
}
function ReportPage({
  page,
  status,
  onRetry,
  onPage,
}: {
  page: number;
  status: string;
  onRetry: () => void;
  onPage: (page: number) => void;
}) {
  const { locale, formatNumber, formatDate } = useI18n();
  const copy = locale === "ar" ? moderationAr : moderationEn;
  const [result, setResult] = useState<ReturnType<typeof parseModerationPage> | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (controller.signal.aborted) return;
      controller.abort();
      setError(true);
    }, 15000);
    const params = new URLSearchParams({ page: String(page), take: "25" });
    if (status) params.set("status", status);
    void getAdminCollection<unknown>("moderation", params, controller.signal)
      .then((response) => {
        const parsed = parseModerationPage(response, page, status);
        if (!controller.signal.aborted) setResult(parsed);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [page, status]);
  if (error)
    return (
      <StatusNotice tone="danger" announce="assertive">
        {copy.error} <ActionButton onClick={onRetry}>{copy.retry}</ActionButton>
      </StatusNotice>
    );
  if (!result) return <StatusNotice announce="polite">{copy.loading}</StatusNotice>;
  return (
    <section aria-label={copy.reports}>
      {!result.reports.length ? (
        <StatusNotice announce="polite">{copy.empty}</StatusNotice>
      ) : (
        <ul className={styles.list}>
          {result.reports.map((report) => (
            <li key={report.id}>
              <article className={styles.report}>
                <h2>
                  {copy.reasons[report.reason]} · {copy.statuses[report.status]}
                </h2>
                <dl className={styles.facts}>
                  <div>
                    <dt>{copy.reporter}</dt>
                    <dd dir="auto">{report.reporterProfile.name}</dd>
                  </div>
                  <div>
                    <dt>{copy.created}</dt>
                    <dd>
                      <time dateTime={report.createdAt}>
                        {formatDate(report.createdAt, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "UTC",
                        })}{" "}
                        UTC
                      </time>
                    </dd>
                  </div>
                  <div>
                    <dt>{copy.case}</dt>
                    <dd>
                      {report.moderationCase
                        ? copy.statuses[report.moderationCase.status]
                        : copy.unassigned}
                    </dd>
                  </div>
                </dl>
                <p dir="auto">
                  {report.video
                    ? `${copy.video}: ${report.video.title}`
                    : report.channel
                      ? `${copy.channel}: @${report.channel.handle}`
                      : report.comment
                        ? copy.comment
                        : copy.unavailable}
                </p>
                <Disclosure summary={copy.full}>
                  <p className={styles.body} dir="auto">
                    {report.details || copy.noDetails}
                  </p>
                  {report.comment ? (
                    <p className={styles.body} dir="auto">
                      {copy.comment}: {report.comment.body}
                    </p>
                  ) : null}
                  {report.moderationCase?.summary ? (
                    <p className={styles.body} dir="auto">
                      {copy.case}: {report.moderationCase.summary}
                    </p>
                  ) : null}
                </Disclosure>
              </article>
            </li>
          ))}
        </ul>
      )}
      <PageControls
        label={copy.pagination}
        summary={`${copy.page} ${formatNumber(result.pagination.page)} ${copy.of} ${formatNumber(result.pagination.pages)} · ${formatNumber(result.pagination.total)} ${copy.reports}`}
        previousLabel={copy.previous}
        nextLabel={copy.next}
        hasPrevious={page > 1}
        hasNext={page < result.pagination.pages}
        onPrevious={() => onPage(Math.max(1, page - 1))}
        onNext={() => onPage(page + 1)}
      />
    </section>
  );
}
