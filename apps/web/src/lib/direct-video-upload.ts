import { apiBaseUrl, readApiError } from "@/lib/api";
import { videoMimeTypeForUpload } from "@/lib/video-inspection";
import {
  parseUploadCompletion,
  parseUploadPartUrl,
  parseUploadSession,
  parseResumedParts,
  UploadProtocolError,
  validateUploadUrl,
} from "./upload-session";

const MAX_PART_ATTEMPTS = 4;
const STALL_TIMEOUT_MS = 45_000;
const STALL_CHECK_INTERVAL_MS = 5_000;

export interface MultipartUploadSession {
  assetId: string;
  mode: "multipart";
  sessionToken: string;
  partSizeBytes: number;
  partCount: number;
}

export interface SingleUploadSession {
  assetId: string;
  mode: "single";
  sessionToken: string;
  upload: { url: string; method: "PUT"; headers: Record<string, string> };
}

export type UploadSession = MultipartUploadSession | SingleUploadSession;

export interface DirectUploadResult {
  assetId: string;
  status: "UPLOADED";
}

export interface DirectUploadStatus {
  phase: "uploading" | "retrying" | "finalizing";
  message: string;
  partNumber?: number;
  partCount?: number;
  attempt?: number;
}

interface UploadBlobErrorOptions {
  retryable: boolean;
  status?: number;
}

class UploadBlobError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(message: string, options: UploadBlobErrorOptions) {
    super(message);
    this.name = "UploadBlobError";
    this.retryable = options.retryable;
    this.status = options.status ?? null;
  }
}

export async function uploadVideoDirectly(input: {
  channelId: string;
  file: File;
  onProgress: (percent: number) => void;
  onStatus?: (status: DirectUploadStatus) => void;
  signal?: AbortSignal;
}): Promise<DirectUploadResult> {
  const session = await createSession(input.channelId, input.file, input.signal);
  return uploadPreparedVideoDirectly({
    session,
    file: input.file,
    onProgress: input.onProgress,
    ...(input.onStatus ? { onStatus: input.onStatus } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

export async function uploadPreparedVideoDirectly(input: {
  session: UploadSession;
  file: File;
  onProgress: (percent: number) => void;
  onStatus?: (status: DirectUploadStatus) => void;
  signal?: AbortSignal;
}): Promise<DirectUploadResult> {
  const { file, onProgress, onStatus, signal } = input;
  signal?.throwIfAborted();
  const session = parseUploadSession(input.session, file.size);
  let highestReportedPercent = 0;
  const reportProgress = (loadedBytes: number) => {
    const next = Math.min(99, Math.round((loadedBytes / file.size) * 100));
    if (next <= highestReportedPercent) return;
    highestReportedPercent = next;
    onProgress(highestReportedPercent);
  };

  if (session.mode === "single") {
    onStatus?.({ phase: "uploading", message: "Uploading video…" });
    await retryPart(
      async () =>
        uploadBlob(
          session.upload.url,
          file,
          session.upload.headers,
          (loaded) => {
            reportProgress(loaded);
          },
          signal,
        ),
      (attempt) =>
        onStatus?.({
          phase: "retrying",
          message: "Connection paused. Retrying the upload safely…",
          attempt,
        }),
      signal,
    );
    reportProgress(file.size);
    onStatus?.({ phase: "finalizing", message: "Finalizing upload…" });
    const completed = parseUploadCompletion(
      await apiJson<unknown>(
        "/media/uploads/sessions/complete",
        {
          sessionToken: session.sessionToken,
          parts: [],
        },
        signal,
      ),
      session.assetId,
    );
    onProgress(100);
    return completed;
  }

  const resumed = parseResumedParts(
    await apiJson<unknown>(
      "/media/uploads/sessions/resume",
      { sessionToken: session.sessionToken },
      signal,
    ),
    session,
    file.size,
  );
  const completedParts = new Map(
    resumed.map((part) => [part.partNumber, { partNumber: part.partNumber, etag: part.etag }]),
  );
  let completedBytes = resumed.reduce((total, part) => total + part.sizeBytes, 0);
  reportProgress(completedBytes);

  for (let partNumber = 1; partNumber <= session.partCount; partNumber += 1) {
    signal?.throwIfAborted();
    if (completedParts.has(partNumber)) continue;

    const start = (partNumber - 1) * session.partSizeBytes;
    const end = Math.min(file.size, start + session.partSizeBytes);
    const blob = file.slice(start, end);
    onStatus?.({
      phase: "uploading",
      message: `Uploading video · part ${partNumber} of ${session.partCount}`,
      partNumber,
      partCount: session.partCount,
    });

    const etag = await retryPart(
      async () => {
        // Refresh the presigned URL for every attempt. This avoids retrying with
        // an authorization that may have expired during a long network stall.
        const authorization = await apiJson<unknown>(
          "/media/uploads/sessions/authorize-part",
          {
            sessionToken: session.sessionToken,
            partNumber,
          },
          signal,
        );
        return uploadBlob(
          parseUploadPartUrl(authorization),
          blob,
          {},
          (loaded) => {
            reportProgress(completedBytes + loaded);
          },
          signal,
        );
      },
      (attempt) =>
        onStatus?.({
          phase: "retrying",
          message: `Connection paused. Retrying part ${partNumber} of ${session.partCount} safely…`,
          partNumber,
          partCount: session.partCount,
          attempt,
        }),
      signal,
    );

    if (!etag) {
      throw new Error("One upload part could not be verified. Please retry the upload.");
    }
    completedParts.set(partNumber, { partNumber, etag });
    completedBytes += blob.size;
    reportProgress(completedBytes);
  }

  onStatus?.({ phase: "finalizing", message: "Finalizing upload…" });
  const completed = parseUploadCompletion(
    await apiJson<unknown>(
      "/media/uploads/sessions/complete",
      {
        sessionToken: session.sessionToken,
        parts: [...completedParts.values()].sort(
          (left, right) => left.partNumber - right.partNumber,
        ),
      },
      signal,
    ),
    session.assetId,
  );
  onProgress(100);
  return completed;
}

async function createSession(
  channelId: string,
  file: File,
  signal?: AbortSignal,
): Promise<UploadSession> {
  return parseUploadSession(
    await apiJson<unknown>(
      "/media/uploads/sessions",
      {
        channelId,
        sizeBytes: file.size,
        mimeType: videoMimeTypeForUpload(file),
      },
      signal,
    ),
    file.size,
  );
}

async function apiJson<T>(path: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  const deadline = setTimeout(
    () => controller.abort(new DOMException("Upload response timed out", "TimeoutError")),
    30000,
  );
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new UploadBlobError(await readApiError(response), {
        retryable: [408, 425, 429].includes(response.status) || response.status >= 500,
        status: response.status,
      });
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new UploadProtocolError();
    }
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener("abort", cancel);
  }
}

export function uploadBlob(
  url: string,
  blob: Blob,
  headers: Record<string, string>,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<string | null> {
  validateUploadUrl(url);
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    let settled = false;
    let lastProgressAt = Date.now();
    let stalled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearInterval(stallTimer);
      signal?.removeEventListener("abort", cancel);
      callback();
    };

    const stallTimer = window.setInterval(() => {
      if (settled || Date.now() - lastProgressAt < STALL_TIMEOUT_MS) return;
      stalled = true;
      request.abort();
    }, STALL_CHECK_INTERVAL_MS);

    const cancel = () => request.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    request.upload.onprogress = (event) => {
      lastProgressAt = Date.now();
      if (event.lengthComputable) onProgress(event.loaded);
    };
    request.onerror = () =>
      finish(() =>
        reject(
          signal?.aborted
            ? signal.reason
            : new UploadBlobError("The network interrupted this upload part.", { retryable: true }),
        ),
      );
    request.onabort = () =>
      finish(() =>
        reject(
          signal?.aborted
            ? signal.reason
            : new UploadBlobError(
                stalled
                  ? "This upload part stopped making progress. AYIN will retry it automatically."
                  : "The upload was interrupted.",
                { retryable: true },
              ),
        ),
      );
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        finish(() => resolve(request.getResponseHeader("etag")));
        return;
      }
      const retryable =
        request.status === 0 ||
        request.status === 408 ||
        request.status === 425 ||
        request.status === 429 ||
        request.status >= 500;
      finish(() =>
        reject(
          new UploadBlobError(
            retryable
              ? "AYIN could not save this upload part yet. It will retry automatically."
              : "This upload part was rejected. Please choose the file again.",
            { retryable, status: request.status },
          ),
        ),
      );
    };
    try {
      request.open("PUT", url);
      request.withCredentials = false;
      for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
      request.send(blob);
    } catch {
      finish(() =>
        reject(
          new UploadBlobError("This upload request could not be prepared.", { retryable: false }),
        ),
      );
    }
  });
}

async function retryPart<T>(
  operation: (attempt: number) => Promise<T>,
  onRetry?: (nextAttempt: number, error: unknown) => void,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_PART_ATTEMPTS; attempt += 1) {
    signal?.throwIfAborted();
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      signal?.throwIfAborted();
      const retryable =
        !(error instanceof UploadProtocolError) &&
        (!(error instanceof UploadBlobError) || error.retryable);
      if (!retryable || attempt >= MAX_PART_ATTEMPTS) break;
      const nextAttempt = attempt + 1;
      onRetry?.(nextAttempt, error);
      const backoffMs = Math.min(4_000, 500 * 2 ** (attempt - 1));
      const jitterMs = Math.floor(Math.random() * 300);
      await new Promise<void>((resolve, reject) => {
        const cancel = () => {
          window.clearTimeout(timer);
          signal?.removeEventListener("abort", cancel);
          reject(signal?.reason);
        };
        const timer = window.setTimeout(() => {
          signal?.removeEventListener("abort", cancel);
          resolve();
        }, backoffMs + jitterMs);
        signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) cancel();
      });
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Upload part failed after retries.");
}
