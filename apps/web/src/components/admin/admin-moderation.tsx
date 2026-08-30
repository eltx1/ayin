"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { getAdminCollection, type AdminPagination } from "@/lib/admin-control";

type ReportItem = {
  id: string;
  reason: string;
  details: string | null;
  status: string;
  createdAt: string;
  reporterProfile: { id: string; name: string; slug: string };
  channel: { id: string; handle: string; name: string } | null;
  video: { id: string; title: string } | null;
  comment: { id: string; body: string } | null;
  moderationCase: { id: string; status: string; summary: string | null } | null;
};
type Response = { reports: ReportItem[]; pagination: AdminPagination };

export function AdminModeration() {
  const [data, setData] = useState<Response | null>(null);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const params = useMemo(() => {
    const next = new URLSearchParams({ page: String(page), take: "25" });
    if (status) next.set("status", status);
    return next;
  }, [page, status]);

  useEffect(() => {
    let active = true;
    void getAdminCollection<Response>("moderation", params)
      .then((response) => {
        if (active) {
          setData(response);
          setError(null);
        }
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof Error ? caught.message : "Moderation queue could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, [params]);

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Control Plane</span>
          <h1>Moderation</h1>
          <p className={styles.muted}>
            Triage reports and cases here; detailed rights, takedown, appeal and creator-trust
            controls are available in Trust &amp; Safety.
          </p>
        </div>
      </header>
      <div className={styles.toolbar}>
        <select
          aria-label="Filter reports"
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
          value={status}
        >
          <option value="">Open and reviewing</option>
          <option value="OPEN">Open</option>
          <option value="REVIEWING">Reviewing</option>
          <option value="RESOLVED">Resolved</option>
          <option value="DISMISSED">Dismissed</option>
        </select>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      <section className={styles.grid}>
        {data?.reports.map((report) => (
          <article className={styles.card} key={report.id}>
            <div className={styles.cardHeader}>
              <div>
                <strong>{report.reason.replaceAll("_", " ")}</strong>
                <p className={styles.muted}>
                  {report.status.toLowerCase()} · {new Date(report.createdAt).toLocaleString()} ·
                  reporter {report.reporterProfile.name}
                </p>
              </div>
              <span>
                {report.moderationCase
                  ? `Case ${report.moderationCase.status.toLowerCase()}`
                  : "Unassigned"}
              </span>
            </div>
            <p>{report.details ?? "No additional details."}</p>
            <p className={styles.muted}>
              {report.video
                ? `Video: ${report.video.title}`
                : report.comment
                  ? `Comment: ${report.comment.body.slice(0, 120)}`
                  : report.channel
                    ? `Channel: @${report.channel.handle}`
                    : "Target unavailable"}
            </p>
          </article>
        ))}
      </section>
      {data ? (
        <div className={styles.pager}>
          <button
            className={styles.button}
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            type="button"
          >
            Previous
          </button>
          <span className={styles.muted}>
            Page {data.pagination.page} of {data.pagination.pages} · {data.pagination.total} reports
          </span>
          <button
            className={styles.button}
            disabled={page >= data.pagination.pages}
            onClick={() => setPage((value) => value + 1)}
            type="button"
          >
            Next
          </button>
        </div>
      ) : null}
    </>
  );
}
