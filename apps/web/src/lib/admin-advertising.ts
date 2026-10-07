import {
  parseDirectAdminSession,
  sameAdminSessionScope,
  type AdminScopeLease,
} from "./admin-session-scope";
import {
  AdminWorkspaceError,
  adminWorkspaceRequest,
  boundedAdminRequest,
  adminObject,
  adminText,
  adminId,
  adminRows,
  adminKnown,
  adminCount,
} from "./verified-admin-transport";

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
    pricing:
      | { model: "CPM"; cpm: string; fixedPrice: null }
      | { model: "FIXED"; cpm: null; fixedPrice: string };
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

const invalid = () => new AdminWorkspaceError();
function boolean(value: unknown) {
  if (typeof value !== "boolean") throw invalid();
  return value;
}
function nullableText(value: unknown) {
  if (value !== null) adminText(value, 100000);
}
function placement(value: unknown) {
  const r = adminObject(value);
  adminId(r.id);
  adminText(r.key, 120, 2);
  adminText(r.name, 160, 2);
  boolean(r.enabled);
  adminKnown(r.inventoryFamily, ["IN_PLAYER_VIDEO", "OUTSIDE_PLAYER"]);
  adminKnown(r.format, ["PRE_ROLL", "MID_ROLL", "POST_ROLL", "DISPLAY", "NATIVE"]);
  return r;
}
function creative(value: unknown, read: boolean) {
  const r = adminObject(value);
  adminId(r.id);
  adminId(r.campaignId);
  adminText(r.name, 160, 2);
  adminKnown(r.type, ["VIDEO", "DISPLAY", "NATIVE", "VAST_TAG"]);
  adminKnown(r.status, ["DRAFT", "ACTIVE", "PAUSED", "REJECTED", "ARCHIVED"]);
  for (const key of ["destinationUrl", "vastTagUrl", "headline", "body"]) nullableText(r[key]);
  if (read && r.direct !== null) {
    const d = adminObject(r.direct);
    nullableText(d.assetUrl);
    nullableText(d.approvedReference);
    for (const key of ["width", "height"]) if (d[key] !== null) adminCount(d[key], 4096);
  }
  return r;
}
function seller(value: unknown, kind: "ads" | "app-ads") {
  const r = adminObject(value);
  if (r.kind !== kind) throw invalid();
  adminText(r.manualText, 64 * 1024);
  adminText(r.finalText, 256 * 1024);
  adminRows(r.automaticRows, 10000, (row) => adminText(row, 10000));
  return r;
}
function pageSettings(value: unknown) {
  const r = adminObject(value),
    h = adminObject(r.house);
  boolean(r.masterEnabled);
  boolean(r.googleGptEnabled);
  for (const key of ["imageUrl", "clickUrl", "altText"]) nullableText(h[key]);
  return r;
}
function validateAdvertisingResponse(path: string, init: RequestInit | undefined, value: unknown) {
  const write = Boolean(init?.method);
  if (path.endsWith("/overview")) {
    const r = adminObject(value);
    boolean(r.emergencyKillSwitch);
    adminRows(r.placements, 1000000, placement);
    for (const count of Object.values(adminObject(r.eventCounters))) adminCount(count);
  } else if (path.endsWith("/gam/diagnostics")) {
    const r = adminObject(value);
    if (r.provider !== "GOOGLE_AD_MANAGER") throw invalid();
    for (const key of [
      "configured",
      "productionEnabled",
      "testMode",
      "emergencyKillSwitch",
      "videoAdUnitConfigured",
      "displayAdUnitPrefixConfigured",
      "adsTxtConfigured",
      "readyForLiveRequests",
    ])
      boolean(r[key]);
    nullableText(r.networkCode);
    nullableText(r.publisherId);
    adminRows(r.missing, 10000, (v) => adminText(v, 1000));
  } else if (path.endsWith("/kill-switch")) {
    if (adminObject(value).enabled !== JSON.parse(String(init?.body)).enabled) throw invalid();
  } else if (path.includes("/page-ads/settings")) {
    const r = pageSettings(value);
    if (write) {
      const input = JSON.parse(String(init?.body)) as PageAdSettings;
      const h = adminObject(r.house);
      if (
        r.masterEnabled !== input.masterEnabled ||
        r.googleGptEnabled !== input.googleGptEnabled ||
        h.imageUrl !== input.house.imageUrl ||
        h.clickUrl !== input.house.clickUrl ||
        h.altText !== (input.house.altText?.trim() ?? null)
      )
        throw invalid();
    }
  } else if (path.endsWith("/authorized-sellers")) {
    const r = adminObject(value);
    seller(r.ads, "ads");
    seller(r.appAds, "app-ads");
  } else if (path.includes("/authorized-sellers/")) {
    const r = seller(value, path.endsWith("/app-ads") ? "app-ads" : "ads");
    if (
      write &&
      r.manualText !==
        (JSON.parse(String(init?.body)).text as string).replace(/\r\n?/g, "\n").trim()
    )
      throw invalid();
  } else if (path.includes("/placements")) {
    const r = placement(value);
    if (init?.method === "PATCH" && r.id !== decodeURIComponent(path.split("/").at(-1)!))
      throw invalid();
    const input = JSON.parse(String(init?.body)) as Record<string, unknown>;
    for (const key of ["name", "key", "enabled", "format", "inventoryFamily"])
      if (input[key] !== undefined && r[key] !== input[key]) throw invalid();
  } else if (path.includes("/creatives")) {
    if (!write) adminRows(value, 1000000, (v) => creative(v, true));
    else if (init?.method === "DELETE") {
      const r = adminObject(value);
      if (
        r.deleted !== true &&
        (r.id !== decodeURIComponent(path.split("/").at(-1)!) || r.status !== "ARCHIVED")
      )
        throw invalid();
    } else {
      const r = creative(value, false);
      if (init?.method === "PATCH" && r.id !== decodeURIComponent(path.split("/").at(-1)!))
        throw invalid();
      const input = JSON.parse(String(init?.body)) as Record<string, unknown>;
      for (const key of [
        "name",
        "campaignId",
        "type",
        "status",
        "destinationUrl",
        "vastTagUrl",
        "headline",
        "body",
      ])
        if (
          input[key] !== undefined &&
          r[key] !==
            ((key === "name" || key === "headline" || key === "body") &&
            typeof input[key] === "string"
              ? input[key].trim()
              : input[key])
        )
          throw invalid();
    }
  } else if (path.endsWith("/campaigns") && !write) {
    adminRows(value, 1000000, (v) => {
      const r = adminObject(v);
      adminId(r.id);
      adminId(r.advertiserId);
      adminText(r.name, 160, 2);
      adminText(adminObject(r.advertiser).name, 160, 2);
      adminKnown(r.status, ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"]);
      return r;
    });
  } else if (value === null || typeof value !== "object") throw invalid();
}

export class AdvertisingRequestError extends AdminWorkspaceError {
  constructor(
    override readonly cause: unknown,
    readonly uncertain: boolean,
    readonly identityUnverified: boolean,
  ) {
    super(
      cause instanceof AdminWorkspaceError ? cause.status : 0,
      uncertain,
      cause instanceof AdminWorkspaceError && cause.verificationRequired,
      cause instanceof AdminWorkspaceError ? cause.code : "",
    );
  }
}
export type AdvertisingScope = {
  lease: AdminScopeLease;
  isCurrent: () => boolean;
  signal: AbortSignal;
};

// Every read and write belongs to the lease that opened this editor. Expected
// identity headers narrow the authenticated cookie; they never grant authority.
export function createAdvertisingClient(scope: AdvertisingScope) {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let started = false;
    let identityUnverified = false;
    try {
      return await boundedAdminRequest(scope.signal, 20000, async (signal) => {
        const current = () => {
          signal.throwIfAborted();
          if (!scope.isCurrent()) throw new AdminWorkspaceError(403);
        };
        const headers = {
          "x-ayin-expected-account": scope.lease.session.accountId,
          "x-ayin-expected-session": scope.lease.session.sessionId,
        };
        const verify = async () => {
          identityUnverified = true;
          current();
          const actor = parseDirectAdminSession(
            await adminWorkspaceRequest("/admin/session", signal, { headers }),
          );
          current();
          if (
            !sameAdminSessionScope(scope.lease.session, actor) ||
            !actor.roles.some((role) => ["SUPERADMIN", "ADMIN", "AD_MANAGER"].includes(role))
          )
            throw new AdminWorkspaceError(403);
          identityUnverified = false;
        };
        await verify();
        current();
        started = Boolean(init?.method);
        const result = await adminWorkspaceRequest(path, signal, {
          ...init,
          headers: { ...(init?.method ? { "content-type": "application/json" } : {}), ...headers },
        });
        await verify();
        current();
        // These legacy endpoints have no mutation receipts. A missing/malformed
        // response is an unknown write outcome, never a reason to resend.
        validateAdvertisingResponse(path, init, result);
        return result as T;
      });
    } catch (cause) {
      const rejected =
        cause instanceof AdminWorkspaceError &&
        cause.status >= 400 &&
        cause.status < 500 &&
        !identityUnverified &&
        // Legacy controllers collapse callback/Prisma failures, including an
        // unknown commit or post-commit seller snapshot, into these 400 codes.
        !(
          cause.status === 400 &&
          [
            "INVALID_ADVERTISING_MUTATION",
            "INVALID_PAGE_AD_SETTINGS",
            "INVALID_AUTHORIZED_SELLER_SYNTAX",
          ].includes(cause.code)
        );
      throw new AdvertisingRequestError(
        cause,
        started && !rejected,
        identityUnverified ||
          (cause instanceof AdminWorkspaceError &&
            !cause.verificationRequired &&
            ([401, 403].includes(cause.status) ||
              ["ACCOUNT_CHANGED", "SESSION_CHANGED"].includes(cause.code))),
      );
    }
  }
  function getAdvertisingOverview() {
    return request<AdvertisingOverview>("/admin/advertising/overview");
  }

  function setAdvertisingKillSwitch(enabled: boolean, reason: string) {
    return request<{ enabled: boolean }>("/admin/advertising/kill-switch", {
      method: "PATCH",
      body: JSON.stringify({ enabled, reason }),
    });
  }

  function createAdPlacement(input: Omit<AdPlacement, "id">) {
    return request<AdPlacement>("/admin/advertising/placements", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  function updateAdPlacement(id: string, input: Partial<Omit<AdPlacement, "id">>) {
    return request<AdPlacement>(`/admin/advertising/placements/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  function getAdvertisers() {
    return request<Advertiser[]>("/admin/advertising/advertisers");
  }

  function createAdvertiser(input: { name: string; status: AdvertiserStatus }) {
    return request<Advertiser>("/admin/advertising/advertisers", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  function updateAdvertiser(id: string, input: Partial<Omit<Advertiser, "id">>) {
    return request<Advertiser>(`/admin/advertising/advertisers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  function deleteAdvertiser(id: string) {
    return request(`/admin/advertising/advertisers/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: JSON.stringify({}),
    });
  }

  function getCampaigns() {
    return request<Campaign[]>("/admin/advertising/campaigns");
  }

  function createCampaign(input: CampaignInput & { advertiserId: string }) {
    return request<Campaign>("/admin/advertising/campaigns", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  function updateCampaign(id: string, input: Partial<Omit<CampaignInput, "advertiserId">>) {
    return request<Campaign>(`/admin/advertising/campaigns/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  function deleteCampaign(id: string) {
    return request(`/admin/advertising/campaigns/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: JSON.stringify({}),
    });
  }

  function getCreatives(campaignId?: string) {
    const query = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : "";
    return request<Creative[]>(`/admin/advertising/creatives${query}`);
  }

  function createCreative(input: CreativeInput & { campaignId: string }) {
    return request<Creative>("/admin/advertising/creatives", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  function updateCreative(id: string, input: Partial<Omit<CreativeInput, "campaignId">>) {
    return request<Creative>(`/admin/advertising/creatives/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  function deleteCreative(id: string) {
    return request(`/admin/advertising/creatives/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: JSON.stringify({}),
    });
  }

  function getGamDiagnostics() {
    return request<GamDiagnostics>("/admin/advertising/gam/diagnostics");
  }

  function getSellerFiles() {
    return request<SellerFiles>("/admin/advertising/authorized-sellers");
  }

  function saveSellerFile(kind: "ads" | "app-ads", text: string) {
    return request<SellerFile>(`/admin/advertising/authorized-sellers/${kind}`, {
      method: "PUT",
      body: JSON.stringify({
        text,
        reason: "Authorized seller file edited in Admin Advertising Control Center",
      }),
    });
  }

  function getPageAdSettings() {
    return request<PageAdSettings>("/admin/page-ads/settings");
  }

  function updatePageAdSettings(settings: PageAdSettings) {
    return request<PageAdSettings>("/admin/page-ads/settings", {
      method: "PATCH",
      body: JSON.stringify(settings),
    });
  }

  return {
    getAdvertisingOverview,
    setAdvertisingKillSwitch,
    createAdPlacement,
    updateAdPlacement,
    getAdvertisers,
    createAdvertiser,
    updateAdvertiser,
    deleteAdvertiser,
    getCampaigns,
    createCampaign,
    updateCampaign,
    deleteCampaign,
    getCreatives,
    createCreative,
    updateCreative,
    deleteCreative,
    getGamDiagnostics,
    getSellerFiles,
    saveSellerFile,
    getPageAdSettings,
    updatePageAdSettings,
  };
}
export type AdvertisingClient = ReturnType<typeof createAdvertisingClient>;
