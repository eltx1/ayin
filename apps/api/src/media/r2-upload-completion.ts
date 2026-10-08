import type {
  StoredObjectMetadata,
  UploadCompletionObservation,
  UploadCompletionObservationInput,
  UploadObjectBinding,
} from "./media-storage.adapter.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const SESSION_HEADER = "x-amz-meta-ayin-upload-session";
const SOURCE_HEADER = "x-amz-meta-ayin-source-asset";
const IDENTITY_HEADER = "x-amz-meta-ayin-identity-root";

export class R2UploadMetadataError extends Error {
  constructor() {
    super("R2 upload identity or object metadata is invalid.");
    this.name = "R2UploadMetadataError";
  }
}

export function uploadBindingHeaders(binding: UploadObjectBinding): Record<string, string> {
  if (
    !UUID.test(binding.sessionId) ||
    !UUID.test(binding.sourceAssetId) ||
    !DIGEST.test(binding.contentIdentityDigest)
  )
    throw new R2UploadMetadataError();
  return {
    [SESSION_HEADER]: binding.sessionId,
    [SOURCE_HEADER]: binding.sourceAssetId,
    [IDENTITY_HEADER]: binding.contentIdentityDigest,
  };
}

function uploadBindingFromHeaders(headers: Headers): UploadObjectBinding | undefined {
  const sessionId = headers.get(SESSION_HEADER);
  const sourceAssetId = headers.get(SOURCE_HEADER);
  const contentIdentityDigest = headers.get(IDENTITY_HEADER);
  if (sessionId === null && sourceAssetId === null && contentIdentityDigest === null)
    return undefined;
  if (sessionId === null || sourceAssetId === null || contentIdentityDigest === null)
    throw new R2UploadMetadataError();
  const binding = { sessionId, sourceAssetId, contentIdentityDigest };
  uploadBindingHeaders(binding);
  return binding;
}

export function objectMetadataFromHeaders(headers: Headers): StoredObjectMetadata {
  const rawSize = headers.get("content-length");
  const sizeBytes = Number(rawSize);
  if (rawSize === null || !/^\d+$/.test(rawSize) || !Number.isSafeInteger(sizeBytes))
    throw new R2UploadMetadataError();
  const missingMetadata = headers.get("x-amz-missing-meta");
  if (missingMetadata !== null && missingMetadata !== "0") throw new R2UploadMetadataError();
  const etag = headers.get("etag");
  // Retain safe legacy opaque ETags, including synthetic unquoted tokens. Empty,
  // weak, duplicate/combined, whitespace-bearing and malformed quoted values fail.
  if (
    etag !== null &&
    (etag.length > 256 ||
      !/^(?:"[\x21\x23-\x2b\x2d-\x5b\x5d-\x7e]+"|[\x21\x23-\x2b\x2d-\x5b\x5d-\x7e]+)$/.test(etag))
  )
    throw new R2UploadMetadataError();
  const uploadBinding = uploadBindingFromHeaders(headers);
  return {
    sizeBytes,
    contentType: headers.get("content-type"),
    etag,
    ...(uploadBinding ? { uploadBinding } : {}),
  };
}

export function normalizedUploadContentType(value: string | null): string | null {
  if (
    value === null ||
    value.length > 1024 ||
    value.includes(",") ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    })
  )
    return null;
  const type = value.split(";", 1)[0]!.trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type) ? type : null;
}

export function validateUploadCompletionExpectation(input: UploadCompletionObservationInput): void {
  uploadBindingHeaders(input.expected.binding);
  if (
    !Number.isSafeInteger(input.expected.sizeBytes) ||
    input.expected.sizeBytes < 1 ||
    normalizedUploadContentType(input.expected.contentType) === null
  )
    throw new R2UploadMetadataError();
}

export function matchUploadCompletionObject(
  metadata: StoredObjectMetadata,
  expected: UploadCompletionObservationInput["expected"],
): UploadCompletionObservation {
  const binding = metadata.uploadBinding;
  if (
    metadata.sizeBytes !== expected.sizeBytes ||
    normalizedUploadContentType(metadata.contentType) !==
      normalizedUploadContentType(expected.contentType) ||
    !metadata.etag ||
    !binding ||
    binding.sessionId !== expected.binding.sessionId ||
    binding.sourceAssetId !== expected.binding.sourceAssetId ||
    binding.contentIdentityDigest !== expected.binding.contentIdentityDigest
  )
    return { status: "OBJECT_MISMATCH" };
  return {
    status: "OBJECT_VERIFIED",
    metadata: { ...metadata, etag: metadata.etag, uploadBinding: binding },
  };
}
