"use client";

import { useState } from "react";

import styles from "@/app/studio/studio.module.css";
import {
  finalizeStudioCaptionUpload,
  getStudioCaptions,
  prepareStudioCaptionReplacement,
  prepareStudioCaptionUpload,
  putCaptionFile,
  removeStudioCaption,
  type StudioCaptionTrack,
  updateStudioCaption,
} from "@/lib/studio";

const MAX_BYTES = 2 * 1024 * 1024;

export function StudioCaptionManager({
  videoId,
  disabled,
}: {
  videoId: string;
  disabled: boolean;
}) {
  const [tracks, setTracks] = useState<StudioCaptionTrack[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [languageCode, setLanguageCode] = useState("en");
  const [label, setLabel] = useState("English");
  const [kind, setKind] = useState<"CAPTIONS" | "SUBTITLES">("SUBTITLES");
  const [makeDefault, setMakeDefault] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  async function refresh() {
    const response = await getStudioCaptions(videoId);
    setTracks(response.tracks);
    setLoaded(true);
  }

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await operation();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Caption operation failed.");
    } finally {
      setBusy(false);
    }
  }

  function validFile(candidate: File) {
    if (!candidate.name.toLowerCase().endsWith(".vtt"))
      throw new Error("Choose a .vtt WebVTT file.");
    if (candidate.size < 1 || candidate.size > MAX_BYTES)
      throw new Error("WebVTT files must be 2 MB or smaller.");
  }

  async function upload() {
    if (!file) throw new Error("Choose a WebVTT file first.");
    validFile(file);
    const prepared = await prepareStudioCaptionUpload(videoId, {
      fileName: file.name,
      sizeBytes: file.size,
      mimeType: "text/vtt",
      languageCode,
      label,
      kind,
      default: makeDefault,
    });
    await putCaptionFile(prepared.uploadUrl, file);
    await finalizeStudioCaptionUpload(videoId, prepared.trackId);
    setFile(null);
  }

  async function replace(track: StudioCaptionTrack, candidate: File) {
    validFile(candidate);
    const prepared = await prepareStudioCaptionReplacement(videoId, track.id, candidate);
    await putCaptionFile(prepared.uploadUrl, candidate);
    await finalizeStudioCaptionUpload(videoId, track.id);
  }

  return (
    <details
      className={styles.panel}
      onToggle={(event) => {
        if (event.currentTarget.open && !loaded && !busy) void run(async () => undefined);
      }}
    >
      <summary>
        <strong>Captions &amp; subtitles</strong>
        <span className={styles.muted}> WebVTT · optional</span>
      </summary>
      <div className={styles.formGrid}>
        <input
          accept=".vtt,text/vtt"
          aria-label="WebVTT caption file"
          disabled={disabled || busy}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          type="file"
        />
        <input
          aria-label="Caption language code"
          disabled={disabled || busy}
          maxLength={35}
          onChange={(event) => setLanguageCode(event.target.value)}
          placeholder="en or ar-EG"
          value={languageCode}
        />
        <input
          aria-label="Caption label"
          disabled={disabled || busy}
          maxLength={80}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="English"
          value={label}
        />
        <select
          aria-label="Caption track type"
          disabled={disabled || busy}
          onChange={(event) => setKind(event.target.value as "CAPTIONS" | "SUBTITLES")}
          value={kind}
        >
          <option value="SUBTITLES">Subtitles</option>
          <option value="CAPTIONS">Captions</option>
        </select>
        <label>
          <input
            checked={makeDefault}
            disabled={disabled || busy}
            onChange={(event) => setMakeDefault(event.target.checked)}
            type="checkbox"
          />
          Default track
        </label>
        <button
          className={styles.secondary}
          disabled={disabled || busy || !file}
          onClick={() => void run(upload)}
          type="button"
        >
          {busy ? "Working…" : "Upload WebVTT"}
        </button>
      </div>
      <p className={styles.muted}>
        Files upload directly to AYIN media storage and are validated before playback.
      </p>
      {error ? <p className={styles.error}>{error}</p> : null}
      {loaded && tracks.length === 0 ? (
        <p className={styles.muted}>No caption tracks yet.</p>
      ) : null}
      {tracks.map((track) => (
        <div className={styles.toggleRow} key={track.id}>
          <span>
            <strong>{track.label}</strong> · {track.languageCode} · {track.kind.toLowerCase()}
            {track.default ? " · default" : ""} · {track.status.toLowerCase()}
          </span>
          <label>
            <input
              checked={track.enabled}
              disabled={disabled || busy || track.status !== "READY"}
              onChange={(event) =>
                void run(async () => {
                  await updateStudioCaption(videoId, track.id, { enabled: event.target.checked });
                })
              }
              type="checkbox"
            />
            Enabled
          </label>
          <button
            className={styles.secondary}
            disabled={disabled || busy || track.default || track.status !== "READY"}
            onClick={() =>
              void run(async () => {
                await updateStudioCaption(videoId, track.id, { default: true });
              })
            }
            type="button"
          >
            Make default
          </button>
          <label className={styles.secondary}>
            Replace
            <input
              accept=".vtt,text/vtt"
              disabled={disabled || busy}
              onChange={(event) => {
                const candidate = event.target.files?.[0];
                if (candidate) void run(() => replace(track, candidate));
                event.currentTarget.value = "";
              }}
              style={{ display: "none" }}
              type="file"
            />
          </label>
          <button
            className={styles.danger}
            disabled={disabled || busy}
            onClick={() =>
              void run(async () => {
                await removeStudioCaption(videoId, track.id);
              })
            }
            type="button"
          >
            Remove
          </button>
        </div>
      ))}
    </details>
  );
}
