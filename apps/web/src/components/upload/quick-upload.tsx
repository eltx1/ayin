"use client";

import { useEffect, useRef, useState } from "react";

import { trackAnalyticsEvent } from "@/lib/analytics";
import { apiBaseUrl, type AyinIdentity, readApiError } from "@/lib/api";
import { uploadPreparedVideoDirectly } from "@/lib/direct-video-upload";
import {
  captureLocalThumbnailChoices,
  releaseLocalThumbnailChoices,
  type LocalThumbnailChoice,
} from "@/lib/local-thumbnail";
import {
  confirmQuickUpload,
  createQuickDraft,
  publishQuickVideo,
  saveQuickVideoDetails,
  uploadQuickThumbnail,
} from "@/lib/quick-upload";
import { titleFromFilename } from "@/lib/title-from-filename";
import { inspectVideoFile, type VideoInspectionResult } from "@/lib/video-inspection";

import styles from "./quick-upload.module.css";

type Visibility = "PUBLIC" | "UNLISTED" | "PRIVATE";

export function QuickUpload() {
  const [identity, setIdentity] = useState<AyinIdentity | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<VideoInspectionResult | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("PUBLIC");
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [scheduledPublishAt, setScheduledPublishAt] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [thumbnailChoices, setThumbnailChoices] = useState<LocalThumbnailChoice[]>([]);
  const [selectedThumbnailId, setSelectedThumbnailId] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const choicesRef = useRef<LocalThumbnailChoice[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiBaseUrl}/auth/me`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          setMessage(await readApiError(response));
          return;
        }
        setIdentity((await response.json()) as AyinIdentity);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    choicesRef.current = thumbnailChoices;
  }, [thumbnailChoices]);

  useEffect(
    () => () => {
      releaseLocalThumbnailChoices(choicesRef.current);
    },
    [],
  );

  async function chooseFile(selected: File | null) {
    releaseLocalThumbnailChoices(thumbnailChoices);
    setThumbnailChoices([]);
    setSelectedThumbnailId(null);
    setFile(selected);
    setInspection(null);
    setVideoId(null);
    setProgress(0);
    setUploadComplete(false);
    setRightsConfirmed(false);
    setPublished(false);
    setMessage(null);
    if (!selected || !identity) return;

    setBusy(true);
    const nextTitle = titleFromFilename(selected.name);
    setTitle(nextTitle);
    try {
      const result = await inspectVideoFile(selected);
      setInspection(result);
      if (result.status === "incompatible") {
        setMessage(result.message);
        return;
      }
      trackAnalyticsEvent("UPLOAD_START", { channelId: identity.channel.id });
      const draft = await createQuickDraft({
        channelId: identity.channel.id,
        title: nextTitle,
        file: selected,
        durationMs: result.durationSeconds ? Math.round(result.durationSeconds * 1000) : null,
      });
      setVideoId(draft.video.id);
      setVisibility(draft.video.visibility);
      setCommentsEnabled(draft.video.commentsEnabled);
      setMessage("Draft created. Uploading directly to AYIN R2…");

      void captureLocalThumbnailChoices(selected).then((choices) => {
        setThumbnailChoices((current) => {
          releaseLocalThumbnailChoices(current);
          return choices;
        });
      });

      await uploadPreparedVideoDirectly({
        session: draft.uploadSession,
        file: selected,
        onProgress: setProgress,
      });
      await confirmQuickUpload(draft.video.id);
      trackAnalyticsEvent("UPLOAD_COMPLETE", {
        channelId: identity.channel.id,
        videoId: draft.video.id,
      });
      setUploadComplete(true);
      setMessage("Upload complete. Add the rights confirmation and publish when ready.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "This upload could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveDetails() {
    if (!videoId) return;
    try {
      await saveQuickVideoDetails(videoId, detailsPayload());
      setMessage("Draft details saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The draft details could not be saved.");
    }
  }

  async function chooseCapturedThumbnail(choice: LocalThumbnailChoice) {
    if (!videoId) return;
    setSelectedThumbnailId(choice.id);
    try {
      await uploadQuickThumbnail(videoId, choice.blob);
      setMessage(`${choice.label} saved as the video thumbnail.`);
    } catch (error) {
      setSelectedThumbnailId(null);
      setMessage(error instanceof Error ? error.message : "The thumbnail could not be saved.");
    }
  }

  async function chooseCustomThumbnail(selected: File | null) {
    if (!selected || !videoId) return;
    try {
      await uploadQuickThumbnail(videoId, selected);
      setSelectedThumbnailId("custom");
      setMessage("Custom thumbnail saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The thumbnail could not be saved.");
    }
  }

  async function publish() {
    if (!videoId || !uploadComplete || !rightsConfirmed || !title.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await publishQuickVideo(videoId, {
        ...detailsPayload(),
        rightsConfirmed,
      });
      trackAnalyticsEvent("PUBLISH", {
        ...(identity ? { channelId: identity.channel.id } : {}),
        videoId,
        metadata: { scheduled: result.video.status === "SCHEDULED" },
      });
      setPublished(true);
      setMessage(
        result.video.status === "SCHEDULED"
          ? "Video scheduled. You can edit its details later."
          : "Published. The video is now in Uploads and eligible for Creator TV when enabled.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The video could not be published.");
    } finally {
      setBusy(false);
    }
  }

  function detailsPayload() {
    return {
      title: title.trim(),
      description: description.trim() || null,
      visibility,
      commentsEnabled,
      scheduledPublishAt: scheduledPublishAt ? new Date(scheduledPublishAt).toISOString() : null,
    };
  }

  return (
    <section className={styles.shell} aria-labelledby="quick-upload-title">
      <div className={styles.heading}>
        <p className={styles.eyebrow}>Quick Create</p>
        <h1 id="quick-upload-title">Choose video. Upload. Publish.</h1>
        <p>
          Pick a playback-ready MP4 and AYIN immediately creates a draft, checks it locally, and
          uploads the video straight to Cloudflare R2.
        </p>
      </div>

      <label className={styles.picker}>
        <strong>{file ? file.name : "Choose your MP4"}</strong>
        <span>No Studio setup required.</span>
        <input
          type="file"
          accept="video/mp4,.mp4"
          disabled={!identity || busy || published}
          onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)}
        />
      </label>

      {inspection ? (
        <p className={styles[inspection.status]} role="status">
          {inspection.message}
        </p>
      ) : null}

      {videoId ? (
        <div className={styles.editor}>
          <label>
            <span>Title</span>
            <input
              maxLength={200}
              value={title}
              onBlur={() => void saveDetails()}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          <div className={styles.progressBlock}>
            <div className={styles.progressText}>
              <strong>{uploadComplete ? "Upload complete" : "Uploading directly to R2"}</strong>
              <span>{progress}%</span>
            </div>
            <progress max={100} value={progress} aria-label="Upload progress" />
          </div>

          <details className={styles.advanced}>
            <summary>Advanced settings</summary>
            <div className={styles.advancedGrid}>
              <label className={styles.fullWidth}>
                <span>Description</span>
                <textarea
                  rows={4}
                  value={description}
                  onBlur={() => void saveDetails()}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>

              <label>
                <span>Visibility</span>
                <select
                  value={visibility}
                  onBlur={() => void saveDetails()}
                  onChange={(event) => setVisibility(event.target.value as Visibility)}
                >
                  <option value="PUBLIC">Public</option>
                  <option value="UNLISTED">Unlisted</option>
                  <option value="PRIVATE">Private</option>
                </select>
              </label>

              <label>
                <span>Schedule</span>
                <input
                  type="datetime-local"
                  value={scheduledPublishAt}
                  onBlur={() => void saveDetails()}
                  onChange={(event) => setScheduledPublishAt(event.target.value)}
                />
              </label>

              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={commentsEnabled}
                  onChange={(event) => setCommentsEnabled(event.target.checked)}
                />
                <span>Allow comments</span>
              </label>

              <div className={styles.fullWidth}>
                <span className={styles.fieldLabel}>Thumbnail</span>
                {thumbnailChoices.length ? (
                  <div className={styles.thumbnailGrid}>
                    {thumbnailChoices.map((choice) => (
                      <button
                        className={
                          selectedThumbnailId === choice.id
                            ? styles.thumbnailSelected
                            : styles.thumbnail
                        }
                        key={choice.id}
                        type="button"
                        onClick={() => void chooseCapturedThumbnail(choice)}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={choice.previewUrl} alt={`${choice.label} preview`} />
                        <span>{choice.label}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className={styles.hint}>
                    Local frame choices appear when your browser can capture them safely.
                  </p>
                )}
                <label className={styles.customThumbnail}>
                  <span>
                    {selectedThumbnailId === "custom" ? "Custom thumbnail saved" : "Choose JPG/PNG"}
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                    onChange={(event) =>
                      void chooseCustomThumbnail(event.target.files?.[0] ?? null)
                    }
                  />
                </label>
              </div>

              <p className={`${styles.hint} ${styles.fullWidth}`}>
                Tags/category, language, captions, chapters, maturity, geo restrictions and ad-break
                preferences stay out of the simple flow until their dedicated schema capabilities
                are available. They never block publishing.
              </p>
            </div>
          </details>

          <label className={styles.rights}>
            <input
              type="checkbox"
              checked={rightsConfirmed}
              onChange={(event) => setRightsConfirmed(event.target.checked)}
            />
            <span>
              I confirm that I own or have the rights and permissions required to publish this video
              on AYIN.
            </span>
          </label>

          <button
            className={styles.publish}
            type="button"
            disabled={!uploadComplete || !rightsConfirmed || !title.trim() || busy || published}
            onClick={() => void publish()}
          >
            {published ? "Published" : busy && uploadComplete ? "Publishing…" : "Publish"}
          </button>
        </div>
      ) : null}

      {message ? <p className={styles.message}>{message}</p> : null}
    </section>
  );
}
