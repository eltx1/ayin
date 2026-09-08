"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import styles from "@/app/(viewer)/account/account.module.css";
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

function dateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
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
        if (active) {
          setError(caught instanceof Error ? caught.message : "Sessions could not be loaded.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function refreshSessions() {
    setSessions(await getSessions());
  }

  async function revoke(session: AccountSession) {
    setBusy(session.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `${apiBaseUrl}/auth/sessions/${encodeURIComponent(session.id)}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );
      if (!response.ok) throw new Error(await readApiError(response));
      if (session.current) {
        router.push("/login");
        router.refresh();
        return;
      }
      await refreshSessions();
      setMessage("Session revoked.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The session could not be revoked.");
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
      setMessage(
        result.revoked === 0
          ? "No other active sessions were found."
          : `${result.revoked} other session${result.revoked === 1 ? "" : "s"} revoked.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Other sessions could not be revoked.");
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
      setError("New passwords do not match.");
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
      setMessage("Password updated securely.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The password could not be changed.");
    } finally {
      setBusy("");
    }
  }

  const current = sessions.find((session) => session.current);
  const others = sessions.filter((session) => !session.current);

  return (
    <section className={styles.securityCard} aria-labelledby="security-sessions-title">
      <div className={styles.securityHeading}>
        <div>
          <span className={styles.eyebrow}>Account security</span>
          <h2 id="security-sessions-title">Security &amp; sessions</h2>
          <p>Review where your AYIN account is signed in and remove access immediately.</p>
        </div>
        <button
          className={styles.secondaryButton}
          disabled={busy !== "" || others.length === 0}
          onClick={() => void revokeOthers()}
          type="button"
        >
          {busy === "others" ? "Revoking…" : "Revoke all other sessions"}
        </button>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}
      {message ? <p className={styles.success}>{message}</p> : null}
      {loading ? <p className={styles.loading}>Loading active sessions…</p> : null}

      {!loading && current ? (
        <div className={styles.sessionGroup}>
          <h3>Current session</h3>
          <SessionRow session={current} busy={busy} onRevoke={revoke} />
        </div>
      ) : null}

      {!loading ? (
        <div className={styles.sessionGroup}>
          <h3>Other active sessions</h3>
          {others.length ? (
            <div className={styles.sessionList}>
              {others.map((session) => (
                <SessionRow key={session.id} session={session} busy={busy} onRevoke={revoke} />
              ))}
            </div>
          ) : (
            <p className={styles.muted}>No other active sessions.</p>
          )}
        </div>
      ) : null}

      <form className={styles.passwordForm} onSubmit={(event) => void changePassword(event)}>
        <h3>Change password</h3>
        <label>
          <span>Current password</span>
          <input autoComplete="current-password" name="currentPassword" required type="password" />
        </label>
        <label>
          <span>New password</span>
          <input
            autoComplete="new-password"
            minLength={10}
            name="newPassword"
            required
            type="password"
          />
        </label>
        <label>
          <span>Confirm new password</span>
          <input
            autoComplete="new-password"
            minLength={10}
            name="confirmation"
            required
            type="password"
          />
        </label>
        <label className={styles.checkLabel}>
          <input defaultChecked name="revokeOtherSessions" type="checkbox" />
          <span>Revoke all other sessions after changing my password</span>
        </label>
        <button className={styles.primaryButton} disabled={busy !== ""} type="submit">
          {busy === "password" ? "Updating…" : "Update password"}
        </button>
      </form>
    </section>
  );
}

function SessionRow({
  session,
  busy,
  onRevoke,
}: {
  session: AccountSession;
  busy: string;
  onRevoke: (session: AccountSession) => Promise<void>;
}) {
  return (
    <article className={styles.sessionRow}>
      <div>
        <strong>{session.deviceLabel}</strong>
        {session.current ? <span className={styles.currentBadge}>Current</span> : null}
        <p>Last active {dateLabel(session.lastActiveAt)}</p>
        <small>
          Created {dateLabel(session.createdAt)} · Expires {dateLabel(session.expiresAt)}
        </small>
      </div>
      <button
        className={styles.dangerButton}
        disabled={busy !== ""}
        onClick={() => void onRevoke(session)}
        type="button"
      >
        {busy === session.id ? "Revoking…" : session.current ? "Log out this session" : "Revoke"}
      </button>
    </article>
  );
}
