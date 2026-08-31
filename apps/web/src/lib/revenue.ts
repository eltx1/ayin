import { apiBaseUrl, readApiError } from "./api";

export type PayoutProvider = "MANUAL" | "BANK_TRANSFER" | "PAYPAL" | "PAYONEER" | "WISE";

export interface CreatorPaymentProfile {
  id: string;
  channelId: string;
  legalName: string;
  preferredCurrency: string;
  provider: PayoutProvider;
  destinationMask: string | null;
  countryCode: string | null;
  identityStatus: "NOT_STARTED" | "PENDING" | "VERIFIED" | "REJECTED";
  taxStatus: "NOT_PROVIDED" | "PENDING" | "VERIFIED" | "REQUIRES_ACTION";
  hasDestination: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RevenueDispute {
  id: string;
  channelId: string;
  payoutId: string | null;
  category: "EARNINGS" | "PAYOUT" | "OTHER";
  message: string;
  status: "OPEN" | "REVIEWING" | "RESOLVED" | "REJECTED";
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface CreatorRevenueOverview {
  channel: { id: string; name: string; handle: string };
  contract: {
    source: "CHANNEL_OVERRIDE" | "ADMIN_DEFAULT";
    contractId: string | null;
    revenueShareBps: number;
    effectiveFrom: string | null;
    effectiveTo: string | null;
  };
  currency: string;
  estimatedRevenue: string;
  finalizedRevenue: string;
  availableForPayout: string;
  onHoldForPayout: string;
  payoutThreshold: string;
  payoutProgressPercent: number;
  canRequestPayout: boolean;
  payoutReadiness: {
    profileReady: boolean;
    thresholdMet: boolean;
    openPayout: boolean;
    providerReady: boolean;
  };
  paymentProfile: CreatorPaymentProfile | null;
  providerConnection: {
    activeProvider: "MANUAL";
    manualPayoutEnabled: boolean;
    externalProvidersConnected: boolean;
  };
  byVideo: Array<{ videoId: string; title: string; estimated: string; finalized: string }>;
  byPeriod: Array<{ period: string; estimated: string; finalized: string }>;
  recentLedger: Array<{
    id: string;
    state: string;
    type: string;
    amount: string;
    currency: string;
    memo: string | null;
    occurredAt: string;
    video: { title: string; slug: string } | null;
  }>;
  payouts: Array<{
    id: string;
    status: string;
    amount: string;
    currency: string;
    requestedAt: string;
    processedAt: string | null;
    paidAt: string | null;
  }>;
}

export interface AdminRevenueSettings {
  defaultCreatorRevenueShareBps: number;
  payoutThresholdMicros: string;
}

export interface AdminRevenueDispute extends RevenueDispute {
  channelName: string;
  channelHandle: string;
  creatorEmail: string;
  payoutAmount: string | null;
  payoutCurrency: string | null;
  payoutStatus: string | null;
}

async function revenueFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return (await response.json()) as T;
}

export function getCreatorRevenue() {
  return revenueFetch<CreatorRevenueOverview>("/creator/studio/revenue");
}

export function getCreatorPaymentProfile() {
  return revenueFetch<CreatorPaymentProfile | null>("/creator/studio/revenue/payment-profile");
}

export function updateCreatorPaymentProfile(input: {
  legalName: string;
  preferredCurrency: string;
  provider: PayoutProvider;
  destination?: string;
  countryCode?: string | null;
}) {
  return revenueFetch<CreatorPaymentProfile>("/creator/studio/revenue/payment-profile", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function requestCreatorPayout(currency?: string) {
  return revenueFetch<{ payout: { id: string; status: string; amount: string; currency: string } }>(
    "/creator/studio/revenue/payout-requests",
    {
      method: "POST",
      body: JSON.stringify(currency ? { currency } : {}),
    },
  );
}

export function getCreatorRevenueDisputes() {
  return revenueFetch<{ items: RevenueDispute[] }>("/creator/studio/revenue/disputes");
}

export function createCreatorRevenueDispute(input: {
  category: "EARNINGS" | "PAYOUT" | "OTHER";
  payoutId?: string | null;
  message: string;
}) {
  return revenueFetch<RevenueDispute>("/creator/studio/revenue/disputes", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getAdminRevenueSettings() {
  return revenueFetch<AdminRevenueSettings>("/admin/revenue/settings");
}

export function updateAdminRevenueSettings(settings: AdminRevenueSettings) {
  return revenueFetch<AdminRevenueSettings>("/admin/revenue/settings", {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}

export function getAdminLedger(params = new URLSearchParams()) {
  const suffix = params.size ? `?${params.toString()}` : "";
  return revenueFetch<{
    items: Array<{
      id: string;
      channelId: string;
      state: string;
      type: string;
      amount: string;
      grossAmount: string | null;
      currency: string;
      memo: string | null;
      adSource: string | null;
      periodStart: string | null;
      periodEnd: string | null;
      occurredAt: string;
      channel: { name: string; handle: string };
      video: { title: string; slug: string } | null;
      campaign: { name: string } | null;
      payout: { id: string; status: string } | null;
    }>;
    pagination: { total: number; page: number; take: number; pages: number };
  }>(`/admin/revenue/ledger${suffix}`);
}

export function addRevenueAdjustment(input: {
  channelId: string;
  amount: string;
  currency: string;
  reason: string;
}) {
  return revenueFetch("/admin/revenue/adjustments", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createChannelContract(
  channelId: string,
  input: { revenueShareBps: number; effectiveFrom: string; termsVersion?: string },
) {
  return revenueFetch(`/admin/revenue/channels/${encodeURIComponent(channelId)}/contracts`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getAdminPayouts(params = new URLSearchParams()) {
  const suffix = params.size ? `?${params.toString()}` : "";
  return revenueFetch<{
    items: Array<{
      id: string;
      status: string;
      amount: string;
      currency: string;
      externalReference?: string | null;
      failureReason?: string | null;
      requestedAt: string;
      processedAt?: string | null;
      paidAt?: string | null;
      channel: { id?: string; name: string; handle: string };
    }>;
    pagination?: { total: number; page: number; take: number; pages: number };
  }>(`/admin/revenue/payouts${suffix}`);
}

export function updatePayoutStatus(
  payoutId: string,
  status: "PROCESSING" | "PAID" | "FAILED" | "CANCELLED",
  reason: string,
  details?: { externalReference?: string | null; failureReason?: string | null },
) {
  return revenueFetch(`/admin/revenue/payouts/${encodeURIComponent(payoutId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status, reason, ...details }),
  });
}

export function getAdminFinanceSummary() {
  return revenueFetch<{
    pendingPayouts: number;
    processingPayouts: number;
    openDisputes: number;
    pendingValue: Array<{ currency: string; amount: string }>;
    mode: "MANUAL_PAYOUT";
    externalProvidersConnected: false;
  }>("/admin/revenue/finance-summary");
}

export function getAdminRevenueDisputes(status?: string) {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
  return revenueFetch<AdminRevenueDispute[]>(`/admin/revenue/disputes${suffix}`);
}

export function updateAdminRevenueDispute(
  disputeId: string,
  input: {
    status: "OPEN" | "REVIEWING" | "RESOLVED" | "REJECTED";
    resolution?: string | null;
    reason: string;
  },
) {
  return revenueFetch<RevenueDispute>(`/admin/revenue/disputes/${encodeURIComponent(disputeId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
