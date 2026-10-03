import type { QuickDraftResponse, QuickProcessingStatus, VideoForm } from "./quick-upload";
import { parseUploadSession, UploadProtocolError } from "./upload-session";

export function uploadRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new UploadProtocolError();
  return value as Record<string, unknown>;
}
export function uploadId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))
    throw new UploadProtocolError();
  return value;
}
export function matchingVideo(value: unknown, id: string) {
  const row = uploadRecord(value);
  if (uploadId(row.id ?? row.videoId) !== id) throw new UploadProtocolError();
  return row;
}
export function parseQuickDraft(
  value: unknown,
  channelId: string,
  size: number,
): QuickDraftResponse {
  const row = uploadRecord(value),
    video = uploadRecord(row.video);
  const id = uploadId(video.id);
  if (
    uploadId(video.channelId) !== channelId ||
    video.status !== "UPLOADING" ||
    typeof video.title !== "string" ||
    !video.title.trim() ||
    video.title.length > 200 ||
    !["PUBLIC", "UNLISTED", "PRIVATE"].includes(String(video.visibility)) ||
    typeof video.commentsEnabled !== "boolean" ||
    !["LONG_FORM", "CLIP"].includes(String(video.videoForm)) ||
    !(
      video.durationMs === null ||
      (typeof video.durationMs === "number" &&
        Number.isSafeInteger(video.durationMs) &&
        video.durationMs > 0)
    )
  )
    throw new UploadProtocolError();
  return {
    video: {
      id,
      channelId,
      title: video.title,
      status: "UPLOADING",
      visibility: video.visibility as QuickDraftResponse["video"]["visibility"],
      commentsEnabled: video.commentsEnabled,
      durationMs: video.durationMs as number | null,
      videoForm: video.videoForm as VideoForm,
    },
    uploadSession: parseUploadSession(row.uploadSession, size),
  };
}
const videoStatuses = ["UPLOADING", "VALIDATING", "DRAFT", "PUBLISHED", "SCHEDULED", "REMOVED"];
export function parseQuickConfirmation(value: unknown, id: string) {
  const row = matchingVideo(value, id);
  if (!videoStatuses.includes(String(row.status))) throw new UploadProtocolError();
  return { videoId: id, status: row.status as string };
}
export function parseQuickProcessing(value: unknown, id: string): QuickProcessingStatus {
  const row = matchingVideo(value, id);
  if (typeof row.ready !== "boolean" || !videoStatuses.includes(String(row.videoStatus)))
    throw new UploadProtocolError();
  let processing: QuickProcessingStatus["processing"] = null;
  if (row.processing !== null) {
    const p = uploadRecord(row.processing);
    if (
      ![
        "INGESTING",
        "QUEUED",
        "PROCESSING",
        "UPLOADING",
        "VERIFYING",
        "READY",
        "FAILED",
        "CANCELLED",
      ].includes(String(p.status)) ||
      typeof p.progressPercent !== "number" ||
      !Number.isFinite(p.progressPercent) ||
      p.progressPercent < 0 ||
      p.progressPercent > 100 ||
      typeof p.generation !== "number" ||
      !Number.isSafeInteger(p.generation) ||
      p.generation < 1 ||
      typeof p.attempt !== "number" ||
      !Number.isSafeInteger(p.attempt) ||
      p.attempt < 0
    )
      throw new UploadProtocolError();
    const optionalText = (value: unknown, max: number): string | null => {
      if (value === null) return null;
      if (typeof value !== "string" || value.length > max) throw new UploadProtocolError();
      return value;
    };
    processing = {
      generation: p.generation,
      status: p.status as NonNullable<QuickProcessingStatus["processing"]>["status"],
      stage: optionalText(p.stage, 100),
      progressPercent: p.progressPercent,
      errorCode: optionalText(p.errorCode, 100),
      errorMessage: optionalText(p.errorMessage, 4000),
      attempt: p.attempt,
      completedAt: optionalText(p.completedAt, 100),
    };
  }
  return { videoId: id, ready: row.ready, videoStatus: row.videoStatus as string, processing };
}
export function parseQuickPublication(value: unknown, id: string) {
  const row = uploadRecord(value),
    video = matchingVideo(row.video, id);
  if (
    !["PUBLISHED", "SCHEDULED"].includes(String(video.status)) ||
    typeof video.slug !== "string" ||
    !video.slug.trim() ||
    video.slug.length > 250 ||
    /[\r\n/?#]/.test(video.slug)
  )
    throw new UploadProtocolError();
  return { video: { id, status: video.status as "PUBLISHED" | "SCHEDULED", slug: video.slug } };
}
export function scheduleTimestamp(value: string, now = Date.now()): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Choose a valid future publishing time.");
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getTime() <= now ||
    date.getFullYear() !== Number(value.slice(0, 4)) ||
    date.getMonth() + 1 !== Number(value.slice(5, 7)) ||
    date.getDate() !== Number(value.slice(8, 10)) ||
    date.getHours() !== Number(value.slice(11, 13)) ||
    date.getMinutes() !== Number(value.slice(14, 16))
  )
    throw new Error("Choose a valid future publishing time.");
  return date.toISOString();
}
