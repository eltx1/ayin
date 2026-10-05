import { apiBaseUrl, readApiError } from "./api";

export interface MfaStatus {
  accountId: string;
  enabled: boolean;
  required: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
}
export interface MfaEnrollment {
  accountId: string;
  enrollmentToken: string;
  qrCodeDataUrl: string;
  secret: string;
  expiresAt: string;
}
export class MfaRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid MFA response.");
  return value as Record<string, unknown>;
}
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function accountId(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) throw new Error("Invalid MFA account.");
  return value;
}
export function parseMfaStatus(value: unknown): MfaStatus {
  const data = record(value);
  if (
    typeof data.enabled !== "boolean" ||
    typeof data.required !== "boolean" ||
    typeof data.recoveryCodesRemaining !== "number" ||
    !Number.isInteger(data.recoveryCodesRemaining) ||
    data.recoveryCodesRemaining < 0 ||
    data.recoveryCodesRemaining > 10 ||
    !(
      data.enabledAt === null ||
      (typeof data.enabledAt === "string" && Number.isFinite(Date.parse(data.enabledAt)))
    )
  )
    throw new Error("Invalid MFA status.");
  return {
    accountId: accountId(data.accountId),
    enabled: data.enabled,
    required: data.required,
    enabledAt: data.enabledAt as string | null,
    recoveryCodesRemaining: data.recoveryCodesRemaining,
  };
}
export function parseMfaEnrollment(value: unknown, expectedAccountId: string): MfaEnrollment {
  const data = record(value);
  if (accountId(data.accountId) !== expectedAccountId)
    throw new MfaRequestError(
      "Your signed-in account changed. Reload this page.",
      409,
      "ACCOUNT_CHANGED",
    );
  if (
    typeof data.enrollmentToken !== "string" ||
    data.enrollmentToken.length < 32 ||
    typeof data.qrCodeDataUrl !== "string" ||
    !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.qrCodeDataUrl) ||
    typeof data.secret !== "string" ||
    !/^[A-Z2-7]{16,128}$/.test(data.secret) ||
    typeof data.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(data.expiresAt))
  )
    throw new Error("Invalid MFA enrollment response.");
  return {
    accountId: expectedAccountId,
    enrollmentToken: data.enrollmentToken,
    qrCodeDataUrl: data.qrCodeDataUrl,
    secret: data.secret,
    expiresAt: data.expiresAt,
  };
}
export function parseMfaCodes(value: unknown, expectedAccountId: string): string[] {
  const data = record(value);
  const owner = data.accountId ?? record(record(data.user).account).id;
  if (accountId(owner) !== expectedAccountId)
    throw new MfaRequestError(
      "Your signed-in account changed. Reload this page.",
      409,
      "ACCOUNT_CHANGED",
    );
  if (
    !Array.isArray(data.recoveryCodes) ||
    data.recoveryCodes.length !== 10 ||
    !data.recoveryCodes.every(
      (code): code is string =>
        typeof code === "string" && /^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/.test(code),
    ) ||
    new Set(data.recoveryCodes).size !== 10
  )
    throw new Error("Invalid recovery-code response.");
  return data.recoveryCodes;
}
export function parseMfaDisabled(value: unknown): { disabled: true } {
  if (record(value).disabled !== true) throw new Error("Invalid MFA disable acknowledgment.");
  return { disabled: true };
}
export async function requestMfa(
  path: string,
  signal: AbortSignal,
  body?: Record<string, unknown>,
  expectedAccountId?: string,
): Promise<unknown> {
  const response = await fetch(`${apiBaseUrl}/auth/mfa/${path}`, {
    method: body ? "POST" : "GET",
    credentials: "include",
    cache: "no-store",
    signal,
    ...(body || expectedAccountId
      ? {
          headers: {
            ...(body ? { "content-type": "application/json" } : {}),
            ...(expectedAccountId ? { "x-ayin-expected-account": expectedAccountId } : {}),
          },
        }
      : {}),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const error = (await response
      .clone()
      .json()
      .catch(() => null)) as { error?: { code?: string } } | null;
    throw new MfaRequestError(await readApiError(response), response.status, error?.error?.code);
  }
  return response.json();
}
