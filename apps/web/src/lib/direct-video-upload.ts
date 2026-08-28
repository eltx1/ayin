import { apiBaseUrl, readApiError } from "@/lib/api";

interface MultipartSession {
  assetId: string;
  mode: "multipart";
  sessionToken: string;
  partSizeBytes: number;
  partCount: number;
}

interface SingleSession {
  assetId: string;
  mode: "single";
  sessionToken: string;
  upload: { url: string; method: "PUT"; headers: Record<string, string> };
}

type UploadSession = MultipartSession | SingleSession;

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
  if (session.mode === "single") {
    await uploadBlob(session.upload.url, input.file, session.upload.headers, (loaded) => {
      input.onProgress(Math.min(99, Math.round((loaded / input.file.size) * 100)));
    });
    const completed = await apiJson<DirectUploadResult>("/media/uploads/sessions/complete", {
      sessionToken: session.sessionToken,
      parts: [],
    });
    input.onProgress(100);
    return completed;
  }

  const resumed = await apiGet<{ parts: Array<{ partNumber: number; etag: string; sizeBytes: number }> }>(
    `/media/uploads/sessions/${encodeURIComponent(session.sessionToken)}/parts`,
  );
  const completedParts = new Map(
    resumed.parts.map((part) => [part.partNumber, { partNumber: part.partNumber, etag: part.etag }]),
  );
  let completedBytes = resumed.parts.reduce((total, part) => total + part.sizeBytes, 0);

  for (let partNumber = 1; partNumber <= session.partCount; partNumber += 1) {
    if (completedParts.has(partNumber)) {
      input.onProgress(Math.min(99, Math.round((completedBytes / input.file.size) * 100)));
      continue;
    }
    const start = (partNumber - 1) * session.partSizeBytes;
    const end = Math.min(input.file.size, start + session.partSizeBytes);
    const blob = input.file.slice(start, end);
    const authorization = await apiJson<{ url: string }>("/media/uploads/sessions/authorize-part", {
      sessionToken: session.sessionToken,
      partNumber,
    });
    const etag = await retryPart(async () =>
      uploadBlob(authorization.url, blob, {}, (loaded) => {
        const current = completedBytes + loaded;
        input.onProgress(Math.min(99, Math.round((current / input.file.size) * 100)));
      }),
    );
    if (!etag) {
      throw new Error(
        "R2 uploaded a part but did not expose its ETag. Check the bucket CORS ExposeHeaders setting.",
      );
    }
    completedParts.set(partNumber, { partNumber, etag });
    completedBytes += blob.size;
  }

  const completed = await apiJson<DirectUploadResult>("/media/uploads/sessions/complete", {
    sessionToken: session.sessionToken,
    parts: [...completedParts.values()].sort((left, right) => left.partNumber - right.partNumber),
  });
  input.onProgress(100);
  return completed;
}

async function createSession(channelId: string, file: File): Promise<UploadSession> {
  return apiJson<UploadSession>("/media/uploads/sessions", {
    channelId,
    sizeBytes: file.size,
    mimeType: "video/mp4",
  });
}

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, { credentials: "include" });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  return (await response.json()) as T;
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
    request.onerror = () => reject(new Error("The direct R2 upload was interrupted."));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(request.getResponseHeader("etag"));
      } else {
        reject(new Error("R2 rejected this upload part. Please retry."));
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
