"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import styles from "@/app/(viewer)/account/account.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import { AccountScopeError, requestAccountScope } from "@/lib/account-scope";

import {
  parseAccountSessions,
  parseSessionRevoked,
  parseSessionsRevoked,
  parsePasswordChanged,
  type AccountSession,
} from "@/lib/account-session-response";

import { useAccountFreeze, useAccountWorkspace } from "./account-workspace";

export function AccountSecuritySessions() {
  const router = useRouter();
  const { formatDate, href, t, locale } = useI18n();
  const copy = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const binding = useAccountWorkspace();
  const pending = useRef(false);
  const account = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const privateBody = useRef<HTMLDivElement>(null);
  const passwordForm = useRef<HTMLFormElement>(null);
  const [concealed, setConcealed] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useAccountFreeze(binding, () => conceal());
  function conceal(clearAccount = false) {
    if (clearAccount && binding) {
      binding.freeze();
      return;
    }
    if (privateBody.current) privateBody.current.hidden = true;
    passwordForm.current?.reset();
    controller.current?.abort();
    generation.current += 1;
    pending.current = false;
    if (clearAccount) account.current = undefined;
    setConcealed(true);
    setSessions([]);
    setVerified(false);
    setNeedsReview(true);
    setMessage("");
    setBusy("");
    setLoading(false);
  }
  function scopeLost(error: unknown) {
    return (
      error instanceof AccountScopeError &&
      (error.code === "ACCOUNT_CHANGED" || error.status === 401)
    );
  }
  async function refreshSessions(signal: AbortSignal, epoch: number) {
    const result = await requestAccountScope("/auth/sessions", "GET", parseAccountSessions, {
      expectedAccountId: binding?.expectedAccount() ?? account.current,
      signal,
    });
    if (epoch !== generation.current || signal.aborted) return;
    account.current = result.accountId;
    setSessions(result.value);
    setVerified(true);
    setConcealed(false);
  }
  async function reviewSessions() {
    if (pending.current) return;
    pending.current = true;
    const epoch = generation.current;
    const active = new AbortController();
    controller.current = active;
    setBusy("read");
    setLoading(true);
    try {
      await refreshSessions(active.signal, epoch);
      if (epoch !== generation.current || active.signal.aborted) return;
      setNeedsReview(false);
      setError("");
    } catch (error) {
      if (epoch !== generation.current || active.signal.aborted) return;
      if (scopeLost(error)) conceal(true);
      else {
        setSessions([]);
        setVerified(false);
        setNeedsReview(true);
      }
      setError(t("account.sessionsLoadError"));
    } finally {
      if (epoch === generation.current) {
        pending.current = false;
        setBusy("");
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    let mounted = true;
    const initialGeneration = generation.current;
    void Promise.resolve().then(() => {
      if (mounted && initialGeneration === generation.current) void reviewSessions();
    });
    const hide = () => {
      conceal();
      setError(copy("Read the current sessions to continue.", "اقرأ الجلسات الحالية للمتابعة."));
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") hide();
    };
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted = false;
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", visibility);
      controller.current?.abort();
      generation.current += 1;
      pending.current = false;
    };
    // Mount reads once; lifecycle recovery requires an explicit action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function command<T>(
    key: string,
    path: string,
    method: "POST" | "DELETE",
    decode: (value: unknown) => T,
    success: (value: T) => string,
    body?: Record<string, unknown>,
    currentLogout = false,
  ) {
    if (pending.current || loading || needsReview || !verified || !account.current) return;
    pending.current = true;
    const epoch = generation.current,
      active = new AbortController();
    controller.current = active;
    setBusy(key);
    setError("");
    setMessage("");
    try {
      const result = await requestAccountScope(
        path,
        method,
        decode,
        {
          expectedAccountId: binding?.expectedAccount() ?? account.current,
          signal: active.signal,
          allowCurrentLogout: currentLogout,
        },
        body,
      );
      if (epoch !== generation.current || active.signal.aborted) return;
      if (currentLogout) {
        conceal(true);
        router.push(href("/login"));
        router.refresh();
        return;
      }
      if (key === "password") passwordForm.current?.reset();
      setMessage(success(result.value));
      try {
        await refreshSessions(active.signal, epoch);
      } catch (error) {
        if (epoch !== generation.current || active.signal.aborted) return;
        if (scopeLost(error)) conceal(true);
        else {
          setSessions([]);
          setVerified(false);
          setNeedsReview(true);
        }
        setError(
          copy(
            "The operation was confirmed. The session list could not be refreshed. Read the current sessions before another operation.",
            "تم تأكيد العملية، لكن تعذّر تحديث قائمة الجلسات. اقرأ الجلسات الحالية قبل عملية أخرى.",
          ),
        );
      }
    } catch (error) {
      if (epoch !== generation.current || active.signal.aborted) return;
      if (scopeLost(error)) {
        conceal(true);
        setError(
          copy(
            "The account changed. Read the current sessions before proceeding.",
            "تغيّر الحساب. اقرأ الجلسات الحالية قبل المتابعة.",
          ),
        );
      } else {
        if (key === "password") passwordForm.current?.reset();
        setNeedsReview(true);
        setError(
          copy(
            "The operation response was not confirmed. Read the current sessions before another operation; the request will not be replayed.",
            "لم يتم تأكيد رد العملية. اقرأ الجلسات الحالية قبل عملية أخرى؛ لن يُعاد إرسال الطلب.",
          ),
        );
      }
    } finally {
      if (epoch === generation.current) {
        pending.current = false;
        setBusy("");
      }
    }
  }
  async function revoke(session: AccountSession) {
    await command(
      session.id,
      `/auth/sessions/${encodeURIComponent(session.id)}`,
      "DELETE",
      (value) => {
        parseSessionRevoked(value, session.current);
        return { currentSessionRevoked: session.current };
      },
      () => t("account.sessionRevoked"),
      undefined,
      session.current,
    );
  }
  async function revokeOthers() {
    await command(
      "others",
      "/auth/sessions/revoke-others",
      "POST",
      parseSessionsRevoked,
      (revoked) =>
        revoked === 0
          ? t("account.sessionsNoneFound")
          : t("account.sessionsRevoked", { count: revoked }),
    );
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget),
      newPassword = String(data.get("newPassword") ?? "");
    if (newPassword !== String(data.get("confirmation") ?? "")) {
      setError(t("account.passwordMismatch"));
      return;
    }
    await command(
      "password",
      "/auth/password/change",
      "POST",
      parsePasswordChanged,
      () => t("account.passwordUpdated"),
      {
        currentPassword: String(data.get("currentPassword") ?? ""),
        newPassword,
        revokeOtherSessions: data.get("revokeOtherSessions") === "on",
      },
    );
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
          disabled={loading || busy !== "" || needsReview || !verified || others.length === 0}
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
      <div
        ref={privateBody}
        className={styles.sessionPrivate}
        hidden={concealed}
        data-private-account-sessions="true"
      >
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

        <form
          ref={passwordForm}
          className={styles.passwordForm}
          onSubmit={(event) => void changePassword(event)}
        >
          <h3>{t("account.changePassword")}</h3>
          <label>
            <span>{t("account.currentPassword")}</span>
            <input
              disabled={loading || busy !== "" || needsReview || !verified}
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
              disabled={loading || busy !== "" || needsReview || !verified}
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
              disabled={loading || busy !== "" || needsReview || !verified}
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
              disabled={loading || busy !== "" || needsReview || !verified}
              defaultChecked
              name="revokeOtherSessions"
              type="checkbox"
            />
            <span>{t("account.revokeAfterPassword")}</span>
          </label>
          <button
            className={styles.primaryButton}
            disabled={loading || busy !== "" || needsReview || !verified}
            type="submit"
          >
            {busy === "password" ? t("account.updating") : t("account.updatePassword")}
          </button>
        </form>
      </div>
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
