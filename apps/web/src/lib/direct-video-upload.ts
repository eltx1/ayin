import { apiBaseUrl, readApiError } from "@/lib/api";
import { videoMimeTypeForUpload } from "@/lib/video-inspection";

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

export async function uploadVideoDirectly(input: {
  channelId: string;
  file: File;
  onProgress: (percent: number) => void;
}): Promise<DirectUploadResult> {
  const session = await createSession(input.channelId, input.file);
  return uploadPreparedVideoDirectly({
    session,
    file: input.file,
    onProgress: input.onProgress,
  });
}

export async function uploadPreparedVideoDirectly(input: {
  session: UploadSession;
  file: File;
  onProgress: (percent: number) => void;
}): Promise<DirectUploadResult> {
  const { session, file, onProgress } = input;
  if (session.mode === "single") {
    await uploadBlob(session.upload.url, file, session.upload.headers, (loaded) => {
      onProgress(Math.min(99, Math.round((loaded / file.size) * 100)));
    });
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

  for (let partNumber = 1; partNumber <= session.partCount; partNumber += 1) {
    if (completedParts.has(partNumber)) {
      onProgress(Math.min(99, Math.round((completedBytes / file.size) * 100)));
      continue;
    }
    const start = (partNumber - 1) * session.partSizeBytes;
    const end = Math.min(file.size, start + session.partSizeBytes);
    const blob = file.slice(start, end);
    const authorization = await apiJson<{ url: string }>("/media/uploads/sessions/authorize-part", {
      sessionToken: session.sessionToken,
      partNumber,
    });
    const etag = await retryPart(async () =>
      uploadBlob(authorization.url, blob, {}, (loaded) => {
        const current = completedBytes + loaded;
        onProgress(Math.min(99, Math.round((current / file.size) * 100)));
      }),
    );
    if (!etag) {
      throw new Error("One upload part could not be verified. Please retry the upload.");
    }
    completedParts.set(partNumber, { partNumber, etag });
    completedBytes += blob.size;
  }

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
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded);
      }
    };
    request.onerror = () => reject(new Error("The upload was interrupted. Please retry."));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(request.getResponseHeader("etag"));
      } else {
        reject(new Error("This upload part could not be saved. Please retry."));
      }
    };
    request.send(blob);
  });
}

async function retryPart<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Upload part failed after retries.");
}
