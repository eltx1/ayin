"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import styles from "@/app/(viewer)/account/account.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import { apiBaseUrl, readApiError } from "@/lib/api";

import {
  parseAccountSessions,
  parseSessionRevoked,
  parseSessionsRevoked,
  parsePasswordChanged,
  type AccountSession,
} from "@/lib/account-session-response";

async function getSessions() {
  const response = await fetch(`${apiBaseUrl}/auth/sessions`, {
    credentials: "include",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return parseAccountSessions(await response.json());
}

export function AccountSecuritySessions() {
  const router = useRouter();
  const { formatDate, href, t, locale } = useI18n();
  const copy = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const pending = useRef(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void getSessions()
      .then((next) => {
        if (active) {
          setSessions(next);
          setVerified(true);
        }
      })
      .catch(() => {
        if (active) setError(t("account.sessionsLoadError"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [t]);

  async function refreshSessions() {
    setSessions(await getSessions());
    setVerified(true);
  }
  async function refreshAfterAcknowledgment() {
    try {
      await refreshSessions();
    } catch {
      setSessions([]);
      setVerified(false);
      setNeedsReview(true);
      setError(
        copy(
          "The operation was confirmed. The session list could not be refreshed. Read the current sessions before another operation.",
          "تم تأكيد العملية، لكن تعذّر تحديث قائمة الجلسات. اقرأ الجلسات الحالية قبل عملية أخرى.",
        ),
      );
    }
  }
  async function reviewSessions() {
    if (pending.current) return;
    pending.current = true;
    setBusy("read");
    setLoading(true);
    try {
      await refreshSessions();
      setNeedsReview(false);
      setError("");
    } catch {
      setSessions([]);
      setVerified(false);
      setNeedsReview(true);
      setError(t("account.sessionsLoadError"));
    } finally {
      pending.current = false;
      setBusy("");
      setLoading(false);
    }
  }

  async function revoke(session: AccountSession) {
    if (pending.current || loading || needsReview) return;
    pending.current = true;
    setBusy(session.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `${apiBaseUrl}/auth/sessions/${encodeURIComponent(session.id)}`,
        {
          method: "DELETE",
          credentials: "include",
          cache: "no-store",
          signal: AbortSignal.timeout(30000),
        },
      );
      if (!response.ok) throw new Error("The operation was not acknowledged.");
      parseSessionRevoked(await response.json(), session.current);
      if (session.current) {
        router.push(href("/login"));
        router.refresh();
        return;
      }
      setMessage(t("account.sessionRevoked"));
      await refreshAfterAcknowledgment();
    } catch {
      setNeedsReview(true);
      setError(
        copy(
          "The operation response was not confirmed. Read the current sessions before another operation; the request will not be replayed.",
          "لم يتم تأكيد رد العملية. اقرأ الجلسات الحالية قبل عملية أخرى؛ لن يُعاد إرسال الطلب.",
        ),
      );
    } finally {
      pending.current = false;
      setBusy("");
    }
  }

  async function revokeOthers() {
    if (pending.current || loading || needsReview) return;
    pending.current = true;
    setBusy("others");
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/auth/sessions/revoke-others`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error("The operation was not acknowledged.");
      const revoked = parseSessionsRevoked(await response.json());
      setMessage(
        revoked === 0
          ? t("account.sessionsNoneFound")
          : t("account.sessionsRevoked", { count: revoked }),
      );
      await refreshAfterAcknowledgment();
    } catch {
      setNeedsReview(true);
      setError(
        copy(
          "The operation response was not confirmed. Read the current sessions before another operation; the request will not be replayed.",
          "لم يتم تأكيد رد العملية. اقرأ الجلسات الحالية قبل عملية أخرى؛ لن يُعاد إرسال الطلب.",
        ),
      );
    } finally {
      pending.current = false;
      setBusy("");
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || loading || needsReview) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    if (newPassword !== confirmation) {
      setError(t("account.passwordMismatch"));
      return;
    }
    pending.current = true;
    setBusy("password");
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/auth/password/change`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          revokeOtherSessions: data.get("revokeOtherSessions") === "on",
        }),
      });
      if (!response.ok) throw new Error("The operation was not acknowledged.");
      parsePasswordChanged(await response.json());
      form.reset();
      setMessage(t("account.passwordUpdated"));
      await refreshAfterAcknowledgment();
    } catch {
      setNeedsReview(true);
      setError(
        copy(
          "The password change response was not confirmed. Read the current sessions before proceeding; the password change will not be replayed.",
          "لم يتم تأكيد رد تغيير كلمة المرور. اقرأ الجلسات الحالية قبل المتابعة؛ لن يُعاد إرسال تغيير كلمة المرور.",
        ),
      );
    } finally {
      pending.current = false;
      setBusy("");
    }
  }

  const current = sessions.find((session) => session.current);
  const others = sessions.filter((session) => !session.current);
  const dateLabel = (value: string) =>
    formatDate(value, { dateStyle: "medium", timeStyle: "short" });

  return (
    <section className={styles.securityCard} aria-labelledby="security-sessions-title">
      <div className={styles.securityHeading}>
        <div>
          <span className={styles.eyebrow}>{t("account.securityEyebrow")}</span>
          <h2 id="security-sessions-title">{t("account.securityTitle")}</h2>
          <p>{t("account.securityDescription")}</p>
        </div>
        <button
          className={styles.secondaryButton}
          disabled={loading || busy !== "" || needsReview || others.length === 0}
          onClick={() => void revokeOthers()}
          type="button"
        >
          {busy === "others" ? t("account.revoking") : t("account.revokeOthers")}
        </button>
      </div>

      <button
        className={styles.secondaryButton}
        type="button"
        disabled={loading || busy !== ""}
        onClick={() => void reviewSessions()}
      >
        {copy("Read current sessions", "قراءة الجلسات الحالية")}
      </button>
      {error ? (
        <p className={styles.error} dir="auto" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className={styles.success} role="status">
          {message}
        </p>
      ) : null}
      {loading ? <p className={styles.loading}>{t("account.sessionsLoading")}</p> : null}

      {!loading && verified && current ? (
        <div className={styles.sessionGroup}>
          <h3>{t("account.currentSession")}</h3>
          <SessionRow
            dateLabel={dateLabel}
            session={current}
            busy={needsReview || loading ? "review" : busy}
            onRevoke={revoke}
          />
        </div>
      ) : null}

      {!loading && verified ? (
        <div className={styles.sessionGroup}>
          <h3>{t("account.otherSessions")}</h3>
          {others.length ? (
            <div className={styles.sessionList}>
              {others.map((session) => (
                <SessionRow
                  dateLabel={dateLabel}
                  key={session.id}
                  session={session}
                  busy={needsReview || loading ? "review" : busy}
                  onRevoke={revoke}
                />
              ))}
            </div>
          ) : (
            <p className={styles.muted}>{t("account.noOtherSessions")}</p>
          )}
        </div>
      ) : null}

      <form className={styles.passwordForm} onSubmit={(event) => void changePassword(event)}>
        <h3>{t("account.changePassword")}</h3>
        <label>
          <span>{t("account.currentPassword")}</span>
          <input
            disabled={loading || busy !== "" || needsReview}
            autoComplete="current-password"
            dir="ltr"
            name="currentPassword"
            required
            type="password"
          />
        </label>
        <label>
          <span>{t("account.newPassword")}</span>
          <input
            disabled={loading || busy !== "" || needsReview}
            autoComplete="new-password"
            dir="ltr"
            minLength={10}
            name="newPassword"
            required
            type="password"
          />
        </label>
        <label>
          <span>{t("account.confirmPassword")}</span>
          <input
            disabled={loading || busy !== "" || needsReview}
            autoComplete="new-password"
            dir="ltr"
            minLength={10}
            name="confirmation"
            required
            type="password"
          />
        </label>
        <label className={styles.checkLabel}>
          <input
            disabled={loading || busy !== "" || needsReview}
            defaultChecked
            name="revokeOtherSessions"
            type="checkbox"
          />
          <span>{t("account.revokeAfterPassword")}</span>
        </label>
        <button
          className={styles.primaryButton}
          disabled={busy !== "" || needsReview}
          type="submit"
        >
          {busy === "password" ? t("account.updating") : t("account.updatePassword")}
        </button>
      </form>
    </section>
  );
}

function SessionRow({
  session,
  busy,
  onRevoke,
  dateLabel,
}: {
  session: AccountSession;
  busy: string;
  onRevoke: (session: AccountSession) => Promise<void>;
  dateLabel: (value: string) => string;
}) {
  const { t } = useI18n();
  return (
    <article className={styles.sessionRow}>
      <div>
        <strong dir="auto">{session.deviceLabel}</strong>
        {session.current ? (
          <span className={styles.currentBadge}>{t("common.current")}</span>
        ) : null}
        <p>{t("account.lastActive", { date: dateLabel(session.lastActiveAt) })}</p>
        <small>
          {t("account.createdExpires", {
            created: dateLabel(session.createdAt),
            expires: dateLabel(session.expiresAt),
          })}
        </small>
      </div>
      <button
        className={styles.dangerButton}
        disabled={busy !== ""}
        onClick={() => void onRevoke(session)}
        type="button"
      >
        {busy === session.id
          ? t("account.revoking")
          : session.current
            ? t("account.logoutSession")
            : t("account.revoke")}
      </button>
    </article>
  );
}
