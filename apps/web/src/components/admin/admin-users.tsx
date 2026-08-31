"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import {
  getAdminCollection,
  patchAdminResource,
  revokeAccountSessions,
  type AdminPagination,
} from "@/lib/admin-control";

type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  status: "ACTIVE" | "SUSPENDED" | "CLOSED";
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  channelMemberships: Array<{
    channel: { id: string; handle: string; name: string; status: string };
  }>;
};

type UsersResponse = { items: AdminUser[]; pagination: AdminPagination };

export function AdminUsers() {
  const [data, setData] = useState<UsersResponse | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = useMemo(() => {
    const next = new URLSearchParams({ page: String(page), take: "25" });
    if (query.trim()) next.set("query", query.trim());
    if (status) next.set("status", status);
    return next;
  }, [page, query, status]);

  async function load() {
    const response = await getAdminCollection<UsersResponse>("users", params);
    setData(response);
    setDrafts((current) => ({
      ...current,
      ...Object.fromEntries(
        response.items.map((user) => [user.id, current[user.id] ?? user.displayName]),
      ),
    }));
  }

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void getAdminCollection<UsersResponse>("users", params)
        .then((response) => {
          if (!active) return;
          setData(response);
          setDrafts((current) => ({
            ...current,
            ...Object.fromEntries(
              response.items.map((user) => [user.id, current[user.id] ?? user.displayName]),
            ),
          }));
          setError(null);
        })
        .catch((caught) => {
          if (active)
            setError(caught instanceof Error ? caught.message : "Users could not be loaded.");
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [params]);

  async function save(user: AdminUser) {
    setBusyId(user.id);
    setError(null);
    setMessage(null);
    try {
      await patchAdminResource("users", user.id, {
        displayName: drafts[user.id] ?? user.displayName,
      });
      await load();
      setMessage(`Updated ${user.email}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The account could not be updated.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleSuspension(user: AdminUser) {
    const nextStatus = user.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
    const reason = window.prompt(
      `Reason for ${nextStatus === "SUSPENDED" ? "suspending" : "reactivating"} ${user.email}:`,
    );
    if (!reason?.trim()) return;
    setBusyId(user.id);
    setError(null);
    setMessage(null);
    try {
      await patchAdminResource("users", user.id, { status: nextStatus, reason: reason.trim() });
      await load();
      setMessage(`${user.email} is now ${nextStatus.toLowerCase()}.`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The account status could not be changed.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function revokeSessions(user: AdminUser) {
    const reason = window.prompt(`Reason for revoking all active sessions for ${user.email}:`);
    if (!reason || reason.trim().length < 8) return;
    setBusyId(user.id);
    setError(null);
    setMessage(null);
    try {
      await revokeAccountSessions(user.id, reason.trim());
      setMessage(`All existing sessions for ${user.email} were invalidated.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sessions could not be revoked.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Control Plane</span>
          <h1>Users & Accounts</h1>
          <p className={styles.muted}>
            Search, inspect, suspend and revoke account sessions with server-side authorization and
            audit logging.
          </p>
        </div>
      </header>
      <div className={styles.toolbar}>
        <input
          aria-label="Search users"
          onChange={(event) => {
            setPage(1);
            setQuery(event.target.value);
          }}
          placeholder="Search email or display name"
          value={query}
        />
        <select
          aria-label="Filter users by status"
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
          value={status}
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="CLOSED">Closed</option>
        </select>
      </div>
      {message ? <p className={styles.notice}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      <section className={styles.grid}>
        {data?.items.map((user) => (
          <article className={styles.card} key={user.id}>
            <div className={styles.cardHeader}>
              <div>
                <strong>{user.email}</strong>
                <p className={styles.muted}>
                  {user.status.toLowerCase()} · joined{" "}
                  {new Date(user.createdAt).toLocaleDateString()}
                </p>
              </div>
              <span>
                {user.channelMemberships[0]?.channel.handle
                  ? `@${user.channelMemberships[0].channel.handle}`
                  : "No owned channel"}
              </span>
            </div>
            <div className={styles.form}>
              <input
                aria-label={`Display name for ${user.email}`}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [user.id]: event.target.value }))
                }
                value={drafts[user.id] ?? user.displayName}
              />
            </div>
            <div className={styles.actions}>
              <button
                className={styles.button}
                disabled={busyId === user.id}
                onClick={() => void save(user)}
                type="button"
              >
                Save basics
              </button>
              <button
                className={styles.danger}
                disabled={busyId === user.id}
                onClick={() => void revokeSessions(user)}
                type="button"
              >
                Revoke sessions
              </button>
              {user.status !== "CLOSED" ? (
                <button
                  className={user.status === "SUSPENDED" ? styles.button : styles.danger}
                  disabled={busyId === user.id}
                  onClick={() => void toggleSuspension(user)}
                  type="button"
                >
                  {user.status === "SUSPENDED" ? "Reactivate" : "Suspend"}
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </section>
      {data ? (
        <div className={styles.pager}>
          <button
            className={styles.button}
            disabled={data.pagination.page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            type="button"
          >
            Previous
          </button>
          <span className={styles.muted}>
            Page {data.pagination.page} of {data.pagination.pages} · {data.pagination.total}{" "}
            accounts
          </span>
          <button
            className={styles.button}
            disabled={data.pagination.page >= data.pagination.pages}
            onClick={() => setPage((current) => current + 1)}
            type="button"
          >
            Next
          </button>
        </div>
      ) : null}
    </>
  );
}
