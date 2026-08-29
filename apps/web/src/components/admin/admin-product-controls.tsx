"use client";

import { useEffect, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import {
  getAdminProductControls,
  patchAdminHomeRow,
  reorderAdminHomeRows,
  updateAdminProductControls,
  type AdminHomeRow,
  type ProductControls,
} from "@/lib/admin-product";

export function AdminProductControls() {
  const [rows, setRows] = useState<AdminHomeRow[]>([]);
  const [controls, setControls] = useState<ProductControls | null>(null);
  const [reason, setReason] = useState("Routine merchandising update");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const snapshot = await getAdminProductControls();
    setRows(snapshot.rows);
    setControls(snapshot.controls);
  }

  useEffect(() => {
    void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Controls could not be loaded."));
  }, []);

  async function mutate(operation: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      await operation();
      await refresh();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function moveRow(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    const current = next[index];
    const swap = next[target];
    if (!current || !swap) return;
    next[index] = swap;
    next[target] = current;
    void mutate(() => reorderAdminHomeRows(next.map((row) => row.id), reason), "Home row order updated.");
  }

  if (!controls) return <p className={styles.muted}>Loading product controls…</p>;

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Product controls</span>
          <h1>Home, navigation & merchandising</h1>
          <p className={styles.muted}>Changes are validated, audited and consumed from data rather than hard-coded page rules.</p>
        </div>
      </header>

      <label className={styles.field}>
        <span>Audit reason</span>
        <input value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      {message ? <p className={styles.muted}>{message}</p> : null}

      <section className={styles.card}>
        <h2>Home Builder</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Row</th><th>Source</th><th>Audience</th><th>Limit</th><th>Enabled</th><th>Order</th></tr></thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id}>
                  <td><strong>{row.title}</strong><br /><span className={styles.muted}>{row.key}</span></td>
                  <td>{row.source}</td>
                  <td>{row.audience}</td>
                  <td>{row.maxItems}</td>
                  <td>
                    <button disabled={busy} onClick={() => void mutate(() => patchAdminHomeRow(row.id, { enabled: !row.enabled, reason }), row.enabled ? "Row disabled." : "Row enabled.")}>{row.enabled ? "On" : "Off"}</button>
                  </td>
                  <td><button disabled={busy || index === 0} onClick={() => moveRow(index, -1)}>↑</button> <button disabled={busy || index === rows.length - 1} onClick={() => moveRow(index, 1)}>↓</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.card}>
        <h2>Main navigation</h2>
        <p className={styles.muted}>Toggle feature-ready destinations without redeploying the public shell.</p>
        {controls.navigation.map((item, index) => (
          <label className={styles.checkboxRow} key={item.key}>
            <input
              type="checkbox"
              checked={item.enabled}
              onChange={(event) => {
                const navigation = controls.navigation.map((entry, itemIndex) => itemIndex === index ? { ...entry, enabled: event.target.checked } : entry);
                setControls({ ...controls, navigation });
              }}
            />
            <span>{item.label} <small className={styles.muted}>{item.href}</small></span>
          </label>
        ))}
      </section>

      <section className={styles.card}>
        <h2>Hero selector</h2>
        <div className={styles.filters}>
          <select value={controls.hero.entityType ?? ""} onChange={(event) => setControls({ ...controls, hero: { ...controls.hero, entityType: (event.target.value || null) as ProductControls["hero"]["entityType"] } })}>
            <option value="">Automatic / none</option><option value="VIDEO">Video</option><option value="CREATOR_TV">Creator TV</option><option value="CHANNEL">Channel</option><option value="PLAYLIST">Playlist</option>
          </select>
          <input placeholder="Stable entity UUID" value={controls.hero.entityId ?? ""} onChange={(event) => setControls({ ...controls, hero: { ...controls.hero, entityId: event.target.value || null } })} />
        </div>
      </section>

      <section className={styles.card}>
        <h2>Announcement</h2>
        <label className={styles.checkboxRow}><input type="checkbox" checked={controls.announcement.enabled} onChange={(event) => setControls({ ...controls, announcement: { ...controls.announcement, enabled: event.target.checked } })} /> Enabled</label>
        <input value={controls.announcement.text} maxLength={240} placeholder="Platform announcement" onChange={(event) => setControls({ ...controls, announcement: { ...controls.announcement, text: event.target.value } })} />
        <input value={controls.announcement.href ?? ""} placeholder="Optional internal path, e.g. /tv" onChange={(event) => setControls({ ...controls, announcement: { ...controls.announcement, href: event.target.value || null } })} />
      </section>

      <section className={styles.card}>
        <h2>Taxonomy</h2>
        <p className={styles.muted}>Comma-separated category labels create normalized, admin-managed taxonomy keys.</p>
        <textarea
          value={controls.taxonomy.map((item) => item.label).join(", ")}
          onChange={(event) => {
            const taxonomy = event.target.value.split(",").map((label) => label.trim()).filter(Boolean).slice(0, 100).map((label) => ({ key: label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60), label, enabled: true })).filter((item) => item.key.length > 0);
            setControls({ ...controls, taxonomy });
          }}
        />
      </section>

      <section className={styles.card}>
        <h2>Device visibility</h2>
        {(["web", "mobile", "tv"] as const).map((device) => (
          <label className={styles.checkboxRow} key={device}><input type="checkbox" checked={controls.deviceVisibility[device]} onChange={(event) => setControls({ ...controls, deviceVisibility: { ...controls.deviceVisibility, [device]: event.target.checked } })} /> {device.toUpperCase()}</label>
        ))}
      </section>

      <button disabled={busy || reason.trim().length < 3} onClick={() => void mutate(() => updateAdminProductControls(controls, reason), "Global product controls updated.")}>{busy ? "Saving…" : "Save global controls"}</button>
    </>
  );
}
