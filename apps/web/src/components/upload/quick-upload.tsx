"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";

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
  getQuickProcessingStatus,
  publishQuickVideo,
  saveQuickVideoDetails,
  uploadQuickThumbnail,
  type VideoForm,
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
  const [videoForm, setVideoForm] = useState<VideoForm>("LONG_FORM");
  const [scheduledPublishAt, setScheduledPublishAt] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [processingReady, setProcessingReady] = useState(false);
  const [processingLabel, setProcessingLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [thumbnailChoices, setThumbnailChoices] = useState<LocalThumbnailChoice[]>([]);
  const [selectedThumbnailId, setSelectedThumbnailId] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const [dragActive, setDragActive] = useState(false);
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
    setProcessingReady(false);
    setProcessingLabel(null);
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
        videoForm,
      });
      setVideoId(draft.video.id);
      setVisibility(draft.video.visibility);
      setCommentsEnabled(draft.video.commentsEnabled);
      setMessage("Your video is uploading…");

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
      const confirmation = await confirmQuickUpload(draft.video.id);
      setProcessingReady(confirmation.status === "DRAFT");
      setProcessingLabel(confirmation.status === "DRAFT" ? "Ready" : "Queued");
      trackAnalyticsEvent("UPLOAD_COMPLETE", {
        channelId: identity.channel.id,
        videoId: draft.video.id,
      });
      setUploadComplete(true);
      setMessage(
        confirmation.status === "DRAFT"
          ? "Upload and processing complete. Confirm your publishing rights, then publish when you're ready."
          : "Upload complete. AYIN is preparing a reliable playback version in the background.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "This upload could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (!identity || busy || published) return;
    event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    if (!identity || busy || published) return;
    const selected = Array.from(event.dataTransfer.files).find((candidate) =>
      candidate.type.startsWith("video/"),
    );
    if (!selected) {
      setMessage("Drop one supported video file to start an upload.");
      return;
    }
    void chooseFile(selected);
  }

  useEffect(() => {
    if (!videoId || !uploadComplete || processingReady || published) return;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    const poll = async () => {
      try {
        const status = await getQuickProcessingStatus(videoId, controller.signal);
        if (!active) return;
        const processing = status.processing;
        setProcessingReady(status.ready);
        setProcessingLabel(
          status.ready
            ? "Ready"
            : processing?.status === "FAILED"
              ? "Failed"
              : (processing?.stage?.replaceAll("_", " ") ?? processing?.status ?? "Queued"),
        );
        if (status.ready) {
          setMessage("Processing complete. This video is ready to publish.");
          return;
        }
        if (processing?.status === "FAILED") {
          setMessage(
            processing.errorMessage ||
              "AYIN could not prepare this video for playback. It remains saved in Studio.",
          );
          return;
        }
        timeout = setTimeout(() => void poll(), 2000);
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setMessage(
          error instanceof Error ? error.message : "Processing status is temporarily unavailable.",
        );
        timeout = setTimeout(() => void poll(), 4000);
      }
    };

    void poll();
    return () => {
      active = false;
      controller.abort();
      if (timeout) clearTimeout(timeout);
    };
  }, [processingReady, published, uploadComplete, videoId]);

  async function saveDetails() {
    if (!videoId) return;
    try {
      await saveQuickVideoDetails(videoId, detailsPayload());
      setMessage("Video details saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The video details could not be saved.");
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
    if (!videoId || !uploadComplete || !processingReady || !rightsConfirmed || !title.trim())
      return;
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
          : "Published. Your video is now available on your channel.",
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
      videoForm,
    };
  }

  const formatLabel = videoForm === "CLIP" ? "AYIN Clip" : "Standard video";
  const statusLabel = published
    ? "Published"
    : processingReady
      ? "Ready"
      : uploadComplete
        ? (processingLabel ?? "Processing")
        : videoId
          ? `${progress}% uploaded`
          : "Not started";

  return (
    <section className={styles.shell} aria-labelledby="quick-upload-title">
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrowRow}>
            <span className={styles.eyebrowDot} aria-hidden="true" />
            <p className={styles.eyebrow}>Creator upload</p>
          </div>
          <h1 id="quick-upload-title">Bring your next video to AYIN.</h1>
          <p className={styles.heroLead}>
            Choose the experience, add your file, and publish from one focused workspace. AYIN checks
            compatibility and prepares reliable playback automatically.
          </p>
        </div>

        <div className={styles.heroSignals} aria-label="Upload workflow">
          <span>
            <i aria-hidden="true" /> Direct upload
          </span>
          <span>
            <i aria-hidden="true" /> Compatibility check
          </span>
          <span>
            <i aria-hidden="true" /> Playback processing
          </span>
        </div>
      </header>

      <div className={styles.workspace}>
        <section className={styles.stepCard} aria-labelledby="format-heading">
          <div className={styles.stepHeading}>
            <div>
              <span className={styles.stepNumber}>01</span>
              <h2 id="format-heading">Choose the viewing experience</h2>
              <p>Pick how this upload should appear across AYIN before selecting the file.</p>
            </div>
            <span className={styles.selectionPill}>{formatLabel}</span>
          </div>

          <div className={styles.typeGrid} role="radiogroup" aria-label="Video format">
            <button
              className={`${styles.typeCard} ${videoForm === "LONG_FORM" ? styles.typeCardSelected : ""}`}
              type="button"
              role="radio"
              aria-checked={videoForm === "LONG_FORM"}
              disabled={Boolean(videoId) || busy || published}
              onClick={() => setVideoForm("LONG_FORM")}
            >
              <span className={styles.typeVisual} aria-hidden="true">
                <span className={styles.landscapeFrame} />
              </span>
              <span className={styles.typeCopy}>
                <strong>Standard video</strong>
                <small>Full videos, episodes, tutorials and long-form stories.</small>
              </span>
              <span className={styles.typeMeta}>Landscape + flexible</span>
              <span className={styles.typeCheck} aria-hidden="true">✓</span>
            </button>

            <button
              className={`${styles.typeCard} ${videoForm === "CLIP" ? styles.typeCardSelected : ""}`}
              type="button"
              role="radio"
              aria-checked={videoForm === "CLIP"}
              disabled={Boolean(videoId) || busy || published}
              onClick={() => setVideoForm("CLIP")}
            >
              <span className={styles.typeVisual} aria-hidden="true">
                <span className={styles.portraitFrame} />
              </span>
              <span className={styles.typeCopy}>
                <strong>AYIN Clip</strong>
                <small>Fast, vertical-first videos built for the Clips feed.</small>
              </span>
              <span className={styles.typeMeta}>Vertical-first</span>
              <span className={styles.typeCheck} aria-hidden="true">✓</span>
            </button>
          </div>
        </section>

        <section className={styles.stepCard} aria-labelledby="file-heading">
          <div className={styles.stepHeading}>
            <div>
              <span className={styles.stepNumber}>02</span>
              <h2 id="file-heading">Add your video</h2>
              <p>Drag it here on desktop or open your library on mobile.</p>
            </div>
            {file ? <span className={styles.selectionPill}>File selected</span> : null}
          </div>

          <label
            className={`${styles.picker} ${dragActive ? styles.pickerActive : ""} ${!identity ? styles.pickerDisabled : ""}`}
            onDragEnter={handleDragOver}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              className={styles.fileInput}
              type="file"
              accept="video/*,.mp4,.mov,.mkv,.webm,.avi,.mpeg,.mpg,.mts,.m2ts,.ts,.3gp,.3g2,.m4v,.wmv,.flv,.ogv,.mxf"
              disabled={!identity || busy || published}
              onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)}
            />

            <span className={styles.uploadGlyph} aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3" />
              </svg>
            </span>

            <span className={styles.pickerCopy}>
              <strong>{file ? file.name : dragActive ? "Drop your video here" : "Select a video to upload"}</strong>
              <span>
                {file
                  ? `${formatFileSize(file.size)} · ${formatLabel}`
                  : identity
                    ? "Drag & drop a file here, or browse your device."
                    : "Preparing your creator workspace…"}
              </span>
            </span>

            <span className={styles.browseButton}>
              {busy ? "Checking…" : file ? "Choose another" : "Browse video"}
            </span>

            <span className={styles.pickerMeta}>MP4, MOV, MKV, WebM and other common video formats</span>
          </label>

          {inspection ? (
            <p className={styles[inspection.status]} role="status">
              {inspection.message}
            </p>
          ) : null}
        </section>

        {videoId ? (
          <section className={`${styles.stepCard} ${styles.editor}`} aria-labelledby="details-heading">
            <div className={styles.stepHeading}>
              <div>
                <span className={styles.stepNumber}>03</span>
                <h2 id="details-heading">Finish your video</h2>
                <p>Review the essentials while AYIN completes the upload and playback preparation.</p>
              </div>
              <span
                className={`${styles.statusPill} ${processingReady ? styles.statusReady : ""} ${published ? styles.statusPublished : ""}`}
              >
                <span aria-hidden="true" />
                {statusLabel}
              </span>
            </div>

            <div className={styles.editorTopGrid}>
              <label className={styles.titleField}>
                <span>Title</span>
                <input
                  maxLength={200}
                  value={title}
                  placeholder="Give your video a clear title"
                  onBlur={() => void saveDetails()}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>

              <div className={styles.progressCard}>
                <div className={styles.progressText}>
                  <span>
                    <small>Upload status</small>
                    <strong>
                      {uploadComplete
                        ? processingReady
                          ? "Ready to publish"
                          : "Preparing playback"
                        : "Uploading video"}
                    </strong>
                  </span>
                  <strong className={styles.progressValue}>
                    {uploadComplete ? (processingLabel ?? "Queued") : `${progress}%`}
                  </strong>
                </div>
                <div
                  className={styles.progressTrack}
                  role="progressbar"
                  aria-label="Upload progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                >
                  <span style={{ width: `${Math.max(2, progress)}%` }} />
                </div>
              </div>
            </div>

            <details className={styles.advanced}>
              <summary>
                <span>
                  <strong>Publishing settings</strong>
                  <small>Description, visibility, schedule, comments and thumbnail</small>
                </span>
                <span className={styles.summaryChevron} aria-hidden="true">⌄</span>
              </summary>
              <div className={styles.advancedGrid}>
                <label className={styles.fullWidth}>
                  <span>Description</span>
                  <textarea
                    rows={5}
                    value={description}
                    placeholder="Tell viewers what this video is about"
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
                      Thumbnail suggestions appear when they are available.
                    </p>
                  )}
                  <label className={styles.customThumbnail}>
                    <span>
                      {selectedThumbnailId === "custom"
                        ? "Custom thumbnail saved"
                        : "Upload a custom JPG or PNG"}
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
              </div>
            </details>

            <div className={styles.publishDock}>
              <label className={styles.rights}>
                <input
                  type="checkbox"
                  checked={rightsConfirmed}
                  onChange={(event) => setRightsConfirmed(event.target.checked)}
                />
                <span>
                  I confirm that I own or have the rights and permissions required to publish this
                  video on AYIN.
                </span>
              </label>

              <button
                className={styles.publish}
                type="button"
                disabled={
                  !uploadComplete ||
                  !processingReady ||
                  !rightsConfirmed ||
                  !title.trim() ||
                  busy ||
                  published
                }
                onClick={() => void publish()}
              >
                <span>{published ? "Published" : busy && uploadComplete ? "Publishing…" : "Publish video"}</span>
                {!published ? <span aria-hidden="true">→</span> : null}
              </button>
            </div>
          </section>
        ) : null}
      </div>

      {message ? (
        <p className={styles.message} role="status" aria-live="polite">
          <span aria-hidden="true" />
          {message}
        </p>
      ) : null}
    </section>
  );
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Video file";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
