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
/** V2 is a finite application protocol, not a claim that R2 can revoke/drain
 * all requests. Uncertain provider effects stay retained physical-cleanup debt.
 */
export interface FiniteMultipartUploadEvidence {
  provider: "r2";
  version: "AYIN_DURABLE_UPLOAD_ADMISSION_V2";
  sourceProtocolVersion: 2;
  sourceWrites: "MULTIPART_ONLY";
  dispatchPolicy: "CREATE_ONCE_COMPLETE_ONCE_PER_UPLOAD_ID";
  uncertaintyPolicy: "RETAIN_PHYSICAL_DEBT";
  exposurePolicy: "CONSERVATIVE_ACCOUNTING_NOT_PROVIDER_SIZE_ENFORCEMENT";
}
export interface DurableUploadSettlementProvider {
  admissionEvidence(): DurableUploadSettlementEvidence | FiniteMultipartUploadEvidence | null;
}

/** Only selected by explicit default-off rollout configuration. This describes
 * implemented controls; it contains no fabricated NO_FUTURE provider evidence.
 * Enabling still requires the separately documented real-browser/R2 review.
 */
export class FiniteMultipartDurableUploadSettlement implements DurableUploadSettlementProvider {
  admissionEvidence(): FiniteMultipartUploadEvidence {
    return {
      provider: "r2",
      version: "AYIN_DURABLE_UPLOAD_ADMISSION_V2",
      sourceProtocolVersion: 2,
      sourceWrites: "MULTIPART_ONLY",
      dispatchPolicy: "CREATE_ONCE_COMPLETE_ONCE_PER_UPLOAD_ID",
      uncertaintyPolicy: "RETAIN_PHYSICAL_DEBT",
      exposurePolicy: "CONSERVATIVE_ACCOUNTING_NOT_PROVIDER_SIZE_ENFORCEMENT",
    };
  }
}
/** Default selection keeps recovery unavailable. The separately gated V2 lane
 * uses a finite journal contract, never pretends to supply V1 provider proofs.
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
  v2Enabled = false,
): 1 | 2 {
  const evidence = provider.admissionEvidence();
  if (evidence?.version === "AYIN_DURABLE_UPLOAD_ADMISSION_V2") {
    if (
      v2Enabled &&
      storage.available &&
      storage.kind === "r2" &&
      storage.observeUploadCompletion &&
      evidence.provider === storage.kind &&
      evidence.sourceProtocolVersion === 2 &&
      evidence.sourceWrites === "MULTIPART_ONLY" &&
      evidence.dispatchPolicy === "CREATE_ONCE_COMPLETE_ONCE_PER_UPLOAD_ID" &&
      evidence.uncertaintyPolicy === "RETAIN_PHYSICAL_DEBT" &&
      evidence.exposurePolicy === "CONSERVATIVE_ACCOUNTING_NOT_PROVIDER_SIZE_ENFORCEMENT"
    )
      return 2;
    throw new MediaUploadError(
      "UPLOAD_RECOVERY_UNSUPPORTED",
      "Recoverable uploads are not enabled.",
      503,
    );
  }
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
  return 1;
}

/** A bounded read of the same gate, never a substitute for checking at dispatch. */
export function readDurableUploadCapability(
  provider: DurableUploadSettlementProvider,
  storage: MediaStorageAdapter,
  now = new Date(),
  v2Enabled = false,
): UploadRecoveryCapability {
  try {
    requireDurableUploadSettlement(provider, storage, now, v2Enabled);
    return { protocolVersion: 1, supported: true, reason: null };
  } catch {
    // Unsupported, expired or unavailable evidence stays closed without leaking
    // provider diagnostics, references or implementation details to the client.
    return { protocolVersion: 1, supported: false, reason: "UNSUPPORTED" };
  }
}
