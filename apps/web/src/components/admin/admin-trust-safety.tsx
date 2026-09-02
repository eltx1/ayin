"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { apiBaseUrl, readApiError } from "@/lib/api";
import { getAdminSession, type AdminSession } from "@/lib/admin-control";

type Report = {
  id: string;
  status: string;
  reason: string;
  details?: string | null;
  videoId?: string | null;
  commentId?: string | null;
  createdAt?: string;
};
type ModerationCase = {
  id: string;
  status: string;
  resolution?: string | null;
  createdAt?: string;
  reports: Report[];
};
type Takedown = {
  id: string;
  status: string;
  claimantName: string;
  contactEmail: string;
  rightsBasis: string;
  details: string;
  videoId?: string | null;
  createdAt?: string;
};
type Appeal = {
  id: string;
  status: string;
  message: string;
  createdAt?: string;
  action: {
    id: string;
    kind: string;
    reason: string;
    targetAccountId?: string | null;
    channelId?: string | null;
    videoId?: string | null;
  };
};
type Queue = {
  reports: Report[];
  cases: ModerationCase[];
  takedowns: Takedown[];
  appeals: Appeal[];
};
type TrustSettings = { blockedTerms: string[]; newCreatorsRequireReview: boolean };

async function trustApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as T;
}

export function AdminTrustSafety() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [settings, setSettings] = useState<TrustSettings | null>(null);
  const [session, setSession] = useState<AdminSession | null>(null);
  const [blockedTermsText, setBlockedTermsText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextQueue, nextSettings, nextSession] = await Promise.all([
      trustApi<Queue>("/admin/trust/queue"),
      trustApi<TrustSettings>("/admin/trust/settings"),
      getAdminSession(),
    ]);
    setQueue(nextQueue);
    setSettings(nextSettings);
    setSession(nextSession);
    setBlockedTermsText(nextSettings.blockedTerms.join("\n"));
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void load().catch((caught) => {
        if (active)
          setError(
            caught instanceof Error ? caught.message : "Trust & Safety could not be loaded.",
          );
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [load]);

  const canManageSettings = useMemo(
    () =>
      Boolean(session?.roles.some((role) => ["SUPERADMIN", "ADMIN", "OPERATIONS"].includes(role))),
    [session],
  );

  const totalOpen =
    (queue?.reports.length ?? 0) +
    (queue?.cases.length ?? 0) +
    (queue?.takedowns.length ?? 0) +
    (queue?.appeals.length ?? 0);

  async function mutate<T>(key: string, path: string, method: string, body: unknown): Promise<T> {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      const result = await trustApi<T>(path, { method, body: JSON.stringify(body) });
      await load();
      return result;
    } catch (caught) {
      const next = caught instanceof Error ? caught.message : "Trust & Safety operation failed.";
      setError(next);
      throw caught;
    } finally {
      setBusy(null);
    }
  }

  async function decideCase(item: ModerationCase, status: string) {
    const resolution = window.prompt(`Resolution for case ${item.id}:`, item.resolution ?? "");
    if (resolution === null) return;
    await mutate(item.id, `/admin/trust/cases/${encodeURIComponent(item.id)}`, "PATCH", {
      status,
      ...(resolution.trim() ? { resolution: resolution.trim() } : {}),
    }).then(() => setMessage(`Case marked ${status}.`));
  }

  async function decideTakedown(item: Takedown, status: string) {
    const resolution = window.prompt(
      `Decision reason for ${item.claimantName}'s takedown:`,
      "Reviewed against AYIN copyright policy and submitted rights evidence.",
    );
    if (!resolution?.trim()) return;
    await mutate(item.id, `/admin/trust/takedowns/${encodeURIComponent(item.id)}`, "PATCH", {
      status,
      resolution: resolution.trim(),
    }).then(() => setMessage(`Takedown marked ${status}.`));
  }

  async function decideAppeal(item: Appeal, status: string) {
    const resolution = window.prompt(
      `Appeal resolution for ${item.action.kind}:`,
      status === "OVERTURNED" ? "Action overturned after review." : "Action upheld after review.",
    );
    if (!resolution?.trim()) return;
    await mutate(item.id, `/admin/trust/appeals/${encodeURIComponent(item.id)}`, "PATCH", {
      status,
      resolution: resolution.trim(),
    }).then(() => setMessage(`Appeal marked ${status}.`));
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || !canManageSettings) return;
    const blockedTerms = blockedTermsText
      .split(/\r?\n/u)
      .map((item) => item.trim())
      .filter(Boolean);
    await mutate("settings", "/admin/trust/settings", "PUT", {
      blockedTerms,
      newCreatorsRequireReview: settings.newCreatorsRequireReview,
    }).then(() => setMessage("Trust & Safety settings saved."));
  }

  async function moderationAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const kind = String(form.get("kind") ?? "");
    const reason = String(form.get("reason") ?? "").trim();
    const targetAccountId = String(form.get("targetAccountId") ?? "").trim();
    const channelId = String(form.get("channelId") ?? "").trim();
    const videoId = String(form.get("videoId") ?? "").trim();
    const caseId = String(form.get("caseId") ?? "").trim();
    await mutate("action", "/admin/trust/actions", "POST", {
      kind,
      reason,
      ...(targetAccountId ? { targetAccountId } : {}),
      ...(channelId ? { channelId } : {}),
      ...(videoId ? { videoId } : {}),
      ...(caseId ? { caseId } : {}),
    }).then(() => {
      setMessage(`Moderation action ${kind} recorded.`);
      event.currentTarget.reset();
    });
  }

  async function updateCreatorTrust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const channelId = String(form.get("channelId") ?? "").trim();
    const level = String(form.get("level") ?? "STANDARD");
    const reviewRequired = form.get("reviewRequired") === "on";
    await mutate("creator-trust", `/admin/trust/channels/${encodeURIComponent(channelId)}`, "PUT", {
      level,
      reviewRequired,
    }).then(() => {
      setMessage(`Creator trust updated to ${level}.`);
      event.currentTarget.reset();
    });
  }

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Safety Operations</span>
          <h1>Trust & Safety</h1>
          <p className={styles.muted}>
            Reports, moderation cases, copyright takedowns, appeals, creator trust and audited
            enforcement.
          </p>
        </div>
        <div>
          <strong>{totalOpen}</strong> <span className={styles.muted}>open queue items</span>
        </div>
      </header>

      {message ? <p className={styles.notice}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      <section className={styles.grid} style={{ marginBottom: "1.5rem" }}>
        <article className={styles.card}>
          <span className={styles.eyebrow}>Reports</span>
          <h2>{queue?.reports.length ?? 0}</h2>
          <p className={styles.muted}>Open or reviewing user reports.</p>
        </article>
        <article className={styles.card}>
          <span className={styles.eyebrow}>Cases</span>
          <h2>{queue?.cases.length ?? 0}</h2>
          <p className={styles.muted}>Moderation investigations requiring disposition.</p>
        </article>
        <article className={styles.card}>
          <span className={styles.eyebrow}>Copyright</span>
          <h2>{queue?.takedowns.length ?? 0}</h2>
          <p className={styles.muted}>Open or reviewing takedown requests.</p>
        </article>
        <article className={styles.card}>
          <span className={styles.eyebrow}>Appeals</span>
          <h2>{queue?.appeals.length ?? 0}</h2>
          <p className={styles.muted}>Creator appeals awaiting review.</p>
        </article>
      </section>

      <section className={styles.card} style={{ marginBottom: "1.5rem" }}>
        <h2>Enforcement action</h2>
        <p className={styles.muted}>
          Use resource IDs from the queues below. Every action is written to the moderation action
          ledger and Admin Audit Log.
        </p>
        <form className={styles.form} onSubmit={(event) => void moderationAction(event)}>
          <label>
            <span>Action</span>
            <select name="kind" required defaultValue="WARN">
              <option value="WARN">Warn</option>
              <option value="STRIKE">Strike channel</option>
              <option value="SUSPEND_ACCOUNT">Suspend account</option>
              <option value="SUSPEND_CHANNEL">Suspend channel</option>
              <option value="UNPUBLISH_VIDEO">Unpublish video</option>
              <option value="REMOVE_VIDEO">Remove video</option>
            </select>
          </label>
          <input name="caseId" placeholder="Case UUID (optional)" />
          <input name="targetAccountId" placeholder="Account UUID when required" />
          <input name="channelId" placeholder="Channel UUID when required" />
          <input name="videoId" placeholder="Video UUID when required" />
          <textarea
            name="reason"
            required
            minLength={10}
            maxLength={4000}
            placeholder="Detailed enforcement reason"
          />
          <button className={styles.button} disabled={busy === "action"} type="submit">
            Record enforcement action
          </button>
        </form>
      </section>

      <section className={styles.card} style={{ marginBottom: "1.5rem" }}>
        <h2>Creator trust</h2>
        <form className={styles.form} onSubmit={(event) => void updateCreatorTrust(event)}>
          <input name="channelId" required placeholder="Channel UUID" />
          <select name="level" defaultValue="STANDARD">
            <option value="NEW">New</option>
            <option value="STANDARD">Standard</option>
            <option value="TRUSTED">Trusted</option>
            <option value="RESTRICTED">Restricted</option>
          </select>
          <label style={{ display: "flex", gap: ".55rem", alignItems: "center" }}>
            <input name="reviewRequired" type="checkbox" />
            <span>Require manual review</span>
          </label>
          <button className={styles.button} disabled={busy === "creator-trust"} type="submit">
            Update creator trust
          </button>
        </form>
      </section>

      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Queue</span>
          <h2>Reports</h2>
        </div>
      </header>
      <section className={styles.grid} style={{ marginBottom: "1.5rem" }}>
        {queue?.reports.map((item) => (
          <article className={styles.card} key={item.id}>
            <strong>{item.reason}</strong>
            <p className={styles.muted}>
              {item.status} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}
            </p>
            <p>{item.details || "No additional details."}</p>
            <p className={styles.muted}>Report: {item.id}</p>
            {item.videoId ? <p className={styles.muted}>Video: {item.videoId}</p> : null}
            {item.commentId ? <p className={styles.muted}>Comment: {item.commentId}</p> : null}
          </article>
        ))}
        {queue?.reports.length === 0 ? <p className={styles.muted}>No open reports.</p> : null}
      </section>

      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Investigations</span>
          <h2>Moderation cases</h2>
        </div>
      </header>
      <section className={styles.grid} style={{ marginBottom: "1.5rem" }}>
        {queue?.cases.map((item) => (
          <article className={styles.card} key={item.id}>
            <strong>Case {item.id}</strong>
            <p className={styles.muted}>
              {item.status} · {item.reports.length} linked reports
            </p>
            {item.resolution ? <p>{item.resolution}</p> : null}
            <div className={styles.actions}>
              <button
                className={styles.button}
                disabled={busy === item.id}
                onClick={() => void decideCase(item, "REVIEWING")}
                type="button"
              >
                Review
              </button>
              <button
                className={styles.button}
                disabled={busy === item.id}
                onClick={() => void decideCase(item, "ACTIONED")}
                type="button"
              >
                Actioned
              </button>
              <button
                className={styles.button}
                disabled={busy === item.id}
                onClick={() => void decideCase(item, "DISMISSED")}
                type="button"
              >
                Dismiss
              </button>
              <button
                className={styles.button}
                disabled={busy === item.id}
                onClick={() => void decideCase(item, "CLOSED")}
                type="button"
              >
                Close
              </button>
            </div>
          </article>
        ))}
        {queue?.cases.length === 0 ? (
          <p className={styles.muted}>No open moderation cases.</p>
        ) : null}
      </section>

      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Copyright</span>
          <h2>Takedown requests</h2>
        </div>
      </header>
      <section className={styles.grid} style={{ marginBottom: "1.5rem" }}>
        {queue?.takedowns.map((item) => (
          <article className={styles.card} key={item.id}>
            <strong>{item.claimantName}</strong>
            <p className={styles.muted}>
              {item.contactEmail} · {item.status}
            </p>
            <p>
              <strong>Rights basis:</strong> {item.rightsBasis}
            </p>
            <p style={{ whiteSpace: "pre-wrap" }}>{item.details}</p>
            {item.videoId ? <p className={styles.muted}>Video: {item.videoId}</p> : null}
            <div className={styles.actions}>
              <button
                className={styles.button}
                disabled={busy === item.id}
                onClick={() => void decideTakedown(item, "REVIEWING")}
                type="button"
              >
                Review
              </button>
              <button
                className={styles.button}
                disabled={busy === item.id}
                onClick={() => void decideTakedown(item, "ACTIONED")}
                type="button"
              >
                Actioned
              </button>
              <button
                className={styles.button}
                disabled={busy === item.id}
                onClick={() => void decideTakedown(item, "DISMISSED")}
                type="button"
              >
                Dismiss
              </button>
            </div>
          </article>
        ))}
        {queue?.takedowns.length === 0 ? (
          <p className={styles.muted}>No open takedown requests.</p>
        ) : null}
      </section>

      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Due process</span>
          <h2>Appeals</h2>
        </div>
      </header>
      <section className={styles.grid} style={{ marginBottom: "1.5rem" }}>
        {queue?.appeals.map((item) => (
          <article className={styles.card} key={item.id}>
            <strong>{item.action.kind}</strong>
            <p className={styles.muted}>
              Appeal {item.id} · {item.status}
            </p>
            <p>{item.message}</p>
            <p className={styles.muted}>Original reason: {item.action.reason}</p>
            <div className={styles.actions}>
              <button
                className={styles.button}
                disabled={busy === item.id}
                onClick={() => void decideAppeal(item, "REVIEWING")}
                type="button"
              >
                Review
              </button>
              <button
                className={styles.button}
                disabled={busy === item.id}
                onClick={() => void decideAppeal(item, "UPHELD")}
                type="button"
              >
                Uphold
              </button>
              <button
                className={styles.button}
                disabled={busy === item.id}
                onClick={() => void decideAppeal(item, "OVERTURNED")}
                type="button"
              >
                Overturn
              </button>
            </div>
          </article>
        ))}
        {queue?.appeals.length === 0 ? <p className={styles.muted}>No open appeals.</p> : null}
      </section>

      {settings ? (
        <section className={styles.card}>
          <h2>Safety defaults</h2>
          <p className={styles.muted}>
            Operational settings are restricted to Operations, Admin and Super Admin. Keep blocked
            terms targeted; do not use this as broad censorship.
          </p>
          <form className={styles.form} onSubmit={(event) => void saveSettings(event)}>
            <label>
              <span>Blocked terms — one per line</span>
              <textarea
                disabled={!canManageSettings}
                value={blockedTermsText}
                onChange={(event) => setBlockedTermsText(event.target.value)}
              />
            </label>
            <label style={{ display: "flex", gap: ".55rem", alignItems: "center" }}>
              <input
                checked={settings.newCreatorsRequireReview}
                disabled={!canManageSettings}
                type="checkbox"
                onChange={(event) =>
                  setSettings({ ...settings, newCreatorsRequireReview: event.target.checked })
                }
              />
              <span>New creators require review</span>
            </label>
            {canManageSettings ? (
              <button className={styles.button} disabled={busy === "settings"} type="submit">
                Save safety defaults
              </button>
            ) : (
              <p className={styles.muted}>
                Your role can operate the queue but cannot change global safety defaults.
              </p>
            )}
          </form>
        </section>
      ) : null}
    </>
  );
}
