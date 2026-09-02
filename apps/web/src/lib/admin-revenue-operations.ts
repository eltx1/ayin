import { apiBaseUrl, readApiError } from "./api";

export interface AdminChannelContract {
  id: string;
  channelId: string;
  status: "PENDING" | "ACTIVE" | "SUSPENDED" | "ENDED";
  revenueShareBps: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  termsVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminRevenueImportInput {
  source: string;
  entries: Array<{
    idempotencyKey: string;
    channelId: string;
    periodStart: string;
    periodEnd: string;
    grossAmount: string;
    currency: string;
    state: "ESTIMATED" | "FINAL";
    adSource?: string | null;
    memo?: string | null;
  }>;
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

export function getAdminChannelContracts(channelId: string) {
  return request<{ defaultRevenueShareBps: number; contracts: AdminChannelContract[] }>(
    `/admin/revenue/channels/${encodeURIComponent(channelId)}/contracts`,
  );
}

export function importAdminRevenue(input: AdminRevenueImportInput) {
  return request<{ created: number; duplicates: number; requested: number }>(
    "/admin/revenue/imports",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function createAdminPayout(channelId: string, currency: string) {
  return request<{ id: string; status: string; amount: string; currency: string }>(
    "/admin/revenue/payouts",
    {
      method: "POST",
      body: JSON.stringify({ channelId, currency }),
    },
  );
}
