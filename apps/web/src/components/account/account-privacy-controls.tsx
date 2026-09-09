"use client";

import { useEffect, useState, type FormEvent } from "react";

import styles from "@/app/(viewer)/account/account.module.css";
import { apiBaseUrl, readApiError } from "@/lib/api";

const CONFIRMATION = "DELETE MY AYIN ACCOUNT";

interface DeletionRequest {
  id: string;
  state: "REQUESTED" | "GRACE_PERIOD" | "DEACTIVATED" | "ANONYMIZED" | "CANCELLED";
  requestedAt: string;
  graceEndsAt: string | null;
  deactivatedAt: string | null;
  anonymizedAt: string | null;
  cancelledAt: string | null;
  mediaCleanupQueuedAt: string | null;
  mediaCleanupCompletedAt: string | null;
}

interface PrivacyStatus {
  policy: {
    gracePeriodDays: number;
    deactivatedRecoveryHours: number;
    finalDatabaseState: "ANONYMIZED";
  };
  request: DeletionRequest | null;
}

async function readStatus(): Promise<PrivacyStatus> {
  const response = await fetch(`${apiBaseUrl}/privacy/deletion`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as PrivacyStatus;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function AccountPrivacyControls() {
  const [status, setStatus] = useState<PrivacyStatus | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    setStatus(await readStatus());
  }

  useEffect(() => {
    let active = true;
    void readStatus().then(
      (nextStatus) => {
        if (active) setStatus(nextStatus);
      },
      (caught) => {
        if (active) {
          setError(
            caught instanceof Error ? caught.message : "Privacy controls could not be loaded.",
          );
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function downloadData() {
    setBusy("export");
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/privacy/export`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const name = disposition.match(/filename="([^"]+)"/)?.[1] ?? "ayin-data-export.json";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage("Your AYIN data export was prepared for download.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your data export could not be created.");
    } finally {
      setBusy("");
    }
  }

  async function requestDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy("delete");
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/privacy/deletion`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          password: String(data.get("password") ?? ""),
          confirmation: String(data.get("confirmation") ?? ""),
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      form.reset();
      await refresh();
      setMessage("Account deletion requested. You can cancel during the grace period.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Account deletion could not be requested.",
      );
    } finally {
      setBusy("");
    }
  }

  async function cancelDeletion() {
    setBusy("cancel");
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/privacy/deletion/cancel`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error(await readApiError(response));
      await refresh();
      setMessage("Deletion request cancelled.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Deletion could not be cancelled.");
    } finally {
      setBusy("");
    }
  }

  const active = status?.request;
  const cancellable = active?.state === "REQUESTED" || active?.state === "GRACE_PERIOD";

  return (
    <section className={styles.securityCard} aria-labelledby="privacy-data-title">
      <div className={styles.securityHeading}>
        <div>
          <span className={styles.eyebrow}>Privacy controls</span>
          <h2 id="privacy-data-title">Privacy &amp; data</h2>
          <p>Download your account data or start the controlled account-deletion lifecycle.</p>
        </div>
        <button
          className={styles.secondaryButton}
          disabled={busy !== ""}
          onClick={() => void downloadData()}
          type="button"
        >
          {busy === "export" ? "Preparing…" : "Download my data"}
        </button>
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}
      {message ? <p className={styles.success}>{message}</p> : null}

      {active ? (
        <div className={styles.sessionGroup}>
          <h3>Deletion request status</h3>
          <div className={styles.sessionRow}>
            <div>
              <strong>{active.state.replaceAll("_", " ")}</strong>
              <p>Requested {formatDate(active.requestedAt)}</p>
              <small>
                Grace ends {formatDate(active.graceEndsAt)} · Deactivated{" "}
                {formatDate(active.deactivatedAt)}
              </small>
            </div>
            {cancellable ? (
              <button
                className={styles.secondaryButton}
                disabled={busy !== ""}
                onClick={() => void cancelDeletion()}
                type="button"
              >
                {busy === "cancel" ? "Cancelling…" : "Cancel deletion"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={styles.sessionGroup}>
        <h3>What deletion does</h3>
        <p className={styles.muted}>
          AYIN uses a {status?.policy.gracePeriodDays ?? 14}-day grace period. After it ends, the
          account is deactivated and sessions stop working. After the additional technical recovery
          window, identity data is anonymized, creator content is removed from publication, and
          media objects are queued for asynchronous deletion.
        </p>
        <p className={styles.muted}>
          Financial accounting records, fraud/security evidence, moderation evidence and audit
          records may remain where deleting them would break those records; identity fields are
          anonymized where appropriate. This describes AYIN&apos;s implemented technical behavior
          and is not a claim of legal compliance or a statement of every jurisdiction&apos;s
          retention requirements.
        </p>
      </div>

      {!active || active.state === "CANCELLED" ? (
        <form className={styles.passwordForm} onSubmit={(event) => void requestDeletion(event)}>
          <h3>Request account deletion</h3>
          <label>
            <span>Current password</span>
            <input autoComplete="current-password" name="password" required type="password" />
          </label>
          <label>
            <span>Type {CONFIRMATION}</span>
            <input autoComplete="off" name="confirmation" required type="text" />
          </label>
          <p className={styles.muted}>
            Download your data first if you want a copy. Continuing starts the grace period; it does
            not immediately erase retained financial, security, moderation or audit history.
          </p>
          <button className={styles.dangerButton} disabled={busy !== ""} type="submit">
            {busy === "delete" ? "Requesting…" : "Request account deletion"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
