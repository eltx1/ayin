import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import { Inject, Injectable } from "@nestjs/common";

import {
  MEDIA_STORAGE_ADAPTER,
  MEDIA_STORAGE_CONFIG,
  type MediaStorageAdapter,
} from "../media/media-storage.adapter.js";
import type { MediaStorageConfig } from "../media/media-storage.config.js";

const MAX_MULTIPART_PARTS = 10_000;
const HANDOFF_TIMEOUT_MS = 6 * 60 * 60 * 1000;

export interface LiveRecordingHandoffInput {
  streamId: string;
  channelId: string;
  providerAssetId: string;
  downloadUrl: string;
}

export interface LiveRecordingHandoffResult {
  r2ObjectKey: string;
  sizeBytes: number;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

@Injectable()
export class LiveRecordingHandoffService {
  constructor(
    @Inject(MEDIA_STORAGE_ADAPTER) private readonly storage: MediaStorageAdapter,
    @Inject(MEDIA_STORAGE_CONFIG) private readonly config: MediaStorageConfig,
  ) {}

  async copy(input: LiveRecordingHandoffInput): Promise<LiveRecordingHandoffResult> {
    return copyLiveRecordingToStorage(this.storage, this.config, input);
  }
}

export async function copyLiveRecordingToStorage(
  storage: MediaStorageAdapter,
  config: MediaStorageConfig,
  input: LiveRecordingHandoffInput,
  fetchImpl: FetchLike = fetch,
): Promise<LiveRecordingHandoffResult> {
  assertHandoffStorage(storage, config);
  const source = validateMuxRecordingUrl(input.downloadUrl);
  const objectKey = [
    "channels",
    input.channelId,
    "live",
    input.streamId,
    "recordings",
    `${input.providerAssetId}.mp4`,
  ].join("/");

  const response = await fetchImpl(source, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(HANDOFF_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Mux recording download failed with HTTP ${response.status}.`);
  }

  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  const maximumBytes = config.partSizeBytes * MAX_MULTIPART_PARTS;
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body.cancel().catch(() => undefined);
    throw new Error("Mux recording exceeds AYIN's bounded multipart handoff limit.");
  }

  const { uploadId } = await storage.createMultipartUpload({
    key: objectKey,
    contentType: "video/mp4",
  });
  const parts: Array<{ partNumber: number; etag: string }> = [];
  let totalBytes = 0;
  let partNumber = 1;
  let partBuffer = Buffer.allocUnsafe(config.partSizeBytes);
  let partLength = 0;

  const uploadPart = async () => {
    if (partLength === 0) return;
    if (partNumber > MAX_MULTIPART_PARTS) {
      throw new Error("Mux recording exceeded the maximum R2 multipart part count.");
    }
    const bytes = partBuffer.subarray(0, partLength);
    const authorization = await storage.authorizeMultipartPart({
      key: objectKey,
      uploadId,
      partNumber,
      expiresInSeconds: Math.max(300, config.uploadUrlTtlSeconds),
    });
    const upload = await fetchImpl(authorization.url, {
      method: "PUT",
      headers: { "content-length": String(bytes.byteLength) },
      body: bytes,
    });
    if (!upload.ok) {
      await upload.body?.cancel().catch(() => undefined);
      throw new Error(`R2 recording handoff part upload failed with HTTP ${upload.status}.`);
    }
    const etag = upload.headers.get("etag");
    if (!etag) throw new Error("R2 recording handoff part did not return an ETag.");
    parts.push({ partNumber, etag });
    totalBytes += bytes.byteLength;
    partNumber += 1;
    partBuffer = Buffer.allocUnsafe(config.partSizeBytes);
    partLength = 0;
  };

  try {
    const readable = Readable.fromWeb(response.body as WebReadableStream);
    for await (const chunk of readable) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      let offset = 0;
      while (offset < bytes.byteLength) {
        const copyLength = Math.min(
          config.partSizeBytes - partLength,
          bytes.byteLength - offset,
        );
        bytes.copy(partBuffer, partLength, offset, offset + copyLength);
        partLength += copyLength;
        offset += copyLength;
        if (partLength === config.partSizeBytes) await uploadPart();
      }
    }
    await uploadPart();
    if (parts.length === 0 || totalBytes === 0) {
      throw new Error("Mux recording download was empty.");
    }

    await storage.completeMultipartUpload({ key: objectKey, uploadId, parts });
    const stored = await storage.headObject(objectKey);
    if (stored.sizeBytes !== totalBytes) {
      throw new Error("R2 recording handoff verification size did not match the source.");
    }
    return { r2ObjectKey: objectKey, sizeBytes: totalBytes };
  } catch (error) {
    await storage.abortMultipartUpload({ key: objectKey, uploadId }).catch(() => undefined);
    await storage.deleteObject(objectKey).catch(() => undefined);
    throw error;
  }
}

function validateMuxRecordingUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Mux recording download URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "stream.mux.com" ||
    !url.pathname.toLowerCase().endsWith(".mp4") ||
    url.username ||
    url.password
  ) {
    throw new Error("Mux recording download URL is outside the allowed Mux origin.");
  }
  return url.toString();
}

function assertHandoffStorage(storage: MediaStorageAdapter, config: MediaStorageConfig): void {
  if (!storage.available || storage.kind !== "r2" || config.mode !== "r2") {
    throw new Error("R2 storage is required for live recording handoff.");
  }
}
