import { apiBaseUrl, readApiError } from "@/lib/api";
import { videoMimeTypeForUpload } from "@/lib/video-inspection";

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
}): Promise<DirectUploadResult> {
  const session = await createSession(input.channelId, input.file);
  return uploadPreparedVideoDirectly({
    session,
    file: input.file,
    onProgress: input.onProgress,
    onStatus: input.onStatus,
  });
}

export async function uploadPreparedVideoDirectly(input: {
  session: UploadSession;
  file: File;
  onProgress: (percent: number) => void;
  onStatus?: (status: DirectUploadStatus) => void;
}): Promise<DirectUploadResult> {
  const { session, file, onProgress, onStatus } = input;
  let highestReportedPercent = 0;
  const reportProgress = (loadedBytes: number) => {
    const next = Math.min(99, Math.round((loadedBytes / file.size) * 100));
    highestReportedPercent = Math.max(highestReportedPercent, next);
    onProgress(highestReportedPercent);
  };

  if (session.mode === "single") {
    onStatus?.({ phase: "uploading", message: "Uploading video…" });
    await retryPart(
      async () =>
        uploadBlob(session.upload.url, file, session.upload.headers, (loaded) => {
          reportProgress(loaded);
        }),
      (attempt) =>
        onStatus?.({
          phase: "retrying",
          message: "Connection paused. Retrying the upload safely…",
          attempt,
        }),
    );
    onStatus?.({ phase: "finalizing", message: "Finalizing upload…" });
    const completed = await apiJson<DirectUploadResult>("/media/uploads/sessions/complete", {
      sessionToken: session.sessionToken,
      parts: [],
    });
    onProgress(100);
    return completed;
  }

  const resumed = await apiJson<{
    parts: Array<{ partNumber: number; etag: string; sizeBytes: number }>;
  }>("/media/uploads/sessions/resume", { sessionToken: session.sessionToken });
  const completedParts = new Map(
    resumed.parts.map((part) => [
      part.partNumber,
      { partNumber: part.partNumber, etag: part.etag },
    ]),
  );
  let completedBytes = resumed.parts.reduce((total, part) => total + part.sizeBytes, 0);
  reportProgress(completedBytes);

  for (let partNumber = 1; partNumber <= session.partCount; partNumber += 1) {
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
        const authorization = await apiJson<{ url: string }>(
          "/media/uploads/sessions/authorize-part",
          {
            sessionToken: session.sessionToken,
            partNumber,
          },
        );
        return uploadBlob(authorization.url, blob, {}, (loaded) => {
          reportProgress(completedBytes + loaded);
        });
      },
      (attempt) =>
        onStatus?.({
          phase: "retrying",
          message: `Connection paused. Retrying part ${partNumber} of ${session.partCount} safely…`,
          partNumber,
          partCount: session.partCount,
          attempt,
        }),
    );

    if (!etag) {
      throw new Error("One upload part could not be verified. Please retry the upload.");
    }
    completedParts.set(partNumber, { partNumber, etag });
    completedBytes += blob.size;
    reportProgress(completedBytes);
  }

  onStatus?.({ phase: "finalizing", message: "Finalizing upload…" });
  const completed = await apiJson<DirectUploadResult>("/media/uploads/sessions/complete", {
    sessionToken: session.sessionToken,
    parts: [...completedParts.values()].sort((left, right) => left.partNumber - right.partNumber),
  });
  onProgress(100);
  return completed;
}

async function createSession(channelId: string, file: File): Promise<UploadSession> {
  return apiJson<UploadSession>("/media/uploads/sessions", {
    channelId,
    sizeBytes: file.size,
    mimeType: videoMimeTypeForUpload(file),
  });
}

async function apiJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  return (await response.json()) as T;
}

function uploadBlob(
  url: string,
  blob: Blob,
  headers: Record<string, string>,
  onProgress: (loaded: number) => void,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    let settled = false;
    let lastProgressAt = Date.now();
    let stalled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearInterval(stallTimer);
      callback();
    };

    const stallTimer = window.setInterval(() => {
      if (settled || Date.now() - lastProgressAt < STALL_TIMEOUT_MS) return;
      stalled = true;
      request.abort();
    }, STALL_CHECK_INTERVAL_MS);

    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (event) => {
      lastProgressAt = Date.now();
      if (event.lengthComputable) onProgress(event.loaded);
    };
    request.onerror = () =>
      finish(() =>
        reject(
          new UploadBlobError("The network interrupted this upload part.", { retryable: true }),
        ),
      );
    request.onabort = () =>
      finish(() =>
        reject(
          new UploadBlobError(
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
    request.send(blob);
  });
}

async function retryPart<T>(
  operation: (attempt: number) => Promise<T>,
  onRetry?: (nextAttempt: number, error: unknown) => void,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_PART_ATTEMPTS; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const retryable = !(error instanceof UploadBlobError) || error.retryable;
      if (!retryable || attempt >= MAX_PART_ATTEMPTS) break;
      const nextAttempt = attempt + 1;
      onRetry?.(nextAttempt, error);
      const backoffMs = Math.min(4_000, 500 * 2 ** (attempt - 1));
      const jitterMs = Math.floor(Math.random() * 300);
      await new Promise((resolve) => window.setTimeout(resolve, backoffMs + jitterMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Upload part failed after retries.");
}
