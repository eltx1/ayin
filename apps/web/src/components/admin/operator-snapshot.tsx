"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import styles from "@/app/admin/admin.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import { useAdminAccess } from "./admin-access";

export function OperatorSnapshot<T>({
  title,
  allowed,
  load,
  children,
  revision: externalRevision = 0,
  readOnly = true,
}: {
  title: string;
  allowed: boolean;
  load: (signal: AbortSignal) => Promise<T>;
  children: (data: T) => ReactNode;
  revision?: number;
  readOnly?: boolean;
}) {
  const {
    session,
    error: accessError,
    loading: accessLoading,
    refresh: refreshAccess,
  } = useAdminAccess();
  const { locale, href, formatDate } = useI18n();
  const ar = locale === "ar";
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data: T | null;
    error: string;
    updatedAt: Date | null;
  } | null>(null);
  const key = `${session?.accountId ?? ""}:${session?.roles.join(",") ?? ""}:${revision}:${externalRevision}`;
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!allowed || !session) return;
    const controller = new AbortController();
    void load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data, error: "", updatedAt: new Date() });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            data: null,
            updatedAt: null,
            error: cause instanceof Error ? cause.message : "Unable to load this snapshot.",
          });
      });
    return () => controller.abort();
  }, [allowed, session, load, key]);
  const current = result?.key === key ? result : null;
  const loading = allowed && current === null;
  const data = current?.data ?? null;
  const error = current?.error ?? "";
  const updatedAt = current?.updatedAt ?? null;
  return (
    <div className={styles.operatorWorkspace}>
      <header className={styles.header}>
        <div>
          <Link href={href("/admin/operations")}>{ar ? "العمليات" : "Operations"}</Link>
          <h1>{title}</h1>
          <p className={styles.muted}>
            {readOnly
              ? ar
                ? "لقطة للقراءة فقط. حدّثها للاطلاع على الحالة الحالية."
                : "Read-only snapshot. Refresh to see the current state."
              : ar
                ? "حدّث اللقطة للاطلاع على الحالة الحالية. تُراجع صلاحية كل إجراء عند تنفيذه."
                : "Refresh to see the current state. Every action is checked again when submitted."}
          </p>
        </div>
        {allowed ? (
          <button className={styles.button} disabled={loading} onClick={refresh}>
            {ar ? "تحديث" : "Refresh"}
          </button>
        ) : null}
      </header>
      {accessLoading || loading ? <p role="status">{ar ? "جارٍ التحميل…" : "Loading…"}</p> : null}
      {accessError ? (
        <div role="alert" className={styles.error}>
          <p>{accessError}</p>
          <button className={styles.button} onClick={refreshAccess}>
            {ar ? "إعادة المحاولة" : "Retry access"}
          </button>
        </div>
      ) : null}
      {session && !allowed ? (
        <p role="alert" className={styles.error}>
          {ar
            ? "دورك الحالي لا يسمح بعرض هذه البيانات."
            : "Your current role cannot view these operational details."}
        </p>
      ) : null}
      {allowed && error ? (
        <div role="alert" className={styles.error}>
          <p>{error}</p>
          <button className={styles.button} onClick={refresh}>
            {ar ? "إعادة المحاولة" : "Retry"}
          </button>
        </div>
      ) : null}
      {allowed && updatedAt ? (
        <p role="status" className={styles.muted}>
          {ar ? "آخر جلب:" : "Fetched:"}{" "}
          {formatDate(updatedAt, { dateStyle: "medium", timeStyle: "medium" })}
        </p>
      ) : null}
      {allowed && data !== null ? children(data) : null}
    </div>
  );
}

export function OperatorTable({
  label,
  headings,
  children,
}: {
  label: string;
  headings: string[];
  children: ReactNode;
}) {
  return (
    <div className={styles.tableWrap} role="region" aria-label={label} tabIndex={0}>
      <table className={styles.table}>
        <caption className={styles.operatorCaption}>{label}</caption>
        <thead>
          <tr>
            {headings.map((heading) => (
              <th scope="col" key={heading}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
