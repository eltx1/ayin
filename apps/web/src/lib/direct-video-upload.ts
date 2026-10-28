import { apiBaseUrl } from "@/lib/api";
import { readUploadRequestError, UploadRequestError } from "./upload-error";
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
const MAX_CONCURRENT_PARTS = 3;
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

export interface DirectUploadCompletionInput {
  sessionToken: string;
  parts: { partNumber: number; etag: string }[];
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

export class UploadBlobError extends Error {
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
  // Admin may require an explicit verification continuation for this metadata
  // request. Storage bodies and completion acknowledgment validation stay here.
  completeUpload?: (payload: DirectUploadCompletionInput) => Promise<unknown>;
  onBytesProgress?: (loaded: number, total: number) => void;
  renewSingleAuthorization?: boolean;
}): Promise<DirectUploadResult> {
  const { file, onProgress, onStatus, signal } = input;
  signal?.throwIfAborted();
  const session = parseUploadSession(input.session, file.size);
  let highestReportedPercent = 0;
  let highestReportedBytes = 0;
  const reportProgress = (loadedBytes: number) => {
    // Report logical file bytes, not retransmitted traffic. Retrying a part must
    // neither count those bytes twice nor move the progress bar backwards.
    highestReportedBytes = Math.max(highestReportedBytes, Math.min(file.size, loadedBytes));
    input.onBytesProgress?.(highestReportedBytes, file.size);
    const next = Math.min(99, Math.round((highestReportedBytes / file.size) * 100));
    if (next <= highestReportedPercent) return;
    highestReportedPercent = next;
    onProgress(highestReportedPercent);
  };

  if (session.mode === "single") {
    await retryPart(
      async (attempt) => {
        const authorization =
          attempt > 1 || input.renewSingleAuthorization
            ? parseUploadSession(
                {
                  ...session,
                  upload: await apiJson<unknown>(
                    "/media/uploads/sessions/authorize-single",
                    { sessionToken: session.sessionToken },
                    signal,
                  ),
                },
                file.size,
              )
            : session;
        if (authorization.mode !== "single") throw new UploadProtocolError();
        signal?.throwIfAborted();
        onStatus?.({ phase: "uploading", message: "Uploading video…", attempt });
        return uploadBlob(
          authorization.upload.url,
          file,
          authorization.upload.headers,
          (loaded) => {
            reportProgress(loaded);
          },
          signal,
        );
      },
      (attempt) =>
        onStatus?.({
          phase: "retrying",
          message: "Connection paused. Retrying the upload safely…",
          attempt,
        }),
      signal,
    );
    signal?.throwIfAborted();
    reportProgress(file.size);
    onStatus?.({ phase: "finalizing", message: "Finalizing upload…" });
    const completed = parseUploadCompletion(
      await completePreparedUpload(input, { sessionToken: session.sessionToken, parts: [] }),
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
  const partProgress = new Map(resumed.map((part) => [part.partNumber, part.sizeBytes]));
  let transferredBytes = resumed.reduce((total, part) => total + part.sizeBytes, 0);
  reportProgress(transferredBytes);

  signal?.throwIfAborted();
  const transfer = new AbortController();
  const cancel = () => transfer.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  let nextPartNumber = 1;
  const worker = async () => {
    try {
      while (!transfer.signal.aborted) {
        while (completedParts.has(nextPartNumber)) nextPartNumber += 1;
        if (nextPartNumber > session.partCount) return;
        const partNumber = nextPartNumber++;
        const start = (partNumber - 1) * session.partSizeBytes;
        const blob = file.slice(start, Math.min(file.size, start + session.partSizeBytes));
        const reportPartProgress = (loaded: number) => {
          if (transfer.signal.aborted) return;
          const previous = partProgress.get(partNumber) ?? 0;
          const current = Math.max(previous, Math.min(blob.size, loaded));
          partProgress.set(partNumber, current);
          transferredBytes += current - previous;
          reportProgress(transferredBytes);
        };
        const etag = await retryPart(
          async (attempt) => {
            // A retry occupies this worker's slot and refreshes only its part's
            // authorization. Other completed or in-flight parts are retained.
            const authorization = await apiJson<unknown>(
              "/media/uploads/sessions/authorize-part",
              { sessionToken: session.sessionToken, partNumber },
              transfer.signal,
            );
            transfer.signal.throwIfAborted();
            onStatus?.({
              phase: "uploading",
              message: `Uploading video · part ${partNumber} of ${session.partCount}`,
              partNumber,
              partCount: session.partCount,
              attempt,
            });
            return uploadBlob(
              parseUploadPartUrl(authorization),
              blob,
              {},
              reportPartProgress,
              transfer.signal,
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
          transfer.signal,
        );
        transfer.signal.throwIfAborted();
        if (!etag?.trim() || etag.length > 512 || /[\r\n]/.test(etag)) {
          throw new UploadBlobError(
            "One upload part could not be verified. Resume the upload to check the saved parts.",
            { retryable: false },
          );
        }
        completedParts.set(partNumber, { partNumber, etag });
        reportPartProgress(blob.size);
      }
    } catch (error) {
      // Preserve the first failure and stop all sibling requests/backoffs before
      // allowing this operation to return or a caller to start a safe retry.
      if (!transfer.signal.aborted) transfer.abort(error);
      throw error;
    }
  };
  try {
    await Promise.allSettled(
      Array.from(
        { length: Math.min(MAX_CONCURRENT_PARTS, session.partCount - completedParts.size) },
        worker,
      ),
    );
    transfer.signal.throwIfAborted();
    if (completedParts.size !== session.partCount) throw new UploadProtocolError();
  } finally {
    signal?.removeEventListener("abort", cancel);
  }

  onStatus?.({ phase: "finalizing", message: "Finalizing upload…" });
  const completed = parseUploadCompletion(
    await completePreparedUpload(input, {
      sessionToken: session.sessionToken,
      parts: [...completedParts.values()].sort((left, right) => left.partNumber - right.partNumber),
    }),
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

async function completePreparedUpload(
  input: {
    completeUpload?: (payload: DirectUploadCompletionInput) => Promise<unknown>;
    signal?: AbortSignal;
  },
  payload: DirectUploadCompletionInput,
) {
  input.signal?.throwIfAborted();
  return input.completeUpload
    ? input.completeUpload(payload)
    : apiJson<unknown>("/media/uploads/sessions/complete", payload, input.signal);
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
      throw await readUploadRequestError(response);
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
      if (settled || signal?.aborted) return;
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
        (!(error instanceof UploadBlobError) || error.retryable) &&
        (!(error instanceof UploadRequestError) ||
          [408, 425, 429].includes(error.status) ||
          error.status >= 500);
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

export async function completeVideoUpload(
  payload: DirectUploadCompletionInput,
  assetId: string,
  signal?: AbortSignal,
): Promise<DirectUploadResult> {
  return parseUploadCompletion(
    await apiJson<unknown>("/media/uploads/sessions/complete", payload, signal),
    assetId,
  );
}
