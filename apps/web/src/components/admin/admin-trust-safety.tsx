"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import {
  verifyAdminTrustAcknowledgment,
  parseActorTrustActions,
  type ActorTrustAction,
} from "@/lib/admin-trust-acknowledgment";
import { apiBaseUrl } from "@/lib/api";
import { readAdminApiError as readApiError } from "@/lib/admin-reauthentication";
import { type AdminSession } from "@/lib/admin-control";

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

class TrustRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function trustApi<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  init?.signal?.addEventListener("abort", abort, { once: true });
  if (init?.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, init?.method ? 30000 : 15000);
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!response.ok) throw new TrustRequestError(response.status, await readApiError(response));
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", abort);
  }
}

export function AdminTrustSafety() {
  const [actorActions, setActorActions] = useState<ActorTrustAction[] | null>(null);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [settings, setSettings] = useState<TrustSettings | null>(null);
  const [session, setSession] = useState<AdminSession | null>(null);
  const [blockedTermsText, setBlockedTermsText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const writeGuard = useRef(false);
  const decisionLocked = useRef(false);
  const pendingOperation = useRef<AbortController | null>(null);
  const readGuard = useRef(false);
  const dirtySettings = useRef(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [reviewed, setReviewed] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (readGuard.current || writeGuard.current) return;
    readGuard.current = true;
    setQueue(null);
    setActorActions(null);
    setError(null);
    setReviewed(false);
    try {
      const deadline = AbortSignal.timeout(15000);
      const bounded = signal ? AbortSignal.any([signal, deadline]) : deadline;
      const nextSession = await trustApi<AdminSession>("/admin/session", { signal: bounded });
      if (
        !nextSession.roles.some((role) =>
          ["SUPERADMIN", "ADMIN", "OPERATIONS", "CONTENT_MODERATOR"].includes(role),
        )
      )
        throw new TrustRequestError(403, "This role cannot read Trust & Safety.");
      const [nextQueue, nextSettings, nextActions] = await Promise.all([
        trustApi<Queue>("/admin/trust/queue", { signal: bounded }),
        trustApi<TrustSettings>("/admin/trust/settings", { signal: bounded }),
        trustApi<unknown>("/admin/trust/actions", { signal: bounded }),
      ]);
      const currentSession = await trustApi<AdminSession>("/admin/session", { signal: bounded });
      if (
        bounded.aborted ||
        currentSession.accountId !== nextSession.accountId ||
        JSON.stringify([...currentSession.roles].sort()) !==
          JSON.stringify([...nextSession.roles].sort())
      )
        throw new TrustRequestError(401, "Admin identity changed. Reload this page.");
      const actions = parseActorTrustActions(nextActions, currentSession.accountId);
      setQueue(nextQueue);
      setActorActions(actions);
      setSession(currentSession);
      if (!dirtySettings.current) {
        setSettings(nextSettings);
        setBlockedTermsText(nextSettings.blockedTerms.join("\n"));
      }
      setReviewed(true);
    } catch (caught) {
      if (caught instanceof TrustRequestError && [401, 403].includes(caught.status)) {
        setSession(null);
        setSettings(null);
        setBlockedTermsText("");
        dirtySettings.current = false;
      }
      if (!signal?.aborted)
        setError(caught instanceof Error ? caught.message : "Trust & Safety could not be loaded.");
    } finally {
      readGuard.current = false;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void load(controller.signal);
    }, 0);
    const pageHide = () => {
      pendingOperation.current?.abort();
    };
    window.addEventListener("pagehide", pageHide);
    return () => {
      controller.abort();
      pendingOperation.current?.abort();
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", pageHide);
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

  async function mutate(
    key: string,
    path: string,
    method: string,
    body: unknown,
  ): Promise<boolean> {
    if (writeGuard.current || readGuard.current || decisionLocked.current || !queue || !session)
      return false;
    writeGuard.current = true;
    decisionLocked.current = true;
    setBusy(key);
    setError(null);
    setMessage(null);
    setReviewed(false);
    try {
      const controller = new AbortController();
      pendingOperation.current = controller;
      const result = await trustApi<unknown>(path, {
        method,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      verifyAdminTrustAcknowledgment(path, result, body, session.accountId);
      setMessage("Operation saved. Refresh the queue before another decision.");
      setReviewRequired(true);
      return true;
    } catch {
      setError(
        "The operation outcome could not be verified. Keep your draft, review current server records and confirm before any further decision. Do not repeat automatically.",
      );
      setReviewRequired(true);
      return false;
    } finally {
      pendingOperation.current = null;
      writeGuard.current = false;
      setBusy(null);
    }
  }

  async function decideCase(item: ModerationCase, status: string) {
    const resolution = window.prompt(`Resolution for case ${item.id}:`, item.resolution ?? "");
    if (resolution === null) return;
    await mutate(item.id, `/admin/trust/cases/${encodeURIComponent(item.id)}`, "PATCH", {
      status,
      ...(resolution.trim() ? { resolution: resolution.trim() } : {}),
    });
  }

  async function decideTakedown(item: Takedown, status: string) {
    const resolution = window.prompt(`Decision reason for ${item.claimantName}'s takedown:`, "");
    if (!resolution?.trim()) return;
    await mutate(item.id, `/admin/trust/takedowns/${encodeURIComponent(item.id)}`, "PATCH", {
      status,
      resolution: resolution.trim(),
    });
  }

  async function decideAppeal(item: Appeal, status: string) {
    const resolution = window.prompt(`Appeal resolution for ${item.action.kind}:`, "");
    if (!resolution?.trim()) return;
    await mutate(item.id, `/admin/trust/appeals/${encodeURIComponent(item.id)}`, "PATCH", {
      status,
      resolution: resolution.trim(),
    });
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
    });
  }

  async function moderationAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const kind = String(form.get("kind") ?? "");
    const reason = String(form.get("reason") ?? "").trim();
    const targetAccountId = String(form.get("targetAccountId") ?? "").trim();
    const channelId = String(form.get("channelId") ?? "").trim();
    const videoId = String(form.get("videoId") ?? "").trim();
    const caseId = String(form.get("caseId") ?? "").trim();
    const saved = await mutate("action", "/admin/trust/actions", "POST", {
      kind,
      reason,
      ...(targetAccountId ? { targetAccountId } : {}),
      ...(channelId ? { channelId } : {}),
      ...(videoId ? { videoId } : {}),
      ...(caseId ? { caseId } : {}),
    });
    if (saved) formElement.reset();
  }

  async function updateCreatorTrust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const channelId = String(form.get("channelId") ?? "").trim();
    const level = String(form.get("level") ?? "STANDARD");
    const reviewRequired = form.get("reviewRequired") === "on";
    const saved = await mutate(
      "creator-trust",
      `/admin/trust/channels/${encodeURIComponent(channelId)}`,
      "PUT",
      {
        level,
        reviewRequired,
      },
    );
    if (saved) formElement.reset();
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
          <strong>{queue ? totalOpen : "Unavailable"}</strong>{" "}
          <span className={styles.muted}>open queue items</span>
        </div>
      </header>

      {message ? (
        <p className={styles.notice} role="status">
          {message}
        </p>
      ) : null}
      <button
        className={styles.button}
        disabled={Boolean(busy)}
        type="button"
        onClick={() => void load()}
      >
        Review current queue
      </button>
      {reviewRequired ? (
        <div className={styles.notice}>
          <p>
            Decision controls remain locked until you review the current server records. Draft
            settings are retained separately.
          </p>
          <button
            className={styles.button}
            type="button"
            disabled={!reviewed || Boolean(busy)}
            onClick={() => {
              decisionLocked.current = false;
              setReviewRequired(false);
              setMessage("Current queue reviewed. Choose the next decision explicitly.");
            }}
          >
            Confirm review and enable decisions
          </button>
        </div>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {actorActions ? (
        <section className={styles.card} aria-label="Your recent enforcement actions">
          <h2>Your recent enforcement actions</h2>
          <p>
            Latest {actorActions.length} actions recorded by your account, up to 100. Review the
            reason, target and timestamp before deciding whether an uncertain submission was
            recorded. This is not a complete archive or proof of duplicate prevention.
          </p>
          <details>
            <summary>Review recorded actions</summary>
            <ol>
              {actorActions.map((action) => (
                <li key={action.id}>
                  <strong>{action.kind}</strong>
                  <p>{action.reason}</p>
                  <p>
                    Action: {action.id} · {new Date(action.createdAt).toISOString()} (UTC)
                  </p>
                  {action.targetAccountId ? <p>Account: {action.targetAccountId}</p> : null}
                  {action.channelId ? <p>Channel: {action.channelId}</p> : null}
                  {action.videoId ? <p>Video: {action.videoId}</p> : null}
                  {action.caseId ? <p>Case: {action.caseId}</p> : null}
                </li>
              ))}
            </ol>
          </details>
        </section>
      ) : null}
      <section className={styles.grid} style={{ marginBottom: "1.5rem" }}>
        <article className={styles.card}>
          <span className={styles.eyebrow}>Reports</span>
          <h2>{queue ? queue.reports.length : "Unavailable"}</h2>
          <p className={styles.muted}>Open or reviewing user reports.</p>
        </article>
        <article className={styles.card}>
          <span className={styles.eyebrow}>Cases</span>
          <h2>{queue ? queue.cases.length : "Unavailable"}</h2>
          <p className={styles.muted}>Moderation investigations requiring disposition.</p>
        </article>
        <article className={styles.card}>
          <span className={styles.eyebrow}>Copyright</span>
          <h2>{queue ? queue.takedowns.length : "Unavailable"}</h2>
          <p className={styles.muted}>Open or reviewing takedown requests.</p>
        </article>
        <article className={styles.card}>
          <span className={styles.eyebrow}>Appeals</span>
          <h2>{queue ? queue.appeals.length : "Unavailable"}</h2>
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
          <button
            className={styles.button}
            disabled={Boolean(busy) || reviewRequired || !queue}
            type="submit"
          >
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
          <button
            className={styles.button}
            disabled={Boolean(busy) || reviewRequired || !queue}
            type="submit"
          >
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
                disabled={Boolean(busy) || reviewRequired || !queue}
                onClick={() => void decideCase(item, "REVIEWING")}
                type="button"
              >
                Review
              </button>
              <button
                className={styles.button}
                disabled={Boolean(busy) || reviewRequired || !queue}
                onClick={() => void decideCase(item, "ACTIONED")}
                type="button"
              >
                Actioned
              </button>
              <button
                className={styles.button}
                disabled={Boolean(busy) || reviewRequired || !queue}
                onClick={() => void decideCase(item, "DISMISSED")}
                type="button"
              >
                Dismiss
              </button>
              <button
                className={styles.button}
                disabled={Boolean(busy) || reviewRequired || !queue}
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
                disabled={Boolean(busy) || reviewRequired || !queue}
                onClick={() => void decideTakedown(item, "REVIEWING")}
                type="button"
              >
                Review
              </button>
              <button
                className={styles.button}
                disabled={Boolean(busy) || reviewRequired || !queue}
                onClick={() => void decideTakedown(item, "ACTIONED")}
                type="button"
              >
                Actioned
              </button>
              <button
                className={styles.button}
                disabled={Boolean(busy) || reviewRequired || !queue}
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
                disabled={Boolean(busy) || reviewRequired || !queue}
                onClick={() => void decideAppeal(item, "REVIEWING")}
                type="button"
              >
                Review
              </button>
              <button
                className={styles.button}
                disabled={Boolean(busy) || reviewRequired || !queue}
                onClick={() => void decideAppeal(item, "UPHELD")}
                type="button"
              >
                Uphold
              </button>
              <button
                className={styles.button}
                disabled={Boolean(busy) || reviewRequired || !queue}
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
                disabled={!canManageSettings || Boolean(busy) || reviewRequired || !queue}
                value={blockedTermsText}
                onChange={(event) => {
                  dirtySettings.current = true;
                  setBlockedTermsText(event.target.value);
                }}
              />
            </label>
            <label style={{ display: "flex", gap: ".55rem", alignItems: "center" }}>
              <input
                checked={settings.newCreatorsRequireReview}
                disabled={!canManageSettings || Boolean(busy) || reviewRequired || !queue}
                type="checkbox"
                onChange={(event) => {
                  dirtySettings.current = true;
                  setSettings({ ...settings, newCreatorsRequireReview: event.target.checked });
                }}
              />
              <span>New creators require review</span>
            </label>
            {canManageSettings ? (
              <button
                className={styles.button}
                disabled={!canManageSettings || Boolean(busy) || reviewRequired || !queue}
                type="submit"
              >
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
