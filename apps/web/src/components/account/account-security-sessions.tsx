"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import styles from "@/app/(viewer)/account/account.module.css";
import { useI18n } from "@/components/i18n/i18n-provider";
import { apiBaseUrl, readApiError } from "@/lib/api";

interface AccountSession {
  id: string;
  current: boolean;
  status: "ACTIVE";
  deviceLabel: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
}

async function getSessions() {
  const response = await fetch(`${apiBaseUrl}/auth/sessions`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return ((await response.json()) as { sessions: AccountSession[] }).sessions;
}

export function AccountSecuritySessions() {
  const router = useRouter();
  const { formatDate, href, t } = useI18n();
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void getSessions()
      .then((next) => {
        if (active) setSessions(next);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : t("account.sessionsLoadError"));
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
  }

  async function revoke(session: AccountSession) {
    setBusy(session.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/auth/sessions/${encodeURIComponent(session.id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error(await readApiError(response));
      if (session.current) {
        router.push(href("/login"));
        router.refresh();
        return;
      }
      await refreshSessions();
      setMessage(t("account.sessionRevoked"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("account.sessionRevokeError"));
    } finally {
      setBusy("");
    }
  }

  async function revokeOthers() {
    setBusy("others");
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/auth/sessions/revoke-others`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const result = (await response.json()) as { revoked: number };
      await refreshSessions();
      setMessage(result.revoked === 0 ? t("account.sessionsNoneFound") : t("account.sessionsRevoked", { count: result.revoked }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("account.sessionsRevokeError"));
    } finally {
      setBusy("");
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    if (newPassword !== confirmation) {
      setError(t("account.passwordMismatch"));
      return;
    }
    setBusy("password");
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/auth/password/change`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          revokeOtherSessions: data.get("revokeOtherSessions") === "on",
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      form.reset();
      await refreshSessions();
      setMessage(t("account.passwordUpdated"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("account.passwordChangeError"));
    } finally {
      setBusy("");
    }
  }

  const current = sessions.find((session) => session.current);
  const others = sessions.filter((session) => !session.current);
  const dateLabel = (value: string) => formatDate(value, { dateStyle: "medium", timeStyle: "short" });

  return (
    <section className={styles.securityCard} aria-labelledby="security-sessions-title">
      <div className={styles.securityHeading}>
        <div>
          <span className={styles.eyebrow}>{t("account.securityEyebrow")}</span>
          <h2 id="security-sessions-title">{t("account.securityTitle")}</h2>
          <p>{t("account.securityDescription")}</p>
        </div>
        <button className={styles.secondaryButton} disabled={busy !== "" || others.length === 0} onClick={() => void revokeOthers()} type="button">
          {busy === "others" ? t("account.revoking") : t("account.revokeOthers")}
        </button>
      </div>

      {error ? <p className={styles.error} dir="auto">{error}</p> : null}
      {message ? <p className={styles.success}>{message}</p> : null}
      {loading ? <p className={styles.loading}>{t("account.sessionsLoading")}</p> : null}

      {!loading && current ? (
        <div className={styles.sessionGroup}>
          <h3>{t("account.currentSession")}</h3>
          <SessionRow dateLabel={dateLabel} session={current} busy={busy} onRevoke={revoke} />
        </div>
      ) : null}

      {!loading ? (
        <div className={styles.sessionGroup}>
          <h3>{t("account.otherSessions")}</h3>
          {others.length ? (
            <div className={styles.sessionList}>
              {others.map((session) => <SessionRow dateLabel={dateLabel} key={session.id} session={session} busy={busy} onRevoke={revoke} />)}
            </div>
          ) : (
            <p className={styles.muted}>{t("account.noOtherSessions")}</p>
          )}
        </div>
      ) : null}

      <form className={styles.passwordForm} onSubmit={(event) => void changePassword(event)}>
        <h3>{t("account.changePassword")}</h3>
        <label><span>{t("account.currentPassword")}</span><input autoComplete="current-password" dir="ltr" name="currentPassword" required type="password" /></label>
        <label><span>{t("account.newPassword")}</span><input autoComplete="new-password" dir="ltr" minLength={10} name="newPassword" required type="password" /></label>
        <label><span>{t("account.confirmPassword")}</span><input autoComplete="new-password" dir="ltr" minLength={10} name="confirmation" required type="password" /></label>
        <label className={styles.checkLabel}>
          <input defaultChecked name="revokeOtherSessions" type="checkbox" />
          <span>{t("account.revokeAfterPassword")}</span>
        </label>
        <button className={styles.primaryButton} disabled={busy !== ""} type="submit">
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
        {session.current ? <span className={styles.currentBadge}>{t("common.current")}</span> : null}
        <p>{t("account.lastActive", { date: dateLabel(session.lastActiveAt) })}</p>
        <small>{t("account.createdExpires", { created: dateLabel(session.createdAt), expires: dateLabel(session.expiresAt) })}</small>
      </div>
      <button className={styles.dangerButton} disabled={busy !== ""} onClick={() => void onRevoke(session)} type="button">
        {busy === session.id ? t("account.revoking") : session.current ? t("account.logoutSession") : t("account.revoke")}
      </button>
    </article>
  );
}
