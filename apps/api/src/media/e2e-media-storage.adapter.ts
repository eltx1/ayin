import { randomUUID } from "node:crypto";

import {
  type AbandonedMultipartUpload,
  type ExistingUploadPart,
  type MediaStorageAdapter,
  type StoredObjectMetadata,
} from "./media-storage.adapter.js";

const E2E_VTT = new TextEncoder().encode(
  "WEBVTT\n\n00:00.000 --> 00:01.000\nAYIN caption test\n",
);

export class E2eMediaStorageAdapter implements MediaStorageAdapter {
  readonly kind = "development" as const;
  readonly available = true;

  async createMultipartUpload(): Promise<{ uploadId: string }> {
    return { uploadId: `e2e-${randomUUID()}` };
  }

  async authorizeMultipartPart(input: {
    key: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds: number;
  }): Promise<{ url: string; expiresAt: Date }> {
    return {
      url: `http://e2e-upload.invalid/multipart/${encodeURIComponent(input.uploadId)}/${input.partNumber}?key=${encodeURIComponent(input.key)}`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }

  async authorizeSinglePut(input: {
    key: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<{ url: string; expiresAt: Date }> {
    return {
      url: `http://e2e-upload.invalid/object?key=${encodeURIComponent(input.key)}&type=${encodeURIComponent(input.contentType)}`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }

  async listParts(): Promise<ExistingUploadPart[]> {
    return [];
  }

  async completeMultipartUpload(): Promise<{ etag: string | null }> {
    return { etag: '"e2e-complete"' };
  }

  async abortMultipartUpload(): Promise<void> {}

  async headObject(key: string): Promise<StoredObjectMetadata> {
    if (key.startsWith("captions/videos/")) {
      return { sizeBytes: E2E_VTT.byteLength, contentType: "text/vtt", etag: '"e2e-caption"' };
    }
    return { sizeBytes: 1024, contentType: "video/mp4", etag: '"e2e-object"' };
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
