import { apiBaseUrl, readApiError } from "./api";

export interface PayoutProviderCapabilities {
  provider: string;
  connected: boolean;
  productionEnabled: boolean;
  idempotentSubmission: boolean;
  supportsCancellation: boolean;
  supportsDestinationTokenization: boolean;
  webhookVerification: "CRYPTOGRAPHIC" | "UNSUPPORTED";
  retryPolicy: {
    maxSubmissionAttempts: number;
    baseDelaySeconds: number;
    maxDelaySeconds: number;
    sameIdempotencyKeyAcrossRetries: boolean;
  };
  paidConfirmation: "STATUS_OR_VERIFIED_WEBHOOK_ONLY";
  rawBankSecretsSentByThisAdapter: false;
}

export interface PayoutProviderTransferView {
  payout: {
    id: string;
    provider: string;
    status: string;
    amount: string;
    currency: string;
    externalReference: string | null;
  };
  transfer: {
    id: string;
    state: string;
    externalTransferId: string | null;
    providerResponseState: string | null;
    submitAttempts: number;
    statusAttempts: number;
    cancelAttempts: number;
    nextRetryAt: string | null;
  } | null;
  capabilities: PayoutProviderCapabilities;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as T;
}

export function getPayoutProviderCapabilities() {
  return request<PayoutProviderCapabilities>("/admin/revenue/payout-provider/capabilities");
}

export function getPayoutProviderTransfer(payoutId: string) {
  return request<PayoutProviderTransferView>(
    `/admin/revenue/payouts/${encodeURIComponent(payoutId)}/provider`,
  );
}

export function submitPayoutToProvider(payoutId: string, reason: string) {
  return request<PayoutProviderTransferView>(
    `/admin/revenue/payouts/${encodeURIComponent(payoutId)}/provider/submit`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}

export function refreshPayoutProviderStatus(payoutId: string, reason: string) {
  return request<PayoutProviderTransferView>(
    `/admin/revenue/payouts/${encodeURIComponent(payoutId)}/provider/status`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}

export function cancelPayoutAtProvider(payoutId: string, reason: string) {
  return request<PayoutProviderTransferView>(
    `/admin/revenue/payouts/${encodeURIComponent(payoutId)}/provider/cancel`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}
