import { AccountScopeError, requestAccountScope } from "./account-scope";

export interface QuickUploadPolicy {
  maxFileSizeBytes: number;
  sessionLifetimeSeconds: number;
  reloadResumeSupported: false;
}

export function parseQuickUploadPolicy(value: unknown): QuickUploadPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AccountScopeError(0, "INVALID_RESPONSE");
  const policy = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(policy.maxFileSizeBytes) ||
    (policy.maxFileSizeBytes as number) <= 0 ||
    !Number.isSafeInteger(policy.sessionLifetimeSeconds) ||
    (policy.sessionLifetimeSeconds as number) <= 0 ||
    policy.reloadResumeSupported !== false
  )
    throw new AccountScopeError(0, "INVALID_RESPONSE");
  return {
    maxFileSizeBytes: policy.maxFileSizeBytes as number,
    sessionLifetimeSeconds: policy.sessionLifetimeSeconds as number,
    reloadResumeSupported: false,
  };
}

export async function readQuickUploadPolicy(accountId: string, signal: AbortSignal) {
  const result = await requestAccountScope("/media/uploads/policy", "GET", parseQuickUploadPolicy, {
    expectedAccountId: accountId,
    signal,
    maxResponseBytes: 4096,
  });
  return result.value;
}
