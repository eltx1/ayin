import {
  type AbandonedMultipartUpload,
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

  async createMultipartUpload(): Promise<{ uploadId: string }> {
    return this.unavailable();
  }

  async authorizeMultipartPart(): Promise<{ url: string; expiresAt: Date }> {
    return this.unavailable();
  }

  async authorizeSinglePut(): Promise<{ url: string; expiresAt: Date }> {
    return this.unavailable();
  }

  async listParts(): Promise<ExistingUploadPart[]> {
    return this.unavailable();
  }

  async completeMultipartUpload(): Promise<{ etag: string | null }> {
    return this.unavailable();
  }

  async abortMultipartUpload(): Promise<void> {
    return this.unavailable();
  }

  async headObject(): Promise<StoredObjectMetadata> {
    return this.unavailable();
  }

  async deleteObject(): Promise<void> {
    return this.unavailable();
  }

  async listMultipartUploads(): Promise<AbandonedMultipartUpload[]> {
    return this.unavailable();
  }
}
