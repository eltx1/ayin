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

export type MediaStorageObservationCode =
  | "NO_SUCH_UPLOAD"
  | "PROVIDER_ERROR"
  | "INVALID_RESPONSE"
  | "OBSERVATION_LIMIT_EXCEEDED"
  | "OBSERVATION_TIMEOUT";

// A failed/limited observation is never an empty or partially complete inventory.
// Provider diagnostics, private keys and signed URLs must not enter this error.
export class MediaStorageObservationError extends Error {
  constructor(
    readonly code: MediaStorageObservationCode,
    readonly operation: "listParts" | "listMultipartUploads" | "deletePrefix",
    readonly providerStatus?: number,
  ) {
    super(`The media storage observation could not be verified (${code}).`);
    this.name = "MediaStorageObservationError";
  }
}

// This is a trusted provider-adapter contract, never a client assertion or a
// duration-based assumption. R2 currently implements NO settlement verifier.
// A future implementation requires externally certified replay/in-flight-create,
// PUT/part/complete settlement semantics and must bind every field below.
export interface UploadCleanupSettlementBinding {
  provider: "r2" | "development";
  operationKey: string;
  kind: "OBJECT" | "MULTIPART" | "ALLOCATION";
  key: string;
  uploadId: string | null;
  sessionId: string;
  sessionRevision: number;
  mode: "SINGLE" | "MULTIPART";
  grantsRevokedAt: string;
  lastGrantExpiresAt: string | null;
  leaseToken: string;
  attempt: number;
}

export interface UploadCleanupSettlementEvidence {
  binding: UploadCleanupSettlementBinding;
  // Both claims are necessary: a delayed create or complete can recreate data.
  conclusion: "NO_FUTURE_ALLOCATION_OR_WRITE";
  provenance: {
    provider: "r2" | "development";
    verifierVersion: "AYIN_UPLOAD_SETTLEMENT_V1";
    proofReference: string;
  };
  verifiedAt: Date;
}

export interface MediaStorageAdapter {
  readonly kind: "r2" | "development";
  readonly available: boolean;

  // Absence, DELETE/abort success and URL expiry never substitute for evidence.
  // Unsupported providers leave durable obligations pending/FAILED for review.
  verifyUploadCleanupSettlement?(
    binding: UploadCleanupSettlementBinding,
  ): Promise<UploadCleanupSettlementEvidence | null>;

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
  // Resolve only after observing every page within provider/time/size bounds.
  // This is not a transactional snapshot; concurrent storage changes remain possible.
  listParts(input: { key: string; uploadId: string }): Promise<ExistingUploadPart[]>;
  completeMultipartUpload(input: {
    key: string;
    uploadId: string;
    parts: CompletedUploadPart[];
  }): Promise<{ etag: string | null }>;
  abortMultipartUpload(input: { key: string; uploadId: string }): Promise<void>;
  headObject(key: string): Promise<StoredObjectMetadata>;
  readObject?(key: string, maxBytes: number): Promise<Uint8Array>;
  deleteObject(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  // Never return a partial inventory as complete when a bound or provider read fails.
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
