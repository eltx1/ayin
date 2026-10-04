import { randomUUID } from "node:crypto";

import {
  type AbandonedMultipartUpload,
  type ExistingUploadPart,
  type CompletedUploadPart,
  type MediaStorageAdapter,
  type StoredObjectMetadata,
} from "./media-storage.adapter.js";

const E2E_VTT = new TextEncoder().encode("WEBVTT\n\n00:00.000 --> 00:01.000\nAYIN caption test\n");

export class E2eMediaStorageAdapter implements MediaStorageAdapter {
  readonly kind = "development" as const;
  readonly available = true;
  private readonly multipart = new Map<string, { key: string; contentType: string }>();
  private readonly completed = new Map<string, StoredObjectMetadata>();

  async createMultipartUpload(input: {
    key: string;
    contentType: string;
  }): Promise<{ uploadId: string }> {
    const uploadId = `e2e-${randomUUID()}`;
    this.multipart.set(uploadId, input);
    return { uploadId };
  }

  async authorizeMultipartPart(input: {
    key: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds: number;
  }): Promise<{ url: string; expiresAt: Date }> {
    return {
      url: `https://e2e-upload.invalid/multipart/${encodeURIComponent(input.uploadId)}/${input.partNumber}?key=${encodeURIComponent(input.key)}`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }

  async authorizeSinglePut(input: {
    key: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<{ url: string; expiresAt: Date }> {
    return {
      url: `https://e2e-upload.invalid/object?key=${encodeURIComponent(input.key)}&type=${encodeURIComponent(input.contentType)}`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }

  async listParts(): Promise<ExistingUploadPart[]> {
    return [];
  }

  async completeMultipartUpload(input: {
    key: string;
    uploadId: string;
    parts: CompletedUploadPart[];
  }): Promise<{ etag: string | null }> {
    const upload = this.multipart.get(input.uploadId);
    if (!upload || upload.key !== input.key || input.parts.length === 0)
      throw new Error("Unknown E2E multipart upload.");
    let sizeBytes = 0;
    // Explicit simulated provider bytes, not the MediaAsset's desired size or token.
    // Real object storage continues to return its independently observed HEAD metadata.
    for (const part of input.parts) {
      const match = /^e2e-bytes-([1-9][0-9]*)$/.exec(part.etag);
      const bytes = match ? Number(match[1]) : NaN;
      if (!Number.isSafeInteger(bytes) || !Number.isSafeInteger(sizeBytes + bytes))
        throw new Error("E2E multipart part requires explicit simulated byte metadata.");
      sizeBytes += bytes;
    }
    this.completed.set(input.key, {
      sizeBytes,
      contentType: upload.contentType,
      etag: '"e2e-complete"',
    });
    this.multipart.delete(input.uploadId);
    return { etag: '"e2e-complete"' };
  }

  async abortMultipartUpload(input: { key: string; uploadId: string }): Promise<void> {
    if (this.multipart.get(input.uploadId)?.key === input.key)
      this.multipart.delete(input.uploadId);
  }

  async headObject(key: string): Promise<StoredObjectMetadata> {
    if (key.startsWith("captions/videos/")) {
      return { sizeBytes: E2E_VTT.byteLength, contentType: "text/vtt", etag: '"e2e-caption"' };
    }
    return (
      this.completed.get(key) ?? { sizeBytes: 1024, contentType: "video/mp4", etag: '"e2e-object"' }
    );
  }

  async readObject(key: string, maxBytes: number): Promise<Uint8Array> {
    if (!key.startsWith("captions/videos/") || E2E_VTT.byteLength > maxBytes) {
      throw new Error("E2E object is unavailable for bounded reading.");
    }
    return E2E_VTT.slice();
  }

  async deleteObject(): Promise<void> {}

  async deletePrefix(): Promise<void> {}

  async listMultipartUploads(): Promise<AbandonedMultipartUpload[]> {
    return [];
  }
}
