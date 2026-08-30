import { apiBaseUrl, readApiError } from "./api";

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
  byVideo: Array<{ videoId: string; title: string; estimated: string; finalized: string }>;
  byPeriod: Array<{ period: string; estimated: string; finalized: string }>;
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

export function getAdminPayouts() {
  return revenueFetch<{
    items: Array<{
      id: string;
      status: string;
      amount: string;
      currency: string;
      requestedAt: string;
      channel: { name: string; handle: string };
    }>;
  }>("/admin/revenue/payouts");
}

export function updatePayoutStatus(
  payoutId: string,
  status: "PROCESSING" | "PAID" | "FAILED" | "CANCELLED",
  reason: string,
) {
  return revenueFetch(`/admin/revenue/payouts/${encodeURIComponent(payoutId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status, reason }),
  });
}
