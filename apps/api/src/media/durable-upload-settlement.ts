import type { UploadRecoveryCapability } from "@ayin/types";
import { Injectable } from "@nestjs/common";
import type { MediaStorageAdapter } from "./media-storage.adapter.js";
import { MediaUploadError } from "./media-upload.service.js";

export const DURABLE_UPLOAD_SETTLEMENT = Symbol("DURABLE_UPLOAD_SETTLEMENT");
/** Reviewed provider contract evidence, supplied by trusted code, never HTTP or config.
 * A capability flag, expiry, address ledger, HEAD/DELETE or logs are insufficient.
 * This certifies both cleanup protocols before any new durable obligation exists.
 */
export interface DurableUploadSettlementEvidence {
  provider: MediaStorageAdapter["kind"];
  version: "AYIN_DURABLE_UPLOAD_ADMISSION_V1";
  browserGrantSettlement: {
    conclusion: "NO_LATE_PUT_PART_COMPLETE_OR_ALLOCATION";
    proofReference: string;
  };
  serverWriteSettlement: {
    conclusion: "NO_LATE_SOURCE_OR_OUTPUT_WRITE";
    proofReference: string;
  };
  verifiedAt: Date;
  validUntil: Date;
}
export interface DurableUploadSettlementProvider {
  admissionEvidence(): DurableUploadSettlementEvidence | null;
}
/** All shipped providers are unsupported. Only synthetic DI tests replace this.
 * Enabling R2 requires a reviewed provider-backed implementation of BOTH proofs.
 */
@Injectable()
export class UnsupportedDurableUploadSettlement implements DurableUploadSettlementProvider {
  admissionEvidence(): null {
    return null;
  }
}
export function requireDurableUploadSettlement(
  provider: DurableUploadSettlementProvider,
  storage: MediaStorageAdapter,
  now = new Date(),
): void {
  const evidence = provider.admissionEvidence();
  const reference = (value: unknown) =>
    typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,200}$/.test(value);
  if (
    !storage.available ||
    !storage.verifyUploadCleanupSettlement ||
    !evidence ||
    evidence.provider !== storage.kind ||
    evidence.version !== "AYIN_DURABLE_UPLOAD_ADMISSION_V1" ||
    evidence.browserGrantSettlement?.conclusion !== "NO_LATE_PUT_PART_COMPLETE_OR_ALLOCATION" ||
    evidence.serverWriteSettlement?.conclusion !== "NO_LATE_SOURCE_OR_OUTPUT_WRITE" ||
    !reference(evidence.browserGrantSettlement.proofReference) ||
    !reference(evidence.serverWriteSettlement.proofReference) ||
    !(evidence.verifiedAt instanceof Date) ||
    !Number.isFinite(evidence.verifiedAt.getTime()) ||
    evidence.verifiedAt > now ||
    !(evidence.validUntil instanceof Date) ||
    !Number.isFinite(evidence.validUntil.getTime()) ||
    evidence.validUntil <= now
  )
    throw new MediaUploadError(
      "UPLOAD_RECOVERY_UNSUPPORTED",
      "Recoverable uploads are unavailable until storage settlement is verified.",
      503,
    );
}

/** A bounded read of the same gate, never a substitute for checking at dispatch. */
export function readDurableUploadCapability(
  provider: DurableUploadSettlementProvider,
  storage: MediaStorageAdapter,
  now = new Date(),
): UploadRecoveryCapability {
  try {
    requireDurableUploadSettlement(provider, storage, now);
    return { protocolVersion: 1, supported: true, reason: null };
  } catch {
    // Unsupported, expired or unavailable evidence stays closed without leaking
    // provider diagnostics, references or implementation details to the client.
    return { protocolVersion: 1, supported: false, reason: "UNSUPPORTED" };
  }
}
