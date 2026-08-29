"use client";

import { useEffect, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { apiBaseUrl, readApiError } from "@/lib/api";

interface FeatureFlag {
  key: string;
  description: string | null;
  enabled: boolean;
  rolloutPercentage: number;
}

export function AdminFeatureFlags() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function load() {
    const response = await fetch(`${apiBaseUrl}/admin/feature-flags`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await readApiError(response));
    const body = (await response.json()) as { flags: FeatureFlag[] };
    setFlags(body.flags);
  }

  useEffect(() => {
    let active = true;
    void fetch(`${apiBaseUrl}/admin/feature-flags`, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response));
        const body = (await response.json()) as { flags: FeatureFlag[] };
        if (active) setFlags(body.flags);
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : "Feature flags could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, []);

  async function update(flag: FeatureFlag, patch: Partial<Pick<FeatureFlag, "enabled" | "rolloutPercentage">>) {
    setBusyKey(flag.key);
    setMessage(null);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/feature-flags/${encodeURIComponent(flag.key)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: patch.enabled ?? flag.enabled, rolloutPercentage: patch.rolloutPercentage ?? flag.rolloutPercentage }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      await load();
      setMessage(`${flag.key} updated.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Feature flag update failed.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Product controls</span>
          <h1>Feature flags</h1>
          <p className={styles.muted}>Enable product surfaces or adjust staged rollout percentages without a deployment. Every mutation is audited server-side.</p>
        </div>
      </header>
      {message ? <p className={styles.muted}>{message}</p> : null}
      <section className={styles.card}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Flag</th><th>State</th><th>Rollout</th></tr></thead>
            <tbody>
              {flags.map((flag) => (
                <tr key={flag.key}>
                  <td><strong>{flag.key}</strong>{flag.description ? <><br /><span className={styles.muted}>{flag.description}</span></> : null}</td>
                  <td><button disabled={busyKey === flag.key} onClick={() => void update(flag, { enabled: !flag.enabled })}>{flag.enabled ? "Enabled" : "Disabled"}</button></td>
                  <td><input aria-label={`${flag.key} rollout percentage`} disabled={busyKey === flag.key} min={0} max={100} type="number" value={flag.rolloutPercentage} onChange={(event) => setFlags((current) => current.map((entry) => entry.key === flag.key ? { ...entry, rolloutPercentage: Math.max(0, Math.min(100, Number(event.target.value))) } : entry))} onBlur={() => void update(flag, { rolloutPercentage: flag.rolloutPercentage })} />%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
