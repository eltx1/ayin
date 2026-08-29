"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { getAdminCollection, patchAdminResource, type AdminPagination } from "@/lib/admin-control";

type ChannelItem = {
  id: string;
  handle: string;
  name: string;
  description: string | null;
  status: "ACTIVE" | "HIDDEN" | "SUSPENDED" | "REMOVED";
  members: Array<{ account: { id: string; email: string; displayName: string; status: string } }>;
  creatorContracts: Array<{
    id: string;
    status: "PENDING" | "ACTIVE" | "SUSPENDED" | "ENDED";
    revenueShareBps: number | null;
  }>;
  primaryTvChannel: { id: string; name: string; status: string } | null;
  _count: { videos: number; subscriptions: number; playlists: number };
};
type Response = { items: ChannelItem[]; pagination: AdminPagination };
type Draft = {
  name: string;
  description: string;
  status: string;
  contractStatus: string;
  revenueShareBps: string;
};

export function AdminChannels() {
  const [data, setData] = useState<Response | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const params = useMemo(() => {
    const value = new URLSearchParams({ page: String(page), take: "25" });
    if (query.trim()) value.set("query", query.trim());
    if (status) value.set("status", status);
    return value;
  }, [page, query, status]);

  function hydrate(response: Response) {
    setData(response);
    setDrafts(
      Object.fromEntries(
        response.items.map((channel) => {
          const contract = channel.creatorContracts[0];
          return [
            channel.id,
            {
              name: channel.name,
              description: channel.description ?? "",
              status: channel.status,
              contractStatus: contract?.status ?? "PENDING",
              revenueShareBps:
                contract?.revenueShareBps === null || contract?.revenueShareBps === undefined
                  ? ""
                  : String(contract.revenueShareBps),
            },
          ];
        }),
      ),
    );
  }

  async function load() {
    hydrate(await getAdminCollection<Response>("channels", params));
  }

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void getAdminCollection<Response>("channels", params)
        .then((response) => {
          if (active) {
            hydrate(response);
            setError(null);
          }
        })
        .catch((caught) => {
          if (active)
            setError(caught instanceof Error ? caught.message : "Channels could not be loaded.");
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [params]);

  async function save(channel: ChannelItem) {
    const draft = drafts[channel.id];
    if (!draft) return;
    const reason = window.prompt(`Audit reason for updating @${channel.handle}:`);
    if (!reason?.trim()) return;
    const revenueShareBps =
      draft.revenueShareBps.trim() === "" ? null : Number(draft.revenueShareBps);
    if (revenueShareBps !== null && !Number.isInteger(revenueShareBps)) {
      setError("Revenue share must be whole basis points.");
      return;
    }
    setBusyId(channel.id);
    setError(null);
    setMessage(null);
    try {
      await patchAdminResource("channels", channel.id, {
        name: draft.name,
        description: draft.description || null,
        status: draft.status,
        contractStatus: draft.contractStatus,
        revenueShareBps,
        reason: reason.trim(),
      });
      await load();
      setMessage(`Updated @${channel.handle}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Channel could not be updated.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Control Plane</span>
          <h1>Channels & Creators</h1>
          <p className={styles.muted}>
            Edit channel state and creator monetization contract with auditable changes.
          </p>
        </div>
      </header>
      <div className={styles.toolbar}>
        <input
          aria-label="Search channels"
          onChange={(event) => {
            setPage(1);
            setQuery(event.target.value);
          }}
          placeholder="Search name or handle"
          value={query}
        />
        <select
          aria-label="Filter channels"
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
          value={status}
        >
          <option value="">Active records</option>
          <option value="ACTIVE">Active</option>
          <option value="HIDDEN">Hidden</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="REMOVED">Removed</option>
        </select>
      </div>
      {message ? <p className={styles.notice}>{message}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      <section className={styles.grid}>
        {data?.items.map((channel) => {
          const draft = drafts[channel.id];
          if (!draft) return null;
          return (
            <article className={styles.card} key={channel.id}>
              <div className={styles.cardHeader}>
                <div>
                  <strong>@{channel.handle}</strong>
                  <p className={styles.muted}>
                    {channel.members[0]?.account.email ?? "No owner"} · {channel._count.videos}{" "}
                    videos · {channel._count.subscriptions} subscribers
                  </p>
                </div>
                <span>{channel.primaryTvChannel?.status ?? "No TV"}</span>
              </div>
              <div className={styles.form}>
                <input
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [channel.id]: { ...draft, name: event.target.value },
                    }))
                  }
                  value={draft.name}
                />
                <select
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [channel.id]: { ...draft, status: event.target.value },
                    }))
                  }
                  value={draft.status}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="HIDDEN">Hidden</option>
                  <option value="SUSPENDED">Suspended</option>
                </select>
                <textarea
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [channel.id]: { ...draft, description: event.target.value },
                    }))
                  }
                  value={draft.description}
                />
                <select
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [channel.id]: { ...draft, contractStatus: event.target.value },
                    }))
                  }
                  value={draft.contractStatus}
                >
                  <option value="PENDING">Monetization pending</option>
                  <option value="ACTIVE">Monetization active</option>
                  <option value="SUSPENDED">Monetization suspended</option>
                  <option value="ENDED">Monetization ended</option>
                </select>
                <input
                  inputMode="numeric"
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [channel.id]: { ...draft, revenueShareBps: event.target.value },
                    }))
                  }
                  placeholder="Revenue share bps"
                  value={draft.revenueShareBps}
                />
              </div>
              <div className={styles.actions}>
                <button
                  className={styles.button}
                  disabled={busyId === channel.id}
                  onClick={() => void save(channel)}
                  type="button"
                >
                  Save channel
                </button>
              </div>
            </article>
          );
        })}
      </section>
      {data ? (
        <div className={styles.pager}>
          <button
            className={styles.button}
            disabled={page <= 1}
            onClick={() => setPage((v) => Math.max(1, v - 1))}
            type="button"
          >
            Previous
          </button>
          <span className={styles.muted}>
            Page {data.pagination.page} of {data.pagination.pages} · {data.pagination.total}{" "}
            channels
          </span>
          <button
            className={styles.button}
            disabled={page >= data.pagination.pages}
            onClick={() => setPage((v) => v + 1)}
            type="button"
          >
            Next
          </button>
        </div>
      ) : null}
    </>
  );
}
