import { AccountScopeError, requestAccountScope, type AccountScopeOptions } from "./account-scope";
import { parseAccountIdentity } from "./account-identity-response";

export const CAPTION_MAX_BYTES = 2 * 1024 * 1024;
export type StudioCaptionTrack = {
  id: string;
  videoId: string;
  languageCode: string;
  label: string;
  kind: "CAPTIONS" | "SUBTITLES";
  default: boolean;
  enabled: boolean;
  status: "READY" | "PENDING";
  sizeBytes: number | null;
  replacing: boolean;
  createdAt: string;
  updatedAt: string;
};
export type CaptionOptions = Pick<AccountScopeOptions, "expectedAccountId" | "signal">;
const invalid = () => new AccountScopeError(0, "INVALID_RESPONSE");
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, min = 1): string {
  if (typeof value !== "string" || value.length > max || value.trim().length < min) throw invalid();
  return value;
}
function id(value: unknown): string {
  const result = text(value, 36);
  if (!uuid.test(result)) throw invalid();
  return result;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw invalid();
  return value;
}
function date(value: unknown): string {
  const result = text(value, 40);
  if (!/^\d{4}-\d\d-\d\dT/.test(result) || !Number.isFinite(Date.parse(result))) throw invalid();
  return result;
}
function language(value: unknown): string {
  const result = text(value, 35);
  try {
    if (Intl.getCanonicalLocales(result)[0] !== result) throw invalid();
  } catch {
    throw invalid();
  }
  return result;
}
function kind(value: unknown): StudioCaptionTrack["kind"] {
  if (value !== "CAPTIONS" && value !== "SUBTITLES") throw invalid();
  return value;
}
function metadata(value: unknown) {
  const row = object(value);
  const result = {
    id: id(row.id),
    languageCode: language(row.languageCode),
    label: text(row.label, 80),
    kind: kind(row.kind),
    default: bool(row.default),
    enabled: bool(row.enabled),
  };
  if (result.default && !result.enabled) throw invalid();
  return result;
}
export function parseStudioCaptions(
  value: unknown,
  videoId: string,
): { tracks: StudioCaptionTrack[] } {
  const rows = object(value).tracks;
  if (!Array.isArray(rows) || rows.length > 1000) throw invalid();
  const tracks = rows.map((value): StudioCaptionTrack => {
    const row = object(value),
      base = metadata(row);
    if (id(row.videoId) !== videoId || (row.status !== "READY" && row.status !== "PENDING"))
      throw invalid();
    if (
      row.sizeBytes !== null &&
      (typeof row.sizeBytes !== "number" ||
        !Number.isSafeInteger(row.sizeBytes) ||
        row.sizeBytes < 1 ||
        row.sizeBytes > CAPTION_MAX_BYTES)
    )
      throw invalid();
    if (row.status === "READY" && row.sizeBytes === null) throw invalid();
    return {
      ...base,
      videoId,
      status: row.status,
      sizeBytes: row.sizeBytes as number | null,
      replacing: bool(row.replacing),
      createdAt: date(row.createdAt),
      updatedAt: date(row.updatedAt),
    };
  });
  if (
    new Set(tracks.map((row) => row.id)).size !== tracks.length ||
    new Set(tracks.map((row) => `${row.languageCode}:${row.kind}`)).size !== tracks.length ||
    tracks.filter((row) => row.default).length > 1
  )
    throw invalid();
  return { tracks };
}
export function parseCaptionPrepared(value: unknown, trackId?: string) {
  const row = object(value),
    result = {
      trackId: id(row.trackId),
      uploadUrl: text(row.uploadUrl, 8192),
      expiresAt: date(row.expiresAt),
      contentType: "text/vtt" as const,
      maxBytes: CAPTION_MAX_BYTES,
    };
  const url = new URL(result.uploadUrl);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))
  )
    throw invalid();
  if (
    url.username ||
    url.password ||
    url.hash ||
    row.contentType !== "text/vtt" ||
    row.maxBytes !== CAPTION_MAX_BYTES ||
    (trackId && trackId !== result.trackId) ||
    Date.parse(result.expiresAt) <= Date.now()
  )
    throw invalid();
  return result;
}
export function parseCaptionFinalized(value: unknown, trackId: string) {
  const row = object(value);
  if (
    id(row.trackId) !== trackId ||
    row.status !== "READY" ||
    typeof row.cueCount !== "number" ||
    !Number.isSafeInteger(row.cueCount) ||
    row.cueCount < 1
  )
    throw invalid();
  return { trackId, status: "READY" as const, cueCount: row.cueCount };
}
export function parseCaptionUpdated(value: unknown, trackId: string, patch: CaptionPatch) {
  const row = metadata(value);
  if (
    row.id !== trackId ||
    Object.entries(patch).some(([key, value]) => row[key as keyof typeof row] !== value)
  )
    throw invalid();
  return row;
}
export function parseCaptionRemoved(value: unknown, trackId: string) {
  const row = object(value);
  if (row.removed !== true || id(row.trackId) !== trackId) throw invalid();
  return { removed: true as const, trackId };
}
const path = (videoId: string, trackId?: string) =>
  `/creator/studio/videos/${encodeURIComponent(videoId)}/captions${trackId ? `/${encodeURIComponent(trackId)}` : ""}`;
const options = (value: CaptionOptions) => ({ ...value, maxResponseBytes: 512 * 1024 });
export async function getStudioCaptions(videoId: string, scope: CaptionOptions = {}) {
  const result = await requestAccountScope(
    path(videoId),
    "GET",
    (value) => parseStudioCaptions(value, videoId),
    options(scope),
  );
  return { ...result.value, accountId: result.accountId };
}
export type CaptionUploadInput = {
  fileName: string;
  sizeBytes: number;
  mimeType: "text/vtt";
  languageCode: string;
  label: string;
  kind: StudioCaptionTrack["kind"];
  default: boolean;
};
// Preparation and direct storage receipt are intermediate outcomes, never READY.
// Retain only the validated target identity on errors, not a presigned storage URL.
export class CaptionUploadStageError extends AccountScopeError {
  constructor(
    cause: AccountScopeError,
    readonly stage: "PREPARED" | "UPLOADED",
    readonly trackId?: string,
  ) {
    super(
      cause.status,
      cause.code,
      cause.writeStarted,
      cause.acknowledged,
      cause.identityUnverified,
    );
  }
}
async function prepareCaption(
  pathname: string,
  input: Record<string, unknown>,
  scope: CaptionOptions,
  trackId?: string,
) {
  let prepared: ReturnType<typeof parseCaptionPrepared> | undefined;
  try {
    return (
      await requestAccountScope(
        pathname,
        "POST",
        (value) => {
          prepared = parseCaptionPrepared(value, trackId);
          return prepared;
        },
        options(scope),
        input,
      )
    ).value;
  } catch (cause) {
    if (cause instanceof AccountScopeError && cause.acknowledged && prepared)
      throw new CaptionUploadStageError(cause, "PREPARED", prepared.trackId);
    throw cause;
  }
}
export async function prepareStudioCaptionUpload(
  videoId: string,
  input: CaptionUploadInput,
  scope: CaptionOptions = {},
) {
  return prepareCaption(path(videoId) + "/uploads", input, scope);
}
export async function prepareStudioCaptionReplacement(
  videoId: string,
  trackId: string,
  file: File,
  scope: CaptionOptions = {},
) {
  return prepareCaption(
    path(videoId, trackId) + "/uploads",
    { fileName: file.name, sizeBytes: file.size, mimeType: "text/vtt" },
    scope,
    trackId,
  );
}
export async function verifyCaptionAccount(scope: CaptionOptions) {
  return requestAccountScope("/auth/me", "GET", parseAccountIdentity, options(scope));
}
export async function putCaptionFile(
  uploadUrl: string,
  file: File,
  scope: CaptionOptions = {},
): Promise<void> {
  if (scope.expectedAccountId) {
    try {
      await verifyCaptionAccount(scope);
    } catch (cause) {
      if (cause instanceof AccountScopeError) throw new CaptionUploadStageError(cause, "PREPARED");
      throw cause;
    }
  }
  scope.signal?.throwIfAborted();
  const signal = scope.signal
    ? AbortSignal.any([scope.signal, AbortSignal.timeout(30_000)])
    : AbortSignal.timeout(30_000);
  const response = await fetch(uploadUrl, {
    method: "PUT",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal,
    headers: { "content-type": "text/vtt" },
    body: file,
  });
  if (!response.ok)
    throw new AccountScopeError(response.status, "CAPTION_UPLOAD_UNCONFIRMED", true);
  if (scope.expectedAccountId) {
    try {
      await verifyCaptionAccount(scope);
    } catch (cause) {
      if (cause instanceof AccountScopeError) throw new CaptionUploadStageError(cause, "UPLOADED");
      throw cause;
    }
  }
}
export async function finalizeStudioCaptionUpload(
  videoId: string,
  trackId: string,
  scope: CaptionOptions = {},
) {
  return (
    await requestAccountScope(
      path(videoId, trackId) + "/finalize",
      "POST",
      (value) => parseCaptionFinalized(value, trackId),
      options(scope),
      {},
    )
  ).value;
}
export type CaptionPatch = Partial<
  Pick<StudioCaptionTrack, "languageCode" | "label" | "kind" | "enabled" | "default">
>;
export async function updateStudioCaption(
  videoId: string,
  trackId: string,
  patch: CaptionPatch,
  scope: CaptionOptions = {},
) {
  return (
    await requestAccountScope(
      path(videoId, trackId),
      "PATCH",
      (value) => parseCaptionUpdated(value, trackId, patch),
      options(scope),
      patch,
    )
  ).value;
}
export async function removeStudioCaption(
  videoId: string,
  trackId: string,
  scope: CaptionOptions = {},
) {
  return (
    await requestAccountScope(
      path(videoId, trackId),
      "DELETE",
      (value) => parseCaptionRemoved(value, trackId),
      options(scope),
      {},
    )
  ).value;
}
export function validateCaptionFile(file: File): "fileType" | "fileSize" | null {
  if (!file.name.toLowerCase().endsWith(".vtt")) return "fileType";
  if (file.size < 1 || file.size > CAPTION_MAX_BYTES) return "fileSize";
  return null;
}
