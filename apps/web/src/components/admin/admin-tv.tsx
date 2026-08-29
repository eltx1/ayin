"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { getAdminCollection, patchAdminResource, type AdminPagination } from "@/lib/admin-control";

type TvItem = {
  id: string;
  slug: string;
  name: string;
  status: "ACTIVE" | "OFF_AIR" | "DISABLED";
  disabledAt: string | null;
  updatedAt: string;
  channel: { id: string; handle: string; name: string; status: string };
  scheduleItems: Array<{ id: string; startsAt: string; endsAt: string; status: string; video: { id: string; title: string } }>;
};
type Response = { items: TvItem[]; pagination: AdminPagination };

export function AdminTv() {
  const [data, setData] = useState<Response | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const params = useMemo(() => {
    const next = new URLSearchParams({ page: String(page), take: "25" });
    if (query.trim()) next.set("query", query.trim());
    if (status) next.set("status", status);
    return next;
  }, [page, query, status]);

  async function load() {
    setData(await getAdminCollection<Response>("tv", params));
  }

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void getAdminCollection<Response>("tv", params)
        .then((response) => { if (active) { setData(response); setError(null); } })
        .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Creator TV could not be loaded."); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [params]);

  async function setTvStatus(tv: TvItem, nextStatus: TvItem["status"]) {
    const reason = window.prompt(`Audit reason for setting ${tv.name} to ${nextStatus}:`);
    if (!reason?.trim()) return;
    setBusyId(tv.id); setError(null); setMessage(null);
    try {
      await patchAdminResource("tv", tv.id, { status: nextStatus, reason: reason.trim() });
      await load(); setMessage(`${tv.name} is now ${nextStatus.toLowerCase().replace("_", " ")}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "TV status could not be changed."); }
    finally { setBusyId(null); }
  }

  return <>
    <header className={styles.header}><div><span className={styles.eyebrow}>Control Plane</span><h1>Creator TV</h1><p className={styles.muted}>Inspect now/next scheduling and take a TV active, off-air or disabled with an audit reason.</p></div></header>
    <div className={styles.toolbar}><input aria-label="Search Creator TV" onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Search TV or channel" value={query}/><select aria-label="Filter TV status" onChange={(event) => { setPage(1); setStatus(event.target.value); }} value={status}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="OFF_AIR">Off air</option><option value="DISABLED">Disabled</option></select></div>
    {message ? <p className={styles.notice}>{message}</p> : null}{error ? <p className={styles.error}>{error}</p> : null}
    <section className={styles.grid}>{data?.items.map((tv) => <article className={styles.card} key={tv.id}><div className={styles.cardHeader}><div><strong>{tv.name}</strong><p className={styles.muted}>@{tv.channel.handle} · {tv.status.toLowerCase().replace("_", " ")}</p></div><span>{tv.scheduleItems[0]?.video.title ?? "No current/upcoming item"}</span></div><p><strong>Now / next</strong></p>{tv.scheduleItems.length ? tv.scheduleItems.map((item) => <p className={styles.muted} key={item.id}>{item.video.title} · {new Date(item.startsAt).toLocaleString()} → {new Date(item.endsAt).toLocaleString()}</p>) : <p className={styles.muted}>No active or scheduled items.</p>}<div className={styles.actions}><button className={styles.button} disabled={busyId === tv.id || tv.status === "ACTIVE"} onClick={() => void setTvStatus(tv,"ACTIVE")} type="button">Enable</button><button className={styles.button} disabled={busyId === tv.id || tv.status === "OFF_AIR"} onClick={() => void setTvStatus(tv,"OFF_AIR")} type="button">Off air</button><button className={styles.danger} disabled={busyId === tv.id || tv.status === "DISABLED"} onClick={() => void setTvStatus(tv,"DISABLED")} type="button">Disable</button></div></article>)}</section>
    {data ? <div className={styles.pager}><button className={styles.button} disabled={page <= 1} onClick={() => setPage((value) => Math.max(1,value-1))} type="button">Previous</button><span className={styles.muted}>Page {data.pagination.page} of {data.pagination.pages} · {data.pagination.total} TVs</span><button className={styles.button} disabled={page >= data.pagination.pages} onClick={() => setPage((value) => value+1)} type="button">Next</button></div> : null}
  </>;
}
