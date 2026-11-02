// Display-only vocabulary. Never render a server message or an arbitrary code.
const referencedMessages = {
  CHANNEL_UPLOAD_QUOTA_REACHED:
    "Your channel does not have enough storage for this video. Review saved videos in Studio.",
  UPLOAD_ADMISSION_LIMIT:
    "Existing uploads or cleanup work have reached the upload allowance. Review saved uploads in Studio before starting another.",
  UPLOAD_PHYSICAL_DEBT_LIMIT:
    "The upload storage allowance is unavailable. Existing uploads or cleanup may still be using it.",
  UPLOAD_RATE_LIMITED: "Too many upload requests. Wait a moment before trying again.",
  UPLOAD_OUTPUT_ENVELOPE_UNAVAILABLE:
    "A processing storage allowance is not available. Video uploads are temporarily unavailable.",
  UPLOAD_CAPACITY_BUSY: "Upload capacity is busy. Wait briefly before trying again.",
  UPLOAD_CANARY_BUSY: "Upload capacity is busy. Wait briefly before trying again.",
  VIDEO_TOO_LARGE: "This file is larger than the upload limit shown below. Choose a smaller file.",
  INVALID_RESPONSE:
    "The upload result could not be verified. Check saved uploads in Studio before trying again.",
  UNCERTAIN:
    "The upload result could not be verified. Check saved uploads in Studio before trying again.",
} as const;

const otherMessages = {
  UPLOAD_FILE_CHANGED:
    "This is not the original video. Reselect the exact original file to resume the saved upload.",
  SAVED_UPLOAD_EXISTS: "A saved upload is waiting. Resume it below before starting another video.",
  STORAGE_UNAVAILABLE:
    "This browser cannot save upload recovery details. Allow site storage, then choose the video again.",
  AUTHORITY_CHANGED:
    "Sign in to the account that started this upload, then check the saved upload.",
  AUTHORITY_UNVERIFIED:
    "Your current account could not be verified. Check your connection and sign in again.",
  EXPIRED: "This saved upload has expired. Review it in Studio before starting another upload.",
  UPLOAD_RECOVERY_EXPIRED:
    "This saved upload has expired. Review it in Studio before starting another upload.",
  UPLOAD_NETWORK_FAILED:
    "The connection or upload stalled after four attempts. Check your connection, then retry; saved parts will be reused.",
  UPLOAD_STORAGE_REJECTED:
    "Storage rejected this upload. Retry to request a new connection; if it still fails, review the upload in Studio.",
  UPLOAD_ALREADY_ACCEPTED:
    "The upload was already accepted. Review or remove the saved video in Studio.",
} as const;

export function uploadRecoveryDiagnostic(code: string) {
  const reference = Object.hasOwn(referencedMessages, code)
    ? (code as keyof typeof referencedMessages)
    : null;
  return {
    reference,
    detail: reference
      ? referencedMessages[reference]
      : Object.hasOwn(otherMessages, code)
        ? otherMessages[code as keyof typeof otherMessages]
        : "The transfer needs checking. Retry will inspect the saved parts and continue this same video.",
  };
}

const stageLabels = {
  LOCAL_PREFLIGHT: "Local file checks",
  LOCAL_METADATA: "Local video metadata",
  RECOVERY_CHECK: "Upload recovery checks",
  SOURCE_HASH: "Local source hashing",
  LOCAL_SETUP: "Local upload setup",
  SERVER_INIT: "Server initialization / reservation",
} as const;
export type UploadDiagnosticStage = keyof typeof stageLabels;

const clientErrorNames = [
  "Error",
  "TypeError",
  "RangeError",
  "AbortError",
  "NotReadableError",
  "NotFoundError",
  "SecurityError",
  "QuotaExceededError",
  "InvalidStateError",
  "DataCloneError",
  "NetworkError",
  "TimeoutError",
  "UploadProtocolError",
] as const;
export type UploadClientErrorName = (typeof clientErrorNames)[number];
export type UploadFailureContext = {
  stage: UploadDiagnosticStage | null;
  clientErrorName: UploadClientErrorName | null;
};

export function uploadDiagnosticStage(value: unknown) {
  return typeof value === "string" && Object.hasOwn(stageLabels, value)
    ? (value as UploadDiagnosticStage)
    : null;
}
export function uploadDiagnosticStageLabel(value: unknown) {
  const stage = uploadDiagnosticStage(value);
  return stage ? stageLabels[stage] : null;
}
export function uploadClientErrorName(value: unknown): UploadClientErrorName | null {
  return clientErrorNames.find((name) => name === value) ?? null;
}

/** In-memory display metadata only. Never copy error messages, stacks or server payloads. */
export function uploadFailureContext(stage: unknown, error?: unknown): UploadFailureContext {
  let name: unknown;
  try {
    if (
      error instanceof Error ||
      (typeof DOMException !== "undefined" && error instanceof DOMException)
    )
      name = error.name;
  } catch {
    // A custom error accessor must not interfere with failure handling.
  }
  return { stage: uploadDiagnosticStage(stage), clientErrorName: uploadClientErrorName(name) };
}
