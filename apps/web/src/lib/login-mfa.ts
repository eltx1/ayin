import { MfaRequestError } from "./account-mfa";

export function mustRestartMfa(cause: unknown): boolean {
  if (!(cause instanceof MfaRequestError)) return false;
  if (
    ["MFA_REQUEST_INVALID", "MFA_ENROLLMENT_CHANGED", "MFA_ALREADY_ENABLED"].includes(
      cause.code ?? "",
    )
  )
    return true;
  // Older API instances returned one generic code for both stale requests and
  // incorrect TOTP codes. Keep wrong codes retryable during rolling deployment.
  return cause.status === 401 && /MFA.*(?:invalid or expired|already enabled)/i.test(cause.message);
}

export function normalizeLoginMfaCode(value: string): string {
  const normalized = value
    .trim()
    .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) =>
      String(digit.charCodeAt(0) - (digit >= "\u06f0" ? 0x06f0 : 0x0660)),
    );
  const compact = normalized.replace(/\s/g, "");
  return /^\d{6}$/.test(compact) ? compact : normalized;
}
