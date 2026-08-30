import { randomUUID } from "node:crypto";

import {
  type AbandonedMultipartUpload,
  type ExistingUploadPart,
  type MediaStorageAdapter,
  type StoredObjectMetadata,
} from "./media-storage.adapter.js";

export class E2eMediaStorageAdapter implements MediaStorageAdapter {
  readonly kind = "development" as const;
  readonly available = true;

  async createMultipartUpload(): Promise<{ uploadId: string }> {
    return { uploadId: `e2e-${randomUUID()}` };
  }

  async authorizeMultipartPart(input: { objectKey: string; uploadId: string; partNumber: number }): Promise<{ url: string; expiresAt: Date }> {
    return {
      url: `http://e2e-upload.invalid/multipart/${encodeURIComponent(input.uploadId)}/${input.partNumber}?key=${encodeURIComponent(input.objectKey)}`,
      expiresAt: new Date(Date.now() + 15 * 60_000),
    };
  }

  async authorizeSinglePut(input: { objectKey: string }): Promise<{ url: string; expiresAt: Date }> {
    return {
      url: `http://e2e-upload.invalid/object?key=${encodeURIComponent(input.objectKey)}`,
      expiresAt: new Date(Date.now() + 15 * 60_000),
    };
  }

  async listParts(): Promise<ExistingUploadPart[]> {
    return [];
  }

  async completeMultipartUpload(): Promise<{ etag: string | null }> {
    return { etag: '"e2e-complete"' };
  }

  async abortMultipartUpload(): Promise<void> {}

  async headObject(): Promise<StoredObjectMetadata> {
    return {
      sizeBytes: 1024,
      contentType: "video/mp4",
      etag: '"e2e-object"',
    };
  }

  async deleteObject(): Promise<void> {}

  async listMultipartUploads(): Promise<AbandonedMultipartUpload[]> {
    return [];
  }
}
