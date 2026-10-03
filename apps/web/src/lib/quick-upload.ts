import { apiBaseUrl, readApiError } from "@/lib/api";
import type { UploadSession } from "@/lib/direct-video-upload";
import { videoMimeTypeForUpload } from "@/lib/video-inspection";
import { uploadBlob } from "./direct-video-upload";
import {
  matchingVideo,
  parseQuickConfirmation,
  parseQuickDraft,
  parseQuickProcessing,
  parseQuickPublication,
  uploadId,
  uploadRecord,
} from "./quick-upload-contract";
import { parseUploadCompletion, parseUploadSession, UploadProtocolError } from "./upload-session";

export type VideoForm = "LONG_FORM" | "CLIP";
export type VideoContentType = "CREATOR_VIDEO" | "MOVIE" | "DOCUMENTARY";
export type VideoCategory =
  | "ENTERTAINMENT"
  | "EDUCATION"
  | "GAMING"
  | "MUSIC"
  | "NEWS"
  | "SPORTS"
  | "TECHNOLOGY"
  | "LIFESTYLE"
  | "FILM_ANIMATION"
  | "OTHER";
export type RightsBasis = "OWNED" | "LICENSED" | "AUTHORIZED" | "PUBLIC_DOMAIN" | "OTHER";

export interface VideoChapterInput {
  title: string;
  startSeconds: number;
}

export interface QuickVideoMetadata {
  tags?: string[];
  category?: VideoCategory | null;
  primaryLanguage?: string | null;
  recordingDate?: string | null;
  contentType?: VideoContentType;
  rightsBasis?: RightsBasis;
  rightsNote?: string | null;
  rightsExpiresAt?: string | null;
  seriesTitle?: string | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  maturityLevel?: "GENERAL" | "TEEN" | "MATURE" | null;
  ageRestriction?: "NONE" | "AGE_13_PLUS" | "AGE_18_PLUS" | null;
  allowedTerritories?: string[];
  blockedTerritories?: string[];
  geoAvailabilityMode?: "WORLDWIDE" | "INCLUDE_ONLY" | "EXCLUDE" | null;
  geoCountries?: string[];
  chapters?: VideoChapterInput[] | null;
  adBreakPreference?: "AUTOMATIC" | "DISABLED" | "CUSTOM" | null;
  adBreakOffsetsSeconds?: number[];
}

export interface QuickDraftResponse {
  video: {
    id: string;
    channelId: string;
    title: string;
    status: "UPLOADING";
    visibility: "PUBLIC" | "UNLISTED" | "PRIVATE";
    commentsEnabled: boolean;
    durationMs: number | null;
    videoForm: VideoForm;
  };
  uploadSession: UploadSession;
}

export interface QuickProcessingStatus {
  videoId: string;
  ready: boolean;
  videoStatus: string;
  processing: null | {
    generation: number;
    status:
      | "INGESTING"
      | "QUEUED"
      | "PROCESSING"
      | "UPLOADING"
      | "VERIFYING"
      | "READY"
      | "FAILED"
      | "CANCELLED";
    stage: string | null;
    progressPercent: number;
    errorCode: string | null;
    errorMessage: string | null;
    attempt: number;
    completedAt: string | null;
  };
}

export interface QuickVideoDetails extends QuickVideoMetadata {
  title?: string;
  description?: string | null;
  visibility?: "PUBLIC" | "UNLISTED" | "PRIVATE";
  commentsEnabled?: boolean;
  scheduledPublishAt?: string | null;
  videoForm?: VideoForm;
}

export async function createQuickDraft(input: {
  channelId: string;
  title: string;
  file: File;
  durationMs: number | null;
  videoForm?: VideoForm;
  signal?: AbortSignal;
}): Promise<QuickDraftResponse> {
  return parseQuickDraft(
    await apiJson<unknown>(
      "/creator/videos/drafts",
      "POST",
      {
        channelId: input.channelId,
        title: input.title,
        sizeBytes: input.file.size,
        mimeType: videoMimeTypeForUpload(input.file),
        durationMs: input.durationMs,
        videoForm: input.videoForm ?? "LONG_FORM",
      },
      input.signal,
    ),
    input.channelId,
    input.file.size,
  );
}

export async function confirmQuickUpload(
  videoId: string,
  signal?: AbortSignal,
): Promise<{ status: string }> {
  return parseQuickConfirmation(
    await apiJson(`/creator/videos/${videoId}/upload-complete`, "POST", {}, signal),
    videoId,
  );
}

export async function getQuickProcessingStatus(
  videoId: string,
  signal?: AbortSignal,
): Promise<QuickProcessingStatus> {
  return parseQuickProcessing(
    await requestJson(`/creator/videos/${videoId}/processing`, { method: "GET" }, signal),
    videoId,
  );
}

export async function saveQuickVideoDetails(
  videoId: string,
  details: QuickVideoDetails,
  signal?: AbortSignal,
): Promise<void> {
  const row = matchingVideo(
    await apiJson(`/creator/videos/${videoId}`, "PATCH", details, signal),
    videoId,
  );
  if (
    typeof row.title !== "string" ||
    !row.title.trim() ||
    row.title.length > 200 ||
    !["PUBLIC", "UNLISTED", "PRIVATE"].includes(String(row.visibility)) ||
    typeof row.commentsEnabled !== "boolean"
  )
    throw new UploadProtocolError();
}

export async function publishQuickVideo(
  videoId: string,
  details: QuickVideoDetails & { rightsConfirmed: boolean },
  signal?: AbortSignal,
): Promise<{ video: { status: "PUBLISHED" | "SCHEDULED"; slug: string } }> {
  return parseQuickPublication(
    await apiJson(`/creator/videos/${videoId}/publish`, "POST", details, signal),
    videoId,
  );
}

export async function uploadQuickThumbnail(
  videoId: string,
  image: Blob,
  signal?: AbortSignal,
): Promise<string> {
  if (
    !["image/png", "image/jpeg"].includes(image.type) ||
    image.size < 1 ||
    image.size > 5 * 1024 * 1024
  )
    throw new Error("Choose a JPG or PNG thumbnail up to 5 MB.");
  const mimeType = image.type;
  const authorization = uploadRecord(
    await apiJson<unknown>(
      `/creator/videos/${videoId}/thumbnail/authorize`,
      "POST",
      {
        mimeType,
        sizeBytes: image.size,
      },
      signal,
    ),
  );
  const assetId = uploadId(authorization.assetId);
  const upload = uploadRecord(authorization.upload);
  const session = parseUploadSession(
    { assetId, sessionToken: "thumbnail", mode: "single", upload: { ...upload, method: "PUT" } },
    image.size,
  );
  if (session.mode !== "single") throw new UploadProtocolError();
  await uploadBlob(session.upload.url, image, session.upload.headers, () => {}, signal);
  parseUploadCompletion(
    await apiJson(`/creator/videos/${videoId}/thumbnail/complete`, "POST", { assetId }, signal),
    assetId,
  );
  return assetId;
}

async function apiJson<T = unknown>(
  path: string,
  method: "POST" | "PATCH",
  payload: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return (await requestJson(
    path,
    {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
    signal,
  )) as T;
}

async function requestJson(
  path: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<unknown> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Upload response timed out", "TimeoutError")),
    30000,
  );
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await readApiError(response));
    try {
      return await response.json();
    } catch {
      throw new UploadProtocolError();
    }
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}
