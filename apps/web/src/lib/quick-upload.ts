import { apiBaseUrl, readApiError } from "@/lib/api";
import type { UploadSession } from "@/lib/direct-video-upload";

export interface QuickDraftResponse {
  video: {
    id: string;
    channelId: string;
    title: string;
    status: "UPLOADING";
    visibility: "PUBLIC" | "UNLISTED" | "PRIVATE";
    commentsEnabled: boolean;
    durationMs: number | null;
  };
  uploadSession: UploadSession;
}

export interface QuickVideoDetails {
  title?: string;
  description?: string | null;
  visibility?: "PUBLIC" | "UNLISTED" | "PRIVATE";
  commentsEnabled?: boolean;
  scheduledPublishAt?: string | null;
}

export async function createQuickDraft(input: {
  channelId: string;
  title: string;
  file: File;
  durationMs: number | null;
}): Promise<QuickDraftResponse> {
  return apiJson<QuickDraftResponse>("/creator/videos/drafts", "POST", {
    channelId: input.channelId,
    title: input.title,
    sizeBytes: input.file.size,
    mimeType: "video/mp4",
    durationMs: input.durationMs,
  });
}

export async function confirmQuickUpload(videoId: string): Promise<void> {
  await apiJson(`/creator/videos/${videoId}/upload-complete`, "POST", {});
}

export async function saveQuickVideoDetails(
  videoId: string,
  details: QuickVideoDetails,
): Promise<void> {
  await apiJson(`/creator/videos/${videoId}`, "PATCH", details);
}

export async function publishQuickVideo(
  videoId: string,
  details: QuickVideoDetails & { rightsConfirmed: boolean },
): Promise<{ video: { status: "PUBLISHED" | "SCHEDULED"; slug: string } }> {
  return apiJson(`/creator/videos/${videoId}/publish`, "POST", details);
}

export async function uploadQuickThumbnail(videoId: string, image: Blob): Promise<string> {
  const mimeType = image.type === "image/png" ? "image/png" : "image/jpeg";
  const authorization = await apiJson<{
    assetId: string;
    upload: { url: string; headers: Record<string, string> };
  }>(`/creator/videos/${videoId}/thumbnail/authorize`, "POST", {
    mimeType,
    sizeBytes: image.size,
  });
  await putBlob(authorization.upload.url, image, authorization.upload.headers);
  await apiJson(`/creator/videos/${videoId}/thumbnail/complete`, "POST", {
    assetId: authorization.assetId,
  });
  return authorization.assetId;
}

async function apiJson<T = unknown>(
  path: string,
  method: "POST" | "PATCH",
  payload: unknown,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response));
  }
  return (await response.json()) as T;
}

function putBlob(url: string, blob: Blob, headers: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value);
    }
    request.onerror = () => reject(new Error("The thumbnail upload was interrupted."));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
      } else {
        reject(new Error("The thumbnail could not be stored. Please try another image."));
      }
    };
    request.send(blob);
  });
}
