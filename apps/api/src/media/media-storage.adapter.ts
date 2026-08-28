export interface CompletedUploadPart {
  partNumber: number;
  etag: string;
}

export interface ExistingUploadPart extends CompletedUploadPart {
  sizeBytes: number;
}

export interface StoredObjectMetadata {
  sizeBytes: number;
  contentType: string | null;
  etag: string | null;
}

export interface AbandonedMultipartUpload {
  key: string;
  uploadId: string;
  initiatedAt: Date;
}

export interface MediaStorageAdapter {
  readonly kind: "r2" | "development";
  readonly available: boolean;

  createMultipartUpload(input: { key: string; contentType: string }): Promise<{ uploadId: string }>;
  authorizeMultipartPart(input: {
    key: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds: number;
  }): Promise<{ url: string; expiresAt: Date }>;
  authorizeSinglePut(input: {
    key: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<{ url: string; expiresAt: Date }>;
  listParts(input: { key: string; uploadId: string }): Promise<ExistingUploadPart[]>;
  completeMultipartUpload(input: {
    key: string;
    uploadId: string;
    parts: CompletedUploadPart[];
  }): Promise<{ etag: string | null }>;
  abortMultipartUpload(input: { key: string; uploadId: string }): Promise<void>;
  headObject(key: string): Promise<StoredObjectMetadata>;
  deleteObject(key: string): Promise<void>;
  listMultipartUploads(prefix: string): Promise<AbandonedMultipartUpload[]>;
}

export class MediaStorageUnavailableError extends Error {
  constructor() {
    super("Direct video uploads are unavailable until Cloudflare R2 is configured.");
    this.name = "MediaStorageUnavailableError";
  }
}

export const MEDIA_STORAGE_ADAPTER = Symbol("MEDIA_STORAGE_ADAPTER");
export const MEDIA_STORAGE_CONFIG = Symbol("MEDIA_STORAGE_CONFIG");
