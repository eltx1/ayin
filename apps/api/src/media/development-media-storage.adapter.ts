import {
  type AbandonedMultipartUpload,
  type CompletedUploadPart,
  type ExistingUploadPart,
  type MediaStorageAdapter,
  MediaStorageUnavailableError,
  type StoredObjectMetadata,
} from "./media-storage.adapter.js";

export class DevelopmentMediaStorageAdapter implements MediaStorageAdapter {
  readonly kind = "development" as const;
  readonly available = false;

  private unavailable(): never {
    throw new MediaStorageUnavailableError();
  }

  async createMultipartUpload(_input: {
    key: string;
    contentType: string;
  }): Promise<{ uploadId: string }> {
    return this.unavailable();
  }

  async authorizeMultipartPart(_input: {
    key: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds: number;
  }): Promise<{ url: string; expiresAt: Date }> {
    return this.unavailable();
  }

  async authorizeSinglePut(_input: {
    key: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<{ url: string; expiresAt: Date }> {
    return this.unavailable();
  }

  async listParts(_input: { key: string; uploadId: string }): Promise<ExistingUploadPart[]> {
    return this.unavailable();
  }

  async completeMultipartUpload(_input: {
    key: string;
    uploadId: string;
    parts: CompletedUploadPart[];
  }): Promise<{ etag: string | null }> {
    return this.unavailable();
  }

  async abortMultipartUpload(_input: { key: string; uploadId: string }): Promise<void> {
    return this.unavailable();
  }

  async headObject(_key: string): Promise<StoredObjectMetadata> {
    return this.unavailable();
  }

  async deleteObject(_key: string): Promise<void> {
    return this.unavailable();
  }

  async listMultipartUploads(_prefix: string): Promise<AbandonedMultipartUpload[]> {
    return this.unavailable();
  }
}
