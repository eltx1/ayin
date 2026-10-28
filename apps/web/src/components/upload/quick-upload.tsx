"use client";
import { uploadText } from "@/lib/upload-copy";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ActionButton, ActionLink, PageHeader } from "@/components/ui/design-system";
import { useI18n } from "@/components/i18n/i18n-provider";
import { scheduleTimestamp, uploadId, uploadRecord } from "@/lib/quick-upload-contract";
import { describeQuickProcessing } from "@/lib/quick-upload-processing";
import { UploadProtocolError } from "@/lib/upload-session";

import { trackAnalyticsEvent } from "@/lib/analytics";
import { apiBaseUrl } from "@/lib/api";
import {
  completeVideoUpload,
  UploadBlobError,
  uploadPreparedVideoDirectly,
  type UploadSession,
  type DirectUploadCompletionInput,
} from "@/lib/direct-video-upload";
import {
  isRejectedUploadRequest,
  uploadErrorMessage,
  UploadRequestError,
} from "@/lib/upload-error";
import {
  captureLocalThumbnailChoices,
  releaseLocalThumbnailChoices,
  type LocalThumbnailChoice,
} from "@/lib/local-thumbnail";
import {
  confirmQuickUpload,
  createQuickDraft,
  getQuickProcessingStatus,
  getUploadCapabilities,
  verifyUploadIdentity,
  type UploadCapabilities,
  publishQuickVideo,
  saveQuickVideoDetails,
  uploadQuickThumbnail,
  type VideoForm,
} from "@/lib/quick-upload";
import { titleFromFilename } from "@/lib/title-from-filename";
import {
  inspectVideoFile,
  isSupportedVideoFile,
  type VideoInspectionResult,
} from "@/lib/video-inspection";

import {
  buildMetadataPayload,
  EMPTY_METADATA_DRAFT,
  VideoMetadataFields,
} from "./video-metadata-fields";
import styles from "./quick-upload.module.css";

type Visibility = "PUBLIC" | "UNLISTED" | "PRIVATE";
type TransferPhase =
  | "idle"
  | "checking"
  | "preparing"
  | "uploading"
  | "retrying"
  | "finalizing"
  | "paused"
  | "processing"
  | "ready"
  | "failed";
type UploadFailure = {
  title: string;
  detail: string;
  action: "retry" | "review" | "signin" | "choose" | "processing" | "edit";
};
type PreparedUpload = {
  videoId: string;
  session: UploadSession;
  file: File;
  completion: DirectUploadCompletionInput | null;
  storageComplete: boolean;
  transferStarted: boolean;
};

export function QuickUpload() {
  const router = useRouter();
  const { href, locale, direction } = useI18n();
  const copy = useCallback((value: string) => uploadText(value, locale), [locale]);
  const [identity, setIdentity] = useState<{
    account: { id: string };
    channel: { id: string };
  } | null>(null);
  const [capabilities, setCapabilities] = useState<UploadCapabilities | null>(null);
  const [phase, setPhase] = useState<TransferPhase>("idle");
  const [failure, setFailure] = useState<UploadFailure | null>(null);
  const [transferredBytes, setTransferredBytes] = useState(0);
  const [transferRate, setTransferRate] = useState<number | null>(null);
  const [processingPercent, setProcessingPercent] = useState(0);
  const prepared = useRef<PreparedUpload | null>(null);
  const phaseRef = useRef<TransferPhase>("idle");
  const feedback = useRef<HTMLDivElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const speedSample = useRef({ time: 0, bytes: 0 });
  const [file, setFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<VideoInspectionResult | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("PUBLIC");
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [videoForm, setVideoForm] = useState<VideoForm>("LONG_FORM");
  const [scheduledPublishAt, setScheduledPublishAt] = useState("");
  const [metadataDraft, setMetadataDraft] = useState(() => ({ ...EMPTY_METADATA_DRAFT }));
  const [progress, setProgress] = useState(0);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [processingReady, setProcessingReady] = useState(false);
  const [processingLabel, setProcessingLabel] = useState<string | null>(null);
  const [processingStageLabel, setProcessingStageLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mutationKind, setMutationKind] = useState<
    "upload" | "save" | "thumbnail" | "publish" | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [thumbnailChoices, setThumbnailChoices] = useState<LocalThumbnailChoice[]>([]);
  const [selectedThumbnailId, setSelectedThumbnailId] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const choicesRef = useRef<LocalThumbnailChoice[]>([]);
  const thumbnailCapture = useRef<AbortController | null>(null);
  const mutation = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [identityFailed, setIdentityFailed] = useState(false);
  const [identityAttempt, setIdentityAttempt] = useState(0);
  const [processingAttempt, setProcessingAttempt] = useState(0);
  const [processingCheckNeeded, setProcessingCheckNeeded] = useState(false);
  const [savedSignature, setSavedSignature] = useState("");
  const signature = JSON.stringify([
    title,
    description,
    visibility,
    commentsEnabled,
    videoForm,
    scheduledPublishAt,
    metadataDraft,
  ]);
  const dirty =
    !published && (busy || uncertain || Boolean(videoId && signature !== savedSignature));

  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (
        !(target instanceof HTMLAnchorElement) ||
        target.target === "_blank" ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      if (target.href === window.location.href) return;
      if (
        !window.confirm(
          copy(
            "Leave this upload? Unsaved changes and local file progress will be lost. Saved drafts remain in Studio.",
          ),
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty, copy]);

  useEffect(() => {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 15000);
    void fetch(`${apiBaseUrl}/auth/me`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          setIdentityFailed(true);
          return;
        }
        const row = uploadRecord(await response.json());
        const account = uploadRecord(row.account),
          channel = uploadRecord(row.channel);
        const accountId = uploadId(account.id),
          channelId = uploadId(channel.id);
        const limits = await getUploadCapabilities(accountId, channelId, controller.signal);
        if (!controller.signal.aborted) {
          setIdentity({ account: { id: accountId }, channel: { id: channelId } });
          setCapabilities(limits);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted || controller.signal.reason?.name === "AbortError")
          setIdentityFailed(true);
      })
      .finally(() => clearTimeout(deadline));
    return () => {
      clearTimeout(deadline);
      controller.abort(new DOMException("Unmounted", "Unmounted"));
    };
  }, [identityAttempt]);

  useEffect(() => {
    if (!failure && !uncertain) return;
    feedback.current?.focus({ preventScroll: true });
    feedback.current?.scrollIntoView({
      block: "nearest",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [failure, uncertain]);

  useEffect(() => {
    choicesRef.current = thumbnailChoices;
  }, [thumbnailChoices]);

  useEffect(
    () => () => {
      thumbnailCapture.current?.abort();
      operation.current?.abort();
      releaseLocalThumbnailChoices(choicesRef.current);
    },
    [],
  );

  function changePhase(next: TransferPhase) {
    phaseRef.current = next;
    setPhase(next);
  }

  function showUploadFailure(error: unknown, stage: TransferPhase) {
    const signIn =
      error instanceof UploadRequestError &&
      error.status === 401 &&
      !["INVALID_UPLOAD_SESSION", "UPLOAD_SESSION_EXPIRED", "STEP_UP_REQUIRED"].includes(
        error.code ?? "",
      );
    const expired =
      error instanceof UploadRequestError &&
      ["UPLOAD_SESSION_EXPIRED", "INVALID_UPLOAD_SESSION", "UPLOAD_STATE_CHANGED"].includes(
        error.code ?? "",
      );
    const rejectedBeforeDraft = !prepared.current && isRejectedUploadRequest(error);
    const safeRetry =
      Boolean(prepared.current) &&
      !expired &&
      !signIn &&
      !(error instanceof UploadProtocolError) &&
      !(error instanceof UploadRequestError && error.status === 403);
    setUncertain(!safeRetry && !rejectedBeforeDraft);
    changePhase("failed");
    setMessage(null);
    setFailure({
      title: copy("Upload needs attention"),
      detail: copy(
        (error instanceof UploadProtocolError
          ? "The upload response could not be verified. Review this upload in Studio before trying again."
          : error instanceof UploadBlobError
            ? error.status && error.status >= 400 && error.status < 500
              ? "Storage rejected the transfer. Retry to refresh the upload connection; your saved draft will be reused."
              : "The file transfer stopped after automatic retries. Check your connection, then retry this upload."
            : uploadErrorMessage(error)) ??
          (safeRetry
            ? stage === "finalizing"
              ? "The final confirmation did not arrive. Retry to check and finish this same upload."
              : "Your connection was interrupted. Retry to continue this upload without creating another video."
            : "We could not confirm whether the upload was saved. Check your saved videos before starting another upload."),
      ),
      action: signIn ? "signin" : safeRetry ? "retry" : rejectedBeforeDraft ? "choose" : "review",
    });
  }

  async function transfer(current: PreparedUpload, signal: AbortSignal) {
    setTransferRate(null);
    speedSample.current = { time: 0, bytes: 0 };
    let confirmation: Awaited<ReturnType<typeof confirmQuickUpload>> | null = null;
    if (!current.storageComplete && current.completion) {
      changePhase("finalizing");
      // Completion may have committed before its response was lost. Confirm
      // first; a completed worker may already have removed the staging source.
      try {
        confirmation = await confirmQuickUpload(current.videoId, signal);
        current.storageComplete = true;
      } catch (error) {
        if (!(error instanceof UploadRequestError) || error.code !== "UPLOAD_NOT_COMPLETE")
          throw error;
        await completeVideoUpload(current.completion, current.session.assetId, signal);
        current.storageComplete = true;
      }
    } else if (!current.storageComplete) {
      const renewSingleAuthorization = current.transferStarted;
      current.transferStarted = true;
      await uploadPreparedVideoDirectly({
        session: current.session,
        file: current.file,
        signal,
        renewSingleAuthorization,
        onProgress: setProgress,
        onBytesProgress: (bytes) => {
          setTransferredBytes(bytes);
          const time = Date.now();
          const sample = speedSample.current;
          if (sample.time && time - sample.time >= 750 && bytes > sample.bytes) {
            const rate = ((bytes - sample.bytes) * 1000) / (time - sample.time);
            setTransferRate((previous) => (previous ? previous * 0.6 + rate * 0.4 : rate));
            speedSample.current = { time, bytes };
          } else if (!sample.time || bytes < sample.bytes) speedSample.current = { time, bytes };
        },
        onStatus: (status) => {
          changePhase(status.phase);
          if (status.phase === "retrying") {
            setTransferRate(null);
            speedSample.current = { time: 0, bytes: 0 };
          }
          setMessage(
            copy(
              status.phase === "finalizing"
                ? "Finalizing upload…"
                : status.phase === "retrying"
                  ? "Connection paused. Retrying the upload safely…"
                  : "Keep this page open until the upload finishes. You can edit the details below.",
            ),
          );
        },
        completeUpload: async (payload) => {
          current.completion = payload;
          const result = await completeVideoUpload(payload, current.session.assetId, signal);
          current.storageComplete = true;
          return result;
        },
      });
    }
    changePhase("finalizing");
    confirmation ??= await confirmQuickUpload(current.videoId, signal);
    signal.throwIfAborted();
    setProgress(100);
    setTransferredBytes(current.file.size);
    setProcessingReady(confirmation.status === "DRAFT");
    setProcessingLabel(confirmation.status === "DRAFT" ? copy("Ready") : copy("Queued"));
    setUploadComplete(true);
    changePhase(confirmation.status === "DRAFT" ? "ready" : "processing");
    setMessage(
      copy(
        confirmation.status === "DRAFT"
          ? "Upload and processing complete. Your video is ready to publish."
          : "Upload complete. AYIN is preparing a reliable playback version in the background.",
      ),
    );
    trackAnalyticsEvent("UPLOAD_COMPLETE", {
      ...(identity ? { channelId: identity.channel.id } : {}),
      videoId: current.videoId,
    });
  }

  async function retryUpload() {
    if (mutation.current || !prepared.current || !identity) return;
    const controller = new AbortController();
    operation.current = controller;
    mutation.current = true;
    setBusy(true);
    setMutationKind("upload");
    setFailure(null);
    setUncertain(false);
    try {
      await verifyUploadIdentity(identity.account.id, identity.channel.id, controller.signal);
      await transfer(prepared.current, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) showUploadFailure(error, phaseRef.current);
    } finally {
      mutation.current = false;
      setBusy(false);
      setMutationKind(null);
    }
  }

  function pauseUpload() {
    if (!["uploading", "retrying"].includes(phaseRef.current)) return;
    operation.current?.abort();
    changePhase("paused");
    setMessage(copy("Upload paused. Keep this page open to continue from this file."));
    setFailure(null);
  }

  async function chooseFile(selected: File | null) {
    if (
      !selected ||
      !identity ||
      !capabilities ||
      mutation.current ||
      videoId ||
      uncertain ||
      published
    )
      return;
    if (!selected.size || !isSupportedVideoFile(selected)) {
      setFailure({
        title: copy("Choose a video file"),
        detail: copy("Drop one supported video file to start an upload."),
        action: "choose",
      });
      return;
    }
    if (
      !capabilities.storageAvailable ||
      selected.size > Math.min(capabilities.maxFileSizeBytes, capabilities.availableStorageBytes)
    ) {
      setFailure({
        title: copy("This file cannot be uploaded yet"),
        detail: copy(
          !capabilities.storageAvailable
            ? "Video uploads are temporarily unavailable. Please try again later."
            : selected.size > capabilities.maxFileSizeBytes
              ? "This file is larger than the upload limit shown below. Choose a smaller file."
              : "Your channel does not have enough storage for this video. Review saved videos in Studio.",
        ),
        action: "choose",
      });
      return;
    }
    mutation.current = true;
    const controller = new AbortController();
    operation.current = controller;
    thumbnailCapture.current?.abort();
    const capture = new AbortController();
    thumbnailCapture.current = capture;
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
    setProcessingStageLabel(null);
    setProcessingCheckNeeded(false);
    setPublished(false);
    setMetadataDraft({ ...EMPTY_METADATA_DRAFT });
    setMessage(null);
    setFailure(null);
    prepared.current = null;
    changePhase("checking");
    setBusy(true);
    setMutationKind("upload");
    const nextTitle = titleFromFilename(selected.name);
    setTitle(nextTitle);
    try {
      const result = await inspectVideoFile(selected);
      controller.signal.throwIfAborted();
      setInspection(result);
      if (result.status === "incompatible") {
        setFailure({
          title: copy("Choose a supported video"),
          detail: copy(result.message),
          action: "choose",
        });
        changePhase("failed");
        return;
      }
      trackAnalyticsEvent("UPLOAD_START", { channelId: identity.channel.id });
      changePhase("preparing");
      const draft = await createQuickDraft({
        channelId: identity.channel.id,
        title: nextTitle,
        file: selected,
        durationMs: result.durationSeconds ? Math.round(result.durationSeconds * 1000) : null,
        videoForm,
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      prepared.current = {
        videoId: draft.video.id,
        session: draft.uploadSession,
        file: selected,
        completion: null,
        storageComplete: false,
        transferStarted: false,
      };
      setVideoId(draft.video.id);
      setVisibility(draft.video.visibility);
      setCommentsEnabled(draft.video.commentsEnabled);
      setMessage(copy("Your video is uploading…"));

      void captureLocalThumbnailChoices(selected, capture.signal).then((choices) => {
        if (capture.signal.aborted) {
          releaseLocalThumbnailChoices(choices);
          return;
        }
        setThumbnailChoices((current) => {
          releaseLocalThumbnailChoices(current);
          return choices;
        });
      });

      await transfer(prepared.current, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      showUploadFailure(error, phaseRef.current);
    } finally {
      mutation.current = false;
      setBusy(false);
      setMutationKind(null);
    }
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (!identity || mutation.current || videoId || uncertain || published) return;
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
    if (!identity || mutation.current || videoId || uncertain || published) return;
    const selected = Array.from(event.dataTransfer.files).find(isSupportedVideoFile);
    if (!selected) {
      setFailure({
        title: copy("Choose a video file"),
        detail: copy("Drop one supported video file to start an upload."),
        action: "choose",
      });
      return;
    }
    void chooseFile(selected);
  }

  useEffect(() => {
    if (!videoId || !uploadComplete || processingReady || published || uncertain) return;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let active = true;
    let reads = 0;

    const poll = async () => {
      if (document.hidden) {
        timeout = setTimeout(() => void poll(), 15000);
        return;
      }
      try {
        const status = await getQuickProcessingStatus(videoId, controller.signal);
        reads++;
        if (!active) return;
        const update = describeQuickProcessing(status, reads);
        setProcessingCheckNeeded(update.checkNeeded);
        setProcessingReady(status.ready);
        setProcessingPercent(status.processing?.progressPercent ?? 0);
        if (status.ready) {
          changePhase("ready");
          setFailure((current) => (current?.action === "processing" ? null : current));
        }
        if (
          !status.ready &&
          (status.processing?.status === "FAILED" || status.processing?.status === "CANCELLED")
        ) {
          setFailure({
            title: copy("Video processing needs attention"),
            detail: copy(
              update.message ??
                "Processing status is temporarily unavailable. Retry checking its status.",
            ),
            action: "processing",
          });
        }
        setProcessingLabel(copy(update.label));
        setProcessingStageLabel(update.stageLabel ? copy(update.stageLabel) : null);
        if (update.message) {
          setMessage(copy(update.message));
        } else if (reads === 1) {
          setMessage((current) =>
            current === copy("Checking processing status…")
              ? copy(
                  "Upload complete. AYIN is preparing a reliable playback version in the background.",
                )
              : current,
          );
        }
        if (status.ready || update.checkNeeded) return;
        timeout = setTimeout(
          () => void poll(),
          reads < 15 ? 2000 : reads < 60 ? 5000 : reads < 120 ? 15000 : 30000,
        );
      } catch {
        if (!active || controller.signal.aborted) return;
        setProcessingCheckNeeded(true);
        setFailure({
          title: copy("Could not check processing"),
          detail: copy(
            "Your upload is saved. Retry the status check; you do not need to upload the file again.",
          ),
          action: "processing",
        });
        setMessage(
          copy("Processing status is temporarily unavailable. Retry checking its status."),
        );
      }
    };

    void poll();
    return () => {
      active = false;
      controller.abort();
      if (timeout) clearTimeout(timeout);
    };
  }, [processingReady, published, uploadComplete, videoId, processingAttempt, uncertain, copy]);

  async function saveDetails() {
    if (!videoId || mutation.current || uncertain || published) return;
    let payload;
    try {
      payload = detailsPayload();
    } catch {
      setFailure({
        title: copy("Check your video details"),
        detail: copy("Check the title, schedule and advanced metadata before saving."),
        action: "edit",
      });
      setMessage(copy("Check the title, schedule and advanced metadata before saving."));
      return;
    }
    mutation.current = true;
    setFailure(null);
    setBusy(true);
    setMutationKind("save");
    const controller = new AbortController();
    operation.current = controller;
    try {
      await saveQuickVideoDetails(videoId, payload, controller.signal);
      controller.signal.throwIfAborted();
      setSavedSignature(signature);
      setMessage(copy("Video details saved."));
    } catch (error) {
      if (!controller.signal.aborted) {
        if (isRejectedUploadRequest(error)) {
          setFailure({
            title: copy("Details were not saved"),
            detail: copy(
              uploadErrorMessage(error) ??
                "Check the title, schedule and advanced metadata before saving.",
            ),
            action: "edit",
          });
          return;
        }
        setUncertain(true);
        setMessage(
          copy(
            "The save response could not be confirmed. Review this draft in Studio before writing again.",
          ),
        );
      }
    } finally {
      mutation.current = false;
      setBusy(false);
      setMutationKind(null);
    }
  }

  async function chooseCapturedThumbnail(choice: LocalThumbnailChoice) {
    await saveThumbnail(choice.blob, choice.id);
  }

  async function chooseCustomThumbnail(selected: File | null) {
    if (!selected) return;
    await saveThumbnail(selected, "custom");
  }

  async function saveThumbnail(selected: Blob, choiceId: string) {
    if (!videoId || mutation.current || uncertain || published) return;
    if (
      !["image/png", "image/jpeg"].includes(selected.type) ||
      selected.size < 1 ||
      selected.size > 5 * 1024 * 1024
    ) {
      setMessage(copy("Choose a JPG or PNG thumbnail up to 5 MB."));
      return;
    }
    mutation.current = true;
    setFailure(null);
    setBusy(true);
    setMutationKind("thumbnail");
    const controller = new AbortController();
    operation.current = controller;
    try {
      await uploadQuickThumbnail(videoId, selected, controller.signal);
      controller.signal.throwIfAborted();
      setSelectedThumbnailId(choiceId);
      setMessage(copy("Thumbnail saved."));
    } catch (error) {
      if (!controller.signal.aborted) {
        if (isRejectedUploadRequest(error)) {
          setFailure({
            title: copy("Thumbnail was not saved"),
            detail: copy(uploadErrorMessage(error) ?? "Choose a JPG or PNG thumbnail up to 5 MB."),
            action: "edit",
          });
          return;
        }
        setUncertain(true);
        setMessage(
          copy(
            "The thumbnail response could not be confirmed. Review this draft in Studio before writing again.",
          ),
        );
      }
    } finally {
      mutation.current = false;
      setBusy(false);
      setMutationKind(null);
    }
  }

  async function publish() {
    if (
      !videoId ||
      !uploadComplete ||
      !processingReady ||
      mutation.current ||
      uncertain ||
      published
    )
      return;
    let payload;
    try {
      payload = detailsPayload();
    } catch {
      setFailure({
        title: copy("Check your video details"),
        detail: copy("Check the title, schedule and advanced metadata before publishing."),
        action: "edit",
      });
      setMessage(copy("Check the title, schedule and advanced metadata before publishing."));
      return;
    }
    mutation.current = true;
    const controller = new AbortController();
    operation.current = controller;
    setFailure(null);
    setBusy(true);
    setMessage(null);
    setMutationKind("publish");
    try {
      const result = await publishQuickVideo(
        videoId,
        {
          ...payload,
          rightsConfirmed: true,
        },
        controller.signal,
      );
      controller.signal.throwIfAborted();
      trackAnalyticsEvent("PUBLISH", {
        ...(identity ? { channelId: identity.channel.id } : {}),
        videoId,
        metadata: { scheduled: result.video.status === "SCHEDULED" },
      });
      setPublished(true);

      if (result.video.status === "SCHEDULED" || visibility === "PRIVATE") {
        setMessage(
          result.video.status === "SCHEDULED"
            ? copy("Video scheduled. Opening your Studio content…")
            : copy("Published privately. Opening your Studio content…"),
        );
        router.push(href("/studio/content"));
        return;
      }

      setMessage(copy("Published. Opening your video…"));
      router.push(href(`/watch/${encodeURIComponent(result.video.slug)}`));
    } catch (error) {
      if (!controller.signal.aborted) {
        if (isRejectedUploadRequest(error)) {
          setFailure({
            title: copy("Video was not published"),
            detail: copy(
              uploadErrorMessage(error) ??
                "Check the title, schedule and advanced metadata before publishing.",
            ),
            action: "edit",
          });
          return;
        }
        setUncertain(true);
        setMessage(
          copy(
            "Publication could not be confirmed. Review this video's status in Studio before publishing again.",
          ),
        );
      }
    } finally {
      setBusy(false);
      setMutationKind(null);
      mutation.current = false;
    }
  }

  function detailsPayload() {
    if (!title.trim() || title.trim().length > 200) throw new Error("Invalid title");
    return {
      title: title.trim(),
      description: description.trim() || null,
      visibility,
      commentsEnabled,
      scheduledPublishAt: scheduleTimestamp(scheduledPublishAt),
      videoForm,
      ...buildMetadataPayload(metadataDraft, {
        includeEmpty: true,
        durationSeconds: inspection?.durationSeconds ?? null,
      }),
    };
  }

  const formatLabel = videoForm === "CLIP" ? copy("AYIN Clip") : copy("Standard video");
  const statusLabel =
    failure || uncertain || phase === "failed"
      ? copy("Needs attention")
      : phase === "paused"
        ? copy("Paused")
        : published
          ? copy("Published")
          : processingReady
            ? copy("Ready")
            : uploadComplete
              ? (processingLabel ?? copy("Processing"))
              : videoId
                ? locale === "ar"
                  ? `تم رفع ${progress}٪`
                  : `${progress}% uploaded`
                : copy("Not started");

  return (
    <section className={styles.shell} aria-label={copy("Creator upload")} dir={direction}>
      <PageHeader
        density="compact"
        className={styles.pageHeader ?? ""}
        title={copy("Upload a video")}
        actions={
          <ActionLink href={href("/studio/content")}>{copy("Manage saved videos")}</ActionLink>
        }
        description={copy(
          "Choose a format and file, review the details, then save or publish your video.",
        )}
      />

      {file || failure || message || uncertain ? (
        <div
          className={`${styles.transferPanel} ${failure || uncertain ? styles.transferProblem : ""}`}
          ref={feedback}
          tabIndex={-1}
          aria-label={copy("Current upload")}
        >
          <div className={styles.transferHeading}>
            <div>
              <small>{copy("Current upload")}</small>
              <strong>{file?.name ?? copy("Upload a video")}</strong>
            </div>
            <span className={styles.transferBadge}>
              {phase === "checking"
                ? copy("Checking file")
                : phase === "preparing"
                  ? copy("Starting upload")
                  : phase === "finalizing"
                    ? copy("Confirming upload")
                    : phase === "retrying"
                      ? copy("Reconnecting")
                      : statusLabel}
            </span>
          </div>
          <ol className={styles.phaseSteps} aria-label={copy("Upload workflow")}>
            <li data-state={uploadComplete ? "complete" : "current"}>
              {uploadComplete ? "✓" : "1"} {copy("Upload")}
            </li>
            <li data-state={processingReady ? "complete" : uploadComplete ? "current" : "pending"}>
              {processingReady ? "✓" : "2"} {copy("Prepare playback")}
            </li>
            <li data-state={published ? "complete" : processingReady ? "current" : "pending"}>
              {published ? "✓" : "3"} {copy("Publish")}
            </li>
          </ol>
          {file && phase !== "checking" && phase !== "preparing" ? (
            <>
              <div
                className={styles.transferTrack}
                role="progressbar"
                aria-label={copy("Upload progress")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <span style={{ width: `${progress}%` }} />
              </div>
              <div className={styles.transferMetrics}>
                <span>
                  {formatFileSize(transferredBytes)} / {formatFileSize(file.size)} · {progress}%
                </span>
                {phase === "uploading" && transferRate ? (
                  <span>
                    {formatFileSize(transferRate)}/s · {copy("About")}{" "}
                    {Math.max(1, Math.ceil((file.size - transferredBytes) / transferRate / 60))}{" "}
                    {copy("min left")}
                  </span>
                ) : null}
                {uploadComplete && !processingReady ? (
                  <span>
                    {processingStageLabel ?? processingLabel ?? copy("Processing")}
                    {processingPercent > 0 ? ` · ${processingPercent}%` : ""}
                  </span>
                ) : null}
              </div>
            </>
          ) : null}
          {failure || uncertain ? (
            <div className={styles.inlineFailure} role="alert">
              <strong>{failure?.title ?? copy("This action needs checking")}</strong>
              <p>{failure?.detail ?? message}</p>
            </div>
          ) : message ? (
            <p className={styles.transferMessage} role="status" aria-live="polite">
              {message}
            </p>
          ) : null}
          <div className={styles.transferActions}>
            {phase === "paused" || failure?.action === "retry" ? (
              <ActionButton type="button" disabled={busy} onClick={() => void retryUpload()}>
                {phase === "paused" ? copy("Continue upload") : copy("Retry this upload")}
              </ActionButton>
            ) : null}
            {mutationKind === "upload" && (phase === "uploading" || phase === "retrying") ? (
              <ActionButton tone="secondary" type="button" onClick={pauseUpload}>
                {copy("Pause upload")}
              </ActionButton>
            ) : null}
            {failure?.action === "choose" ? (
              <ActionButton
                tone="secondary"
                type="button"
                onClick={() => fileInput.current?.click()}
              >
                {copy("Choose another file")}
              </ActionButton>
            ) : null}
            {failure?.action === "signin" ? (
              <>
                <ActionLink href={href("/login")} target="_blank" rel="noopener noreferrer">
                  {copy("Sign in in a new tab")}
                </ActionLink>
                <ActionButton
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (prepared.current) void retryUpload();
                    else {
                      setFailure(null);
                      setUncertain(false);
                      setIdentityFailed(false);
                      setIdentityAttempt((value) => value + 1);
                    }
                  }}
                >
                  {copy("I have signed in — continue")}
                </ActionButton>
              </>
            ) : null}
            {processingCheckNeeded ? (
              <ActionButton
                type="button"
                disabled={busy}
                onClick={() => {
                  setFailure(null);
                  setProcessingCheckNeeded(false);
                  setMessage(copy("Checking processing status…"));
                  setProcessingAttempt((value) => value + 1);
                }}
              >
                {copy("Check processing status")}
              </ActionButton>
            ) : null}
            {videoId || uncertain ? (
              <Link href={href("/studio/content")}>{copy("Review saved uploads in Studio")}</Link>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={styles.workspace}>
        {!videoId ? (
          <section
            className={`${styles.stepCard} ${styles.formatCard}`}
            aria-labelledby="format-heading"
          >
            <div className={styles.stepHeading}>
              <div>
                <span className={styles.stepNumber}>01</span>
                <h2 id="format-heading">{copy("Choose the viewing experience")}</h2>
                <p>
                  {copy(
                    "Pick how this upload should appear across AYIN before selecting the file.",
                  )}
                </p>
              </div>
              <span className={styles.selectionPill}>{formatLabel}</span>
            </div>

            <div
              className={styles.typeGrid}
              role="radiogroup"
              aria-label={copy("Video format")}
              onKeyDown={(event) => {
                if (
                  videoId ||
                  busy ||
                  uncertain ||
                  published ||
                  !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "LONG_FORM"
                    : event.key === "End"
                      ? "CLIP"
                      : videoForm === "CLIP"
                        ? "LONG_FORM"
                        : "CLIP";
                setVideoForm(next);
                event.currentTarget
                  .querySelectorAll<HTMLButtonElement>('[role="radio"]')
                  [next === "CLIP" ? 1 : 0]?.focus();
              }}
            >
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
                  <strong>{copy("Standard video")}</strong>
                  <small>{copy("Full videos, episodes, tutorials and long-form stories.")}</small>
                </span>
                <span className={styles.typeMeta}>{copy("Landscape + flexible")}</span>
                <span className={styles.typeCheck} aria-hidden="true">
                  ✓
                </span>
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
                  <strong>{copy("AYIN Clip")}</strong>
                  <small>{copy("Fast, vertical-first videos built for the Clips feed.")}</small>
                </span>
                <span className={styles.typeMeta}>{copy("Vertical-first")}</span>
                <span className={styles.typeCheck} aria-hidden="true">
                  ✓
                </span>
              </button>
            </div>
          </section>
        ) : null}

        {identityFailed ? (
          <p role="alert">
            {copy("Your creator workspace could not be loaded.")}
            <button
              type="button"
              onClick={() => {
                setIdentityFailed(false);
                setIdentityAttempt((value) => value + 1);
              }}
            >
              {copy("Retry loading workspace")}
            </button>
          </p>
        ) : null}
        {!videoId ? (
          <section
            className={`${styles.stepCard} ${styles.fileCard}`}
            aria-labelledby="file-heading"
          >
            <div className={styles.stepHeading}>
              <div>
                <span className={styles.stepNumber}>02</span>
                <h2 id="file-heading">{copy("Add your video")}</h2>
                <p>{copy("Drag it here on desktop or open your library on mobile.")}</p>
              </div>
              {file ? <span className={styles.selectionPill}>{copy("File selected")}</span> : null}
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
                disabled={
                  !identity ||
                  !capabilities ||
                  !capabilities.storageAvailable ||
                  !capabilities.availableStorageBytes ||
                  busy ||
                  published ||
                  uncertain ||
                  Boolean(videoId)
                }
                ref={fileInput}
                onClick={(event) => {
                  event.currentTarget.value = "";
                }}
                onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)}
              />

              <span className={styles.uploadGlyph} aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3" />
                </svg>
              </span>

              <span className={styles.pickerCopy}>
                <strong>
                  {file
                    ? file.name
                    : dragActive
                      ? copy("Drop your video here")
                      : copy("Select a video to upload")}
                </strong>
                <span>
                  {file
                    ? `${formatFileSize(file.size)} · ${formatLabel}`
                    : identity
                      ? copy("Drag & drop a file here, or browse your device.")
                      : copy("Preparing your creator workspace…")}
                </span>
              </span>

              <span className={styles.browseButton}>
                {busy
                  ? phase === "checking"
                    ? copy("Checking…")
                    : copy("Upload in progress")
                  : file
                    ? copy("Choose another")
                    : copy("Browse video")}
              </span>

              <span className={styles.pickerMeta}>
                {copy("MP4, MOV, MKV, WebM and other common video formats")}
              </span>
            </label>

            {capabilities ? (
              <p className={styles.limitHint}>
                {copy("Maximum file size")}:{" "}
                <strong>{formatFileSize(capabilities.maxFileSizeBytes)}</strong>
                <span>
                  {" "}
                  · {copy("Available storage")}:{" "}
                  {formatFileSize(capabilities.availableStorageBytes)}
                </span>
              </p>
            ) : null}
            {capabilities &&
            (!capabilities.storageAvailable || !capabilities.availableStorageBytes) ? (
              <p className={styles.inlineFailure} role="alert">
                {copy(
                  !capabilities.storageAvailable
                    ? "Video uploads are temporarily unavailable. Please try again later."
                    : "Your channel does not have enough storage for this video. Review saved videos in Studio.",
                )}
              </p>
            ) : null}
            {inspection ? (
              <p className={styles[inspection.status]} role="status">
                {locale === "ar"
                  ? inspection.status === "incompatible"
                    ? "صيغة الفيديو غير مدعومة. اختر ملف فيديو شائعًا."
                    : inspection.status === "compatible"
                      ? "الملف متوافق للمشاهدة؛ سيجري تجهيز النسخة بعد الرفع."
                      : "لا يمكن معاينة الملف محليًا. سيتم فحصه وتجهيزه بعد الرفع."
                  : inspection.message}
              </p>
            ) : null}
          </section>
        ) : null}

        {videoId ? (
          <section
            className={`${styles.stepCard} ${styles.editor}`}
            aria-labelledby="details-heading"
          >
            <div className={styles.stepHeading}>
              <div>
                <span className={styles.stepNumber}>03</span>
                <h2 id="details-heading">{copy("Finish your video")}</h2>
                <p>
                  {copy(
                    "Review the essentials while AYIN completes the upload and playback preparation.",
                  )}
                </p>
              </div>
              <span
                className={`${styles.statusPill} ${processingReady ? styles.statusReady : ""} ${published ? styles.statusPublished : ""}`}
              >
                <span aria-hidden="true" />
                {statusLabel}
              </span>
            </div>

            <fieldset
              className={styles.fields}
              disabled={(busy && mutationKind !== "upload") || published || uncertain}
            >
              <div className={styles.editorTopGrid}>
                <label className={styles.titleField}>
                  <span>{copy("Title")}</span>
                  <input
                    maxLength={200}
                    value={title}
                    placeholder={copy("Give your video a clear title")}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>

                <div className={styles.progressCard}>
                  <div className={styles.progressText}>
                    <span>
                      <small>{copy("Upload status")}</small>
                      <strong>
                        {failure || phase === "failed" || uncertain
                          ? copy("Needs attention")
                          : phase === "paused"
                            ? copy("Paused")
                            : uploadComplete
                              ? processingReady
                                ? copy("Ready to publish")
                                : copy("Upload complete")
                              : copy("Uploading video")}
                      </strong>
                    </span>
                    <strong className={styles.progressValue}>
                      {uploadComplete ? (processingLabel ?? copy("Queued")) : `${progress}%`}
                    </strong>
                  </div>
                  <div className={styles.progressTrack} aria-hidden="true">
                    <span style={{ width: `${Math.max(2, progress)}%` }} />
                  </div>
                  {processingStageLabel ? (
                    <p className={styles.processingStage} aria-live="polite">
                      {copy("Last checked stage")}: {processingStageLabel}
                    </p>
                  ) : null}
                </div>
              </div>

              <details className={styles.advanced}>
                <summary>
                  <span>
                    <strong>{copy("Advanced settings")}</strong>
                    <small>
                      {copy(
                        "Optional metadata, publishing controls and thumbnail · SEO stays automatic",
                      )}
                    </small>
                  </span>
                  <span className={styles.summaryChevron} aria-hidden="true">
                    ⌄
                  </span>
                </summary>
                <div className={styles.advancedGrid}>
                  <label className={styles.fullWidth}>
                    <span>{copy("Description")}</span>
                    <textarea
                      rows={5}
                      maxLength={20_000}
                      value={description}
                      placeholder={copy("Tell viewers what this video is about")}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </label>

                  <VideoMetadataFields
                    fullWidthClassName={styles.fullWidth}
                    value={metadataDraft}
                    onChange={setMetadataDraft}
                  />

                  <label>
                    <span>{copy("Visibility")}</span>
                    <select
                      value={visibility}
                      onChange={(event) => setVisibility(event.target.value as Visibility)}
                    >
                      <option value="PUBLIC">{copy("Public")}</option>
                      <option value="UNLISTED">{copy("Unlisted")}</option>
                      <option value="PRIVATE">{copy("Private")}</option>
                    </select>
                  </label>

                  <label>
                    <span>{copy("Schedule")}</span>
                    <input
                      type="datetime-local"
                      value={scheduledPublishAt}
                      onChange={(event) => setScheduledPublishAt(event.target.value)}
                    />
                  </label>

                  <label className={styles.checkboxRow}>
                    <input
                      type="checkbox"
                      checked={commentsEnabled}
                      onChange={(event) => setCommentsEnabled(event.target.checked)}
                    />
                    <span>{copy("Allow comments")}</span>
                  </label>

                  <div className={styles.fullWidth}>
                    <span className={styles.fieldLabel}>{copy("Thumbnail")}</span>
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
                            disabled={busy}
                            type="button"
                            onClick={() => void chooseCapturedThumbnail(choice)}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={choice.previewUrl}
                              alt={
                                locale === "ar"
                                  ? `معاينة صورة ${choice.id.split("-").at(-1)}`
                                  : `${choice.label} preview`
                              }
                            />
                            <span>
                              {locale === "ar"
                                ? `صورة ${choice.id.split("-").at(-1)}`
                                : choice.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className={styles.hint}>
                        {copy("Thumbnail suggestions appear when they are available.")}
                      </p>
                    )}
                    <label className={styles.customThumbnail}>
                      <span>
                        {selectedThumbnailId === "custom"
                          ? copy("Custom thumbnail saved")
                          : copy("Upload a custom JPG or PNG")}
                      </span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                        disabled={busy}
                        onChange={(event) =>
                          void chooseCustomThumbnail(event.target.files?.[0] ?? null)
                        }
                      />
                    </label>
                  </div>
                </div>
              </details>
            </fieldset>
            <div className={styles.publishDock}>
              <p className={styles.publishConsent}>
                {copy(
                  "By publishing, you confirm that you own this video or have all rights and permissions required to publish it on AYIN.",
                )}
              </p>

              {!uploadComplete ? (
                <p className={styles.hint}>
                  {copy(
                    "You can edit the details while the video uploads. Save or publish after upload finishes.",
                  )}
                </p>
              ) : !processingReady ? (
                <p className={styles.hint}>
                  {copy(
                    "Your file is uploaded. Publishing becomes available when playback is ready.",
                  )}
                </p>
              ) : null}
              <ActionButton
                className={styles.actionLayout}
                tone="secondary"
                type="button"
                disabled={busy || published || uncertain || signature === savedSignature}
                onClick={() => void saveDetails()}
              >
                {copy("Save details")}
              </ActionButton>
              <ActionButton
                className={styles.actionLayout}
                type="button"
                disabled={
                  !uploadComplete ||
                  !processingReady ||
                  !title.trim() ||
                  busy ||
                  published ||
                  uncertain
                }
                onClick={() => void publish()}
              >
                <span>
                  {published
                    ? copy("Published")
                    : mutationKind === "publish"
                      ? copy("Publishing…")
                      : copy("Publish video")}
                </span>
                {!published ? <span aria-hidden="true">→</span> : null}
              </ActionButton>
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
