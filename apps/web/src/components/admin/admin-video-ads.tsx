"use client";

import { useEffect, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import { apiBaseUrl, readApiError } from "@/lib/api";

interface VideoAdSettings {
  masterEnabled: boolean;
  provider: "GOOGLE_IMA";
  preRollEnabled: boolean;
  midRollEnabled: boolean;
  postRollEnabled: boolean;
  midRollEverySec: number;
  frequencyCapPerSession: number;
  externalVastTagUrl: string | null;
  houseCreativeUrl: string | null;
  houseClickUrl: string | null;
}

export function AdminVideoAds() {
  const [settings, setSettings] = useState<VideoAdSettings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch(`${apiBaseUrl}/admin/video-ads/settings`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response));
        const body = (await response.json()) as VideoAdSettings;
        if (active) setSettings(body);
      })
      .catch((error) => {
        if (active)
          setMessage(
            error instanceof Error ? error.message : "Video ad settings could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    if (!settings) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/video-ads/settings`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      setSettings((await response.json()) as VideoAdSettings);
      setMessage("Video advertising settings updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Video ad settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return <p className={styles.muted}>{message ?? "Loading video ad settings…"}</p>;

  const toggle = (
    key: "masterEnabled" | "preRollEnabled" | "midRollEnabled" | "postRollEnabled",
    label: string,
  ) => (
    <label className={styles.checkboxRow}>
      <input
        type="checkbox"
        checked={settings[key]}
        onChange={(event) => setSettings({ ...settings, [key]: event.target.checked })}
      />{" "}
      {label}
    </label>
  );

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Advertising</span>
          <h1>In-player video ads</h1>
          <p className={styles.muted}>
            Provider-neutral AYIN decisions with Google IMA as the V1 web adapter. No Google demand
            or production tag is assumed.
          </p>
        </div>
      </header>
      {message ? <p className={styles.muted}>{message}</p> : null}
      <section className={styles.card}>
        <h2>Delivery policy</h2>
        {toggle("masterEnabled", "Master video ads enabled")}
        {toggle("preRollEnabled", "Pre-roll")}
        {toggle("midRollEnabled", "Mid-roll")}
        {toggle("postRollEnabled", "Post-roll")}
        <label className={styles.field}>
          <span>Mid-roll interval (seconds)</span>
          <input
            type="number"
            min={60}
            max={7200}
            value={settings.midRollEverySec}
            onChange={(event) =>
              setSettings({ ...settings, midRollEverySec: Number(event.target.value) })
            }
          />
        </label>
        <label className={styles.field}>
          <span>Session frequency cap (0 = unlimited)</span>
          <input
            type="number"
            min={0}
            max={50}
            value={settings.frequencyCapPerSession}
            onChange={(event) =>
              setSettings({ ...settings, frequencyCapPerSession: Number(event.target.value) })
            }
          />
        </label>
      </section>
      <section className={styles.card}>
        <h2>VAST sources</h2>
        <label className={styles.field}>
          <span>External VAST tag URL</span>
          <input
            placeholder="Optional configured ad-server tag"
            value={settings.externalVastTagUrl ?? ""}
            onChange={(event) =>
              setSettings({ ...settings, externalVastTagUrl: event.target.value || null })
            }
          />
        </label>
        <label className={styles.field}>
          <span>AYIN-owned house creative MP4 URL</span>
          <input
            placeholder="Required before house VAST can serve"
            value={settings.houseCreativeUrl ?? ""}
            onChange={(event) =>
              setSettings({ ...settings, houseCreativeUrl: event.target.value || null })
            }
          />
        </label>
        <label className={styles.field}>
          <span>Optional house click URL</span>
          <input
            value={settings.houseClickUrl ?? ""}
            onChange={(event) =>
              setSettings({ ...settings, houseClickUrl: event.target.value || null })
            }
          />
        </label>
        <p className={styles.muted}>
          When no external VAST tag is configured, AYIN uses the house VAST endpoint only if an
          AYIN-owned creative URL exists. Otherwise ad serving is disabled for that request and
          content plays normally.
        </p>
      </section>
      <button disabled={busy} onClick={() => void save()}>
        {busy ? "Saving…" : "Save video ad settings"}
      </button>
    </>
  );
}
