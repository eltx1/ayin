"use client";

import { useCallback, useEffect, useState } from "react";

import styles from "@/app/admin/admin.module.css";
import {
  searchAdminAdvertisingTargets,
  type AdminAdvertisingChannelTarget,
  type AdminAdvertisingVideoTarget,
} from "@/lib/admin-operations-directory";
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

type TriState = "INHERIT" | "ENABLED" | "DISABLED";

interface VideoAdOverride {
  id: string;
  channelId: string | null;
  videoId: string | null;
  enabled: boolean | null;
  preRollEnabled: boolean | null;
  midRollEnabled: boolean | null;
  postRollEnabled: boolean | null;
  provider: string | null;
  vastTagUrl: string | null;
  midRollEverySec: number | null;
  updatedAt: string;
  channel: AdminAdvertisingChannelTarget | null;
  video: AdminAdvertisingVideoTarget | null;
}

interface OverrideDraft {
  enabled: TriState;
  preRollEnabled: TriState;
  midRollEnabled: TriState;
  postRollEnabled: TriState;
  vastTagUrl: string;
  midRollEverySec: string;
}

const emptyOverride: OverrideDraft = {
  enabled: "INHERIT",
  preRollEnabled: "INHERIT",
  midRollEnabled: "INHERIT",
  postRollEnabled: "INHERIT",
  vastTagUrl: "",
  midRollEverySec: "",
};

function stateFrom(value: boolean | null): TriState {
  if (value === true) return "ENABLED";
  if (value === false) return "DISABLED";
  return "INHERIT";
}

function stateValue(value: TriState): boolean | null {
  if (value === "ENABLED") return true;
  if (value === "DISABLED") return false;
  return null;
}

function draftFrom(row: VideoAdOverride): OverrideDraft {
  return {
    enabled: stateFrom(row.enabled),
    preRollEnabled: stateFrom(row.preRollEnabled),
    midRollEnabled: stateFrom(row.midRollEnabled),
    postRollEnabled: stateFrom(row.postRollEnabled),
    vastTagUrl: row.vastTagUrl ?? "",
    midRollEverySec: row.midRollEverySec === null ? "" : String(row.midRollEverySec),
  };
}

function overridePayload(draft: OverrideDraft) {
  return {
    enabled: stateValue(draft.enabled),
    preRollEnabled: stateValue(draft.preRollEnabled),
    midRollEnabled: stateValue(draft.midRollEnabled),
    postRollEnabled: stateValue(draft.postRollEnabled),
    provider: null,
    vastTagUrl: draft.vastTagUrl.trim() || null,
    midRollEverySec: draft.midRollEverySec.trim() ? Number(draft.midRollEverySec) : null,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as T;
}

export function AdminVideoAds() {
  const [settings, setSettings] = useState<VideoAdSettings | null>(null);
  const [overrides, setOverrides] = useState<VideoAdOverride[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [channelMatches, setChannelMatches] = useState<AdminAdvertisingChannelTarget[]>([]);
  const [videoMatches, setVideoMatches] = useState<AdminAdvertisingVideoTarget[]>([]);
  const [target, setTarget] = useState<
    | { type: "channel"; item: AdminAdvertisingChannelTarget }
    | { type: "video"; item: AdminAdvertisingVideoTarget }
    | null
  >(null);
  const [newDraft, setNewDraft] = useState<OverrideDraft>(emptyOverride);

  const load = useCallback(async () => {
    const [nextSettings, nextOverrides] = await Promise.all([
      request<VideoAdSettings>("/admin/video-ads/settings"),
      request<VideoAdOverride[]>("/admin/video-ads/overrides"),
    ]);
    setSettings(nextSettings);
    setOverrides(nextOverrides);
  }, []);

  useEffect(() => {
    let active = true;
    void load().catch((error) => {
      if (active) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Video advertising controls could not be loaded.",
        );
      }
    });
    return () => {
      active = false;
    };
  }, [load]);

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Video ad change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    if (!settings) return;
    await act(
      () =>
        request("/admin/video-ads/settings", {
          method: "PATCH",
          body: JSON.stringify(settings),
        }),
      "Video advertising defaults updated and audited.",
    );
  }

  async function searchTargets() {
    if (query.trim().length < 2) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await searchAdminAdvertisingTargets(query);
      setChannelMatches(result.channels);
      setVideoMatches(result.videos);
      if (!result.channels.length && !result.videos.length)
        setMessage("No matching channels or videos.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Target search failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveNewOverride() {
    if (!target) return;
    const path =
      target.type === "channel"
        ? `/admin/video-ads/channels/${encodeURIComponent(target.item.id)}`
        : `/admin/video-ads/videos/${encodeURIComponent(target.item.id)}`;
    await act(
      () => request(path, { method: "PATCH", body: JSON.stringify(overridePayload(newDraft)) }),
      `Video ad override saved for ${target.type === "channel" ? `@${target.item.handle}` : target.item.title}.`,
    );
    setTarget(null);
    setNewDraft(emptyOverride);
    setQuery("");
    setChannelMatches([]);
    setVideoMatches([]);
  }

  if (!settings) {
    return <p className={styles.muted}>{message ?? "Loading video ad controls…"}</p>;
  }

  return (
    <>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Advertising</span>
          <h1>In-player Video Ads Control Center</h1>
          <p className={styles.muted}>
            Manage global player policy plus channel/video exceptions. Overrides are searchable,
            auditable and can be removed to inherit global policy again.
          </p>
        </div>
        <span className={styles.statusPill}>{overrides.length} scoped overrides</span>
      </header>

      {message ? <p className={styles.notice}>{message}</p> : null}

      <section className={styles.card}>
        <h2>Global delivery policy</h2>
        <div className={styles.formGrid}>
          <Toggle
            checked={settings.masterEnabled}
            label="Master video ads enabled"
            onChange={(value) => setSettings({ ...settings, masterEnabled: value })}
          />
          <Toggle
            checked={settings.preRollEnabled}
            label="Pre-roll"
            onChange={(value) => setSettings({ ...settings, preRollEnabled: value })}
          />
          <Toggle
            checked={settings.midRollEnabled}
            label="Mid-roll"
            onChange={(value) => setSettings({ ...settings, midRollEnabled: value })}
          />
          <Toggle
            checked={settings.postRollEnabled}
            label="Post-roll"
            onChange={(value) => setSettings({ ...settings, postRollEnabled: value })}
          />
          <label>
            Mid-roll interval (seconds)
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
          <label>
            Session frequency cap (0 = unlimited)
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
          <label className={styles.fullField}>
            External VAST tag URL
            <input
              placeholder="Optional configured ad-server tag"
              value={settings.externalVastTagUrl ?? ""}
              onChange={(event) =>
                setSettings({ ...settings, externalVastTagUrl: event.target.value || null })
              }
            />
          </label>
          <label className={styles.fullField}>
            AYIN-owned house creative MP4 URL
            <input
              placeholder="Required before house VAST can serve"
              value={settings.houseCreativeUrl ?? ""}
              onChange={(event) =>
                setSettings({ ...settings, houseCreativeUrl: event.target.value || null })
              }
            />
          </label>
          <label className={styles.fullField}>
            Optional house click URL
            <input
              value={settings.houseClickUrl ?? ""}
              onChange={(event) =>
                setSettings({ ...settings, houseClickUrl: event.target.value || null })
              }
            />
          </label>
        </div>
        <p className={styles.muted}>
          If no external VAST is configured, AYIN serves its house VAST only when a house creative
          URL exists. Otherwise content plays without an ad.
        </p>
        <button
          className={styles.button}
          disabled={busy}
          type="button"
          onClick={() => void saveSettings()}
        >
          {busy ? "Saving…" : "Save global video ad policy"}
        </button>
      </section>

      <section className={styles.card}>
        <h2>Add channel or video override</h2>
        <p className={styles.muted}>
          Search by channel name/handle or video title. No internal UUID is required.
        </p>
        <div className={styles.toolbar}>
          <input
            minLength={2}
            placeholder="Search channel or video"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            className={styles.button}
            disabled={busy || query.trim().length < 2}
            type="button"
            onClick={() => void searchTargets()}
          >
            Search
          </button>
        </div>
        <div className={styles.commandGrid}>
          {channelMatches.map((channel) => (
            <button
              className={styles.button}
              key={channel.id}
              type="button"
              onClick={() => setTarget({ type: "channel", item: channel })}
            >
              Channel · {channel.name} (@{channel.handle})
            </button>
          ))}
          {videoMatches.map((video) => (
            <button
              className={styles.button}
              key={video.id}
              type="button"
              onClick={() => setTarget({ type: "video", item: video })}
            >
              Video · {video.title} · @{video.channel.handle}
            </button>
          ))}
        </div>
        {target ? (
          <div className={styles.cardInset}>
            <strong>
              Override: {target.type === "channel" ? `@${target.item.handle}` : target.item.title}
            </strong>
            <OverrideEditor draft={newDraft} onChange={setNewDraft} />
            <div className={styles.actions}>
              <button
                className={styles.button}
                disabled={busy}
                type="button"
                onClick={() => void saveNewOverride()}
              >
                Save override
              </button>
              <button className={styles.button} type="button" onClick={() => setTarget(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className={styles.card}>
        <h2>Existing overrides</h2>
        <p className={styles.muted}>
          “Inherit” means the global player policy decides that field. Reset removes the override
          row completely.
        </p>
        <div className={styles.grid}>
          {overrides.map((row) => (
            <ExistingOverride busy={busy} key={row.id} onAct={act} row={row} />
          ))}
          {!overrides.length ? <p className={styles.muted}>No scoped video-ad overrides.</p> : null}
        </div>
      </section>
    </>
  );
}

function ExistingOverride({
  row,
  busy,
  onAct,
}: {
  row: VideoAdOverride;
  busy: boolean;
  onAct: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<OverrideDraft>(() => draftFrom(row));
  useEffect(() => setDraft(draftFrom(row)), [row]);
  const isChannel = Boolean(row.channelId);
  const targetId = row.channelId ?? (row.videoId as string);
  const label = isChannel
    ? row.channel
      ? `${row.channel.name} (@${row.channel.handle})`
      : `Channel ${targetId}`
    : row.video
      ? `${row.video.title} · @${row.video.channel.handle}`
      : `Video ${targetId}`;
  const path = isChannel
    ? `/admin/video-ads/channels/${encodeURIComponent(targetId)}`
    : `/admin/video-ads/videos/${encodeURIComponent(targetId)}`;

  return (
    <article className={styles.cardInset}>
      <div className={styles.cardHeader}>
        <div>
          <strong>{label}</strong>
          <p className={styles.muted}>{isChannel ? "Channel override" : "Video override"}</p>
        </div>
        <span className={styles.statusBadge}>{new Date(row.updatedAt).toLocaleDateString()}</span>
      </div>
      <OverrideEditor draft={draft} onChange={setDraft} />
      <div className={styles.actions}>
        <button
          className={styles.button}
          disabled={busy}
          type="button"
          onClick={() =>
            void onAct(
              () =>
                request(path, { method: "PATCH", body: JSON.stringify(overridePayload(draft)) }),
              `Video ad override updated for ${label}.`,
            )
          }
        >
          Save override
        </button>
        <button
          className={styles.danger}
          disabled={busy}
          type="button"
          onClick={() => {
            if (window.confirm(`Remove override for ${label} and inherit all global settings?`)) {
              void onAct(
                () => request(path, { method: "DELETE" }),
                `${label} now inherits the global video ad policy.`,
              );
            }
          }}
        >
          Reset to global
        </button>
      </div>
    </article>
  );
}

function OverrideEditor({
  draft,
  onChange,
}: {
  draft: OverrideDraft;
  onChange: (draft: OverrideDraft) => void;
}) {
  return (
    <div className={styles.formGrid}>
      <TriStateField
        label="Ads enabled"
        value={draft.enabled}
        onChange={(value) => onChange({ ...draft, enabled: value })}
      />
      <TriStateField
        label="Pre-roll"
        value={draft.preRollEnabled}
        onChange={(value) => onChange({ ...draft, preRollEnabled: value })}
      />
      <TriStateField
        label="Mid-roll"
        value={draft.midRollEnabled}
        onChange={(value) => onChange({ ...draft, midRollEnabled: value })}
      />
      <TriStateField
        label="Post-roll"
        value={draft.postRollEnabled}
        onChange={(value) => onChange({ ...draft, postRollEnabled: value })}
      />
      <label>
        Override VAST tag
        <input
          placeholder="Blank = inherit source"
          value={draft.vastTagUrl}
          onChange={(event) => onChange({ ...draft, vastTagUrl: event.target.value })}
        />
      </label>
      <label>
        Mid-roll interval
        <input
          min={60}
          max={7200}
          placeholder="Blank = inherit"
          type="number"
          value={draft.midRollEverySec}
          onChange={(event) => onChange({ ...draft, midRollEverySec: event.target.value })}
        />
      </label>
    </div>
  );
}

function TriStateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: TriState;
  onChange: (value: TriState) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value as TriState)}>
        <option value="INHERIT">Inherit global</option>
        <option value="ENABLED">Force enabled</option>
        <option value="DISABLED">Force disabled</option>
      </select>
    </label>
  );
}

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.check}>
      <input
        checked={checked}
        type="checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
