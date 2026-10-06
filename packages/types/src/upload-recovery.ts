import type { UploadFileIdentity } from "./upload-file-identity.js";

/** Versioned creator-only protocol. Never send these fields to legacy /drafts. */
export interface CreateRecoverableDraftRequest {
  requestId: string;
  channelId: string;
  title: string;
  sizeBytes: number;
  mimeType: string;
  durationMs?: number | null;
  videoForm?: "LONG_FORM" | "CLIP";
  fileIdentity: UploadFileIdentity;
}
export interface UploadRecoveryCommandRequest {
  requestId: string;
  expectedRevision: number;
}
export interface ResumeUploadRequest extends UploadRecoveryCommandRequest {
  fileIdentity: UploadFileIdentity;
}
export interface AuthorizeRecoveredUploadRequest extends UploadRecoveryCommandRequest {
  partNumber: number;
}
export type RecoverableUploadState =
  | "PREPARING"
  | "OPEN"
  | "FINALIZING"
  | "COMPLETED"
  | "CANCELLING"
  | "ABORTED"
  | "EXPIRED"
  | "REVOKED"
  | "UNRESOLVED";
export interface RecoverableUploadSession {
  protocolVersion: 1;
  actorAccountId: string;
  channelId: string;
  sessionId: string;
  assetId: string | null;
  videoId: string | null;
  state: RecoverableUploadState;
  revision: number;
  mode: "SINGLE" | "MULTIPART";
  sizeBytes: number;
  mimeType: string;
  partSizeBytes: number;
  partCount: number;
  expiresAt: string;
}
export interface UploadRecoveryCommandResponse {
  session: RecoverableUploadSession;
  operation: {
    requestId: string;
    status: "SUCCEEDED" | "PENDING" | "UNKNOWN";
    replayed: boolean;
  };
  // Authority revocation blocks new platform grants. It does not revoke old
  // provider URLs or claim physical deletion.
  cleanup?: { authorityRevoked: true; settlement: "PENDING" };
  // Grants are returned only by the first successful authorize response. A
  // duplicate never renews/re-signs. Request a fresh authorization after resume.
  grant?: {
    url: string;
    method: "PUT";
    headers: Record<string, string>;
    expiresAt: string;
    partNumber: number;
  };
}

/** Authenticated observation only; it never authorizes a subsequent write. */
export type UploadRecoveryCapability =
  | { protocolVersion: 1; supported: true; reason: null }
  | { protocolVersion: 1; supported: false; reason: "UNSUPPORTED" };

/** No signed grant is ever returned from a read-only outcome lookup. */
export type UploadRecoveryOutcomeResponse = Omit<UploadRecoveryCommandResponse, "grant">;
