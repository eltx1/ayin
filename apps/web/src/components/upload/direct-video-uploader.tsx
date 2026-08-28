"use client";

import { useState } from "react";

import { apiBaseUrl, type AyinIdentity, readApiError } from "@/lib/api";
import { uploadVideoDirectly } from "@/lib/direct-video-upload";
import { inspectVideoFile, type VideoInspectionResult } from "@/lib/video-inspection";

import styles from "./direct-video-uploader.module.css";

export function DirectVideoUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<VideoInspectionResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(false);

  async function chooseFile(selected: File | null) {
    setFile(selected);
    setProgress(0);
    setUploaded(false);
    setMessage(null);
    setInspection(selected ? await inspectVideoFile(selected) : null);
  }

  async function upload() {
    if (!file || inspection?.status === "incompatible") {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const identityResponse = await fetch(`${apiBaseUrl}/auth/me`, { credentials: "include" });
      if (!identityResponse.ok) {
        setMessage(await readApiError(identityResponse));
        return;
      }
      const identity = (await identityResponse.json()) as AyinIdentity;
      await uploadVideoDirectly({
        channelId: identity.channel.id,
        file,
        onProgress: setProgress,
      });
      setUploaded(true);
      setMessage("Upload complete. Your original MP4 is safely stored in AYIN R2 storage.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The upload could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="direct-upload-title">
      <p className={styles.eyebrow}>Direct to R2</p>
      <h1 id="direct-upload-title">Choose a playback-ready MP4</h1>
      <p className={styles.copy}>
        AYIN sends the video straight from your browser to Cloudflare R2. The API never receives the
        video bytes.
      </p>
      <label className={styles.picker}>
        <span>{file ? file.name : "Choose MP4"}</span>
        <input
          type="file"
          accept="video/mp4,.mp4"
          disabled={busy}
          onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)}
        />
      </label>
      {inspection ? (
        <p className={styles[inspection.status]} role="status">
          {inspection.message}
        </p>
      ) : null}
      {file ? (
        <p className={styles.meta}>
          {(file.size / (1024 * 1024)).toFixed(1)} MB
          {inspection?.durationSeconds ? ` · ${Math.round(inspection.durationSeconds)} sec` : ""}
        </p>
      ) : null}
      {busy || progress > 0 ? (
        <div className={styles.progressWrap}>
          <progress max={100} value={progress} aria-label="Upload progress" />
          <span>{progress}%</span>
        </div>
      ) : null}
      <button
        className={styles.action}
        type="button"
        disabled={!file || busy || inspection?.status === "incompatible" || uploaded}
        onClick={() => void upload()}
      >
        {busy ? "Uploading…" : uploaded ? "Uploaded" : "Upload video"}
      </button>
      {message ? <p className={styles.message}>{message}</p> : null}
    </section>
  );
}
