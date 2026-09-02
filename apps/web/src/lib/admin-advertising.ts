import { apiBaseUrl, readApiError } from "./api";

export type AdvertiserStatus = "ACTIVE" | "PAUSED" | "DISABLED";
export type CampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
export type CreativeStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "REJECTED" | "ARCHIVED";
export type CreativeType = "VIDEO" | "DISPLAY" | "NATIVE" | "VAST_TAG";
export type AdDevice = "MOBILE" | "DESKTOP" | "TV";

export interface AdPlacement {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
  inventoryFamily: "IN_PLAYER_VIDEO" | "OUTSIDE_PLAYER";
  format: "PRE_ROLL" | "MID_ROLL" | "POST_ROLL" | "DISPLAY" | "NATIVE";
  config: unknown;
}

export interface Advertiser {
  id: string;
  name: string;
  status: AdvertiserStatus;
}

export interface Campaign {
  id: string;
  advertiserId: string;
  name: string;
  status: CampaignStatus;
  startsAt: string | null;
  endsAt: string | null;
  budget: string | null;
  currency: string | null;
  advertiser: { name: string };
  direct: null | {
    priority: number;
    pricing: { model: "CPM"; cpm: string; fixedPrice: null } | { model: "FIXED"; cpm: null; fixedPrice: string };
    impressionGoal: number | null;
    frequencyCap: number;
    pacing: "EVEN" | "ASAP";
    targeting: {
      placementKeys?: string[];
      countries?: string[];
      regions?: string[];
      devices?: AdDevice[];
      categories?: string[];
      channelIds?: string[];
      videoIds?: string[];
    };
  };
}

export interface Creative {
  id: string;
  campaignId: string;
  mediaAssetId: string | null;
  name: string;
  type: CreativeType;
  status: CreativeStatus;
  destinationUrl: string | null;
  vastTagUrl: string | null;
  headline: string | null;
  body: string | null;
  direct: null | {
    assetUrl: string | null;
    width: number | null;
    height: number | null;
    approvedReference: string | null;
  };
}

export interface AdvertisingOverview {
  emergencyKillSwitch: boolean;
  placements: AdPlacement[];
  eventCounters: Record<string, number>;
}

export interface GamDiagnostics {
  provider: "GOOGLE_AD_MANAGER";
  configured: boolean;
  productionEnabled: boolean;
  testMode: boolean;
  emergencyKillSwitch: boolean;
  missing: string[];
  networkCode: string | null;
  publisherId: string | null;
  videoAdUnitConfigured: boolean;
  displayAdUnitPrefixConfigured: boolean;
  adsTxtConfigured: boolean;
  readyForLiveRequests: boolean;
}

export interface PageAdSettings {
  masterEnabled: boolean;
  googleGptEnabled: boolean;
  house: {
    imageUrl: string | null;
    clickUrl: string | null;
    altText: string | null;
  };
}

export interface SellerFile {
  kind: "ads" | "app-ads";
  manualText: string;
  automaticRows: string[];
  finalText: string;
}

export interface SellerFiles {
  ads: SellerFile;
  appAds: SellerFile;
}

export interface DirectCampaignInput {
  priority: number;
  pricing:
    | { model: "CPM"; cpm: string; fixedPrice: null }
    | { model: "FIXED"; cpm: null; fixedPrice: string };
  impressionGoal: number | null;
  frequencyCap: number;
  pacing: "EVEN" | "ASAP";
  targeting: {
    placementKeys: string[];
    countries: string[];
    regions: string[];
    devices: AdDevice[];
    categories: string[];
    channelIds: string[];
    videoIds: string[];
  };
}

export interface CampaignInput {
  advertiserId?: string;
  name: string;
  status: CampaignStatus;
  startsAt: string | null;
  endsAt: string | null;
  budget: string | null;
  currency: string | null;
  direct: DirectCampaignInput;
}

export interface CreativeInput {
  campaignId?: string;
  mediaAssetId?: string | null;
  name: string;
  type: CreativeType;
  status: CreativeStatus;
  destinationUrl: string | null;
  vastTagUrl: string | null;
  headline: string | null;
  body: string | null;
  direct: {
    assetUrl: string | null;
    width: number | null;
    height: number | null;
    approvedReference: string | null;
  };
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

export function getAdvertisingOverview() {
  return request<AdvertisingOverview>("/admin/advertising/overview");
}

export function setAdvertisingKillSwitch(enabled: boolean, reason: string) {
  return request<{ enabled: boolean }>("/admin/advertising/kill-switch", {
    method: "PATCH",
    body: JSON.stringify({ enabled, reason }),
  });
}

export function createAdPlacement(input: Omit<AdPlacement, "id">) {
  return request<AdPlacement>("/admin/advertising/placements", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAdPlacement(id: string, input: Partial<Omit<AdPlacement, "id">>) {
  return request<AdPlacement>(`/admin/advertising/placements/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function getAdvertisers() {
  return request<Advertiser[]>("/admin/advertising/advertisers");
}

export function createAdvertiser(input: { name: string; status: AdvertiserStatus }) {
  return request<Advertiser>("/admin/advertising/advertisers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAdvertiser(id: string, input: Partial<Omit<Advertiser, "id">>) {
  return request<Advertiser>(`/admin/advertising/advertisers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteAdvertiser(id: string) {
  return request(`/admin/advertising/advertisers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function getCampaigns() {
  return request<Campaign[]>("/admin/advertising/campaigns");
}

export function createCampaign(input: CampaignInput & { advertiserId: string }) {
  return request<Campaign>("/admin/advertising/campaigns", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateCampaign(id: string, input: Partial<Omit<CampaignInput, "advertiserId">>) {
  return request<Campaign>(`/admin/advertising/campaigns/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteCampaign(id: string) {
  return request(`/admin/advertising/campaigns/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function getCreatives(campaignId?: string) {
  const query = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : "";
  return request<Creative[]>(`/admin/advertising/creatives${query}`);
}

export function createCreative(input: CreativeInput & { campaignId: string }) {
  return request<Creative>("/admin/advertising/creatives", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateCreative(id: string, input: Partial<Omit<CreativeInput, "campaignId">>) {
  return request<Creative>(`/admin/advertising/creatives/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteCreative(id: string) {
  return request(`/admin/advertising/creatives/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function getGamDiagnostics() {
  return request<GamDiagnostics>("/admin/advertising/gam/diagnostics");
}

export function getSellerFiles() {
  return request<SellerFiles>("/admin/advertising/authorized-sellers");
}

export function saveSellerFile(kind: "ads" | "app-ads", text: string) {
  return request<SellerFile>(`/admin/advertising/authorized-sellers/${kind}`, {
    method: "PUT",
    body: JSON.stringify({
      text,
      reason: "Authorized seller file edited in Admin Advertising Control Center",
    }),
  });
}

export function getPageAdSettings() {
  return request<PageAdSettings>("/admin/page-ads/settings");
}

export function updatePageAdSettings(settings: PageAdSettings) {
  return request<PageAdSettings>("/admin/page-ads/settings", {
    method: "PATCH",
    body: JSON.stringify(settings),
  });
}
