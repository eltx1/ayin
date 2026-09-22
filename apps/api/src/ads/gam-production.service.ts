import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { AdvertisingControlService } from "./advertising-control.service.js";
import { loadGamProductionConfig, type GamProductionConfig } from "./gam-production.config.js";

export const GAM_PRODUCTION_CONFIG = Symbol("GAM_PRODUCTION_CONFIG");

export type GamConsentMode = "PERSONALIZED" | "NON_PERSONALIZED" | "LIMITED_ADS";
export type GamVideoSlot = "PRE_ROLL" | "MID_ROLL" | "POST_ROLL";

export interface GamRequestContext {
  channelId?: string | null;
  videoId?: string | null;
  deviceClass: "MOBILE" | "TABLET" | "DESKTOP" | "TV" | "UNKNOWN";
  consentMode: GamConsentMode;
  childDirected?: boolean;
  underAgeOfConsent?: boolean;
}

type RuntimeHealth = "NO_DATA" | "HEALTHY" | "DEGRADED" | "INDETERMINATE";

type RuntimeEvent = {
  eventType: string;
  metadata: unknown;
  occurredAt: Date;
};

export interface GamRuntimeProviderDiagnostics {
  health: RuntimeHealth;
  requests: number;
  fills: number;
  noFill: number;
  technicalErrors: number;
  ambiguousEmpty: number;
  lastErrorCode: string | null;
  lastEventAt: string | null;
}

@Injectable()
export class GamProductionService {
  constructor(
    @Inject(GAM_PRODUCTION_CONFIG) private readonly config: GamProductionConfig,
    @Inject(AdvertisingControlService)
    private readonly advertising: AdvertisingControlService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async diagnostics() {
    const [emergencyKillSwitch, runtime] = await Promise.all([
      this.advertising.isEmergencyKilled(),
      this.runtimeDiagnostics(),
    ]);
    const missing = [
      ["GAM_NETWORK_CODE", this.config.networkCode],
      ["GAM_PUBLISHER_ID", this.config.publisherId],
      ["GAM_VIDEO_AD_UNIT_PATH", this.config.videoAdUnitPath],
      ["GAM_DISPLAY_AD_UNIT_PREFIX", this.config.displayAdUnitPrefix],
      ["GAM_ADS_TXT_RELATIONSHIP", this.config.adsTxtRelationship],
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key);
    const killed = emergencyKillSwitch || this.config.killSwitch;
    const requestEnabled =
      this.config.complete && (this.config.productionEnabled || this.config.testMode) && !killed;

    return {
      provider: "GOOGLE_AD_MANAGER" as const,
      adapterStatus: !this.config.complete
        ? ("UNCONFIGURED" as const)
        : killed
          ? ("KILLED" as const)
          : this.config.productionEnabled
            ? ("PRODUCTION" as const)
            : this.config.testMode
              ? ("TEST" as const)
              : ("DISABLED" as const),
      configured: this.config.complete,
      productionEnabled: this.config.productionEnabled,
      testMode: this.config.testMode,
      adapterKillSwitch: this.config.killSwitch,
      emergencyKillSwitch,
      missing,
      networkCode: mask(this.config.networkCode),
      publisherId: maskPublisher(this.config.publisherId),
      networkConfigured: Boolean(this.config.networkCode),
      videoAdUnitConfigured: Boolean(this.config.videoAdUnitPath),
      displayAdUnitPrefixConfigured: Boolean(this.config.displayAdUnitPrefix),
      adsTxtConfigured: Boolean(this.config.publisherId && this.config.adsTxtRelationship),
      requestEnabled,
      readyForLiveRequests:
        this.config.complete && this.config.productionEnabled && !this.config.testMode && !killed,
      runtimeWindowMinutes: 60,
      runtime,
    };
  }

  async productionRequestState() {
    const emergencyKillSwitch = await this.advertising.isEmergencyKilled();
    if (emergencyKillSwitch) {
      return { enabled: false as const, reason: "EMERGENCY_KILL_SWITCH" as const };
    }
    if (this.config.killSwitch) {
      return { enabled: false as const, reason: "GAM_KILL_SWITCH" as const };
    }
    if (!this.config.complete) {
      return { enabled: false as const, reason: "GAM_CONFIG_INCOMPLETE" as const };
    }
    if (!this.config.productionEnabled || this.config.testMode) {
      return { enabled: false as const, reason: "GAM_PRODUCTION_NOT_READY" as const };
    }
    return { enabled: true as const };
  }

  async requestState() {
    const emergencyKillSwitch = await this.advertising.isEmergencyKilled();
    if (emergencyKillSwitch) {
      return { enabled: false as const, reason: "EMERGENCY_KILL_SWITCH" as const };
    }
    if (this.config.killSwitch) {
      return { enabled: false as const, reason: "GAM_KILL_SWITCH" as const };
    }
    if (!this.config.complete) {
      return { enabled: false as const, reason: "GAM_CONFIG_INCOMPLETE" as const };
    }
    if (!this.config.productionEnabled && !this.config.testMode) {
      return { enabled: false as const, reason: "GAM_DISABLED" as const };
    }
    return { enabled: true as const, testMode: this.config.testMode };
  }

  async buildClientConfiguration(context: GamRequestContext) {
    const state = await this.requestState();
    if (!state.enabled) return state;

    return {
      enabled: true as const,
      testMode: this.config.testMode,
      networkCode: this.config.networkCode,
      videoAdUnitPath: this.config.videoAdUnitPath,
      displayAdUnitPrefix: this.config.displayAdUnitPrefix,
      privacy: {
        mode: context.consentMode,
        nonPersonalizedAds: context.consentMode !== "PERSONALIZED",
        limitedAds: context.consentMode === "LIMITED_ADS",
        childDirectedTreatment: context.childDirected ?? false,
        underAgeOfConsent: context.underAgeOfConsent ?? false,
      },
      imaParameters: {
        ...(context.consentMode === "NON_PERSONALIZED" ? { npa: "1" } : {}),
        ...(context.consentMode === "LIMITED_ADS" ? { ltd: "1" } : {}),
        ...(context.underAgeOfConsent ? { tfua: "1" } : {}),
      },
      // User/session/account identifiers are intentionally excluded. Google can infer the
      // device class itself and AYIN does not require custom profile targeting for Task 68.
      targeting: {} as Record<string, string>,
    };
  }

  async buildVideoTagUrl(input: { descriptionUrl: string; slot: GamVideoSlot }) {
    const state = await this.requestState();
    if (!state.enabled || !this.config.videoAdUnitPath) return null;
    return buildGamVideoTagUrl(this.config, input.descriptionUrl, input.slot);
  }

  isDisplayAdUnitAllowed(adUnitPath: string) {
    return isConfiguredDisplayAdUnitPath(this.config, adUnitPath);
  }

  authorizedSellerRows() {
    return configuredGoogleSellerRows(this.config);
  }

  private async runtimeDiagnostics() {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const events = await this.database.client.adEvent.findMany({
      where: { occurredAt: { gte: since } },
      orderBy: { occurredAt: "desc" },
      take: 2000,
      select: { eventType: true, metadata: true, occurredAt: true },
    });
    return classifyGamRuntimeEvents(events);
  }
}

export function createGamProductionConfig(): GamProductionConfig {
  return loadGamProductionConfig();
}

export function buildGamVideoTagUrl(
  config: GamProductionConfig,
  descriptionUrl: string,
  slot: GamVideoSlot,
) {
  if (!config.videoAdUnitPath) return null;
  const url = new URL("https://securepubads.g.doubleclick.net/gampad/ads");
  url.searchParams.set("iu", config.videoAdUnitPath);
  url.searchParams.set("sz", "640x360");
  url.searchParams.set("env", "vp");
  url.searchParams.set("gdfp_req", "1");
  url.searchParams.set("output", "xml_vast4");
  url.searchParams.set(
    "vpos",
    slot === "PRE_ROLL" ? "preroll" : slot === "MID_ROLL" ? "midroll" : "postroll",
  );
  url.searchParams.set("description_url", descriptionUrl);
  if (config.testMode) url.searchParams.set("adtest", "on");
  return url.toString();
}

export function isConfiguredDisplayAdUnitPath(config: GamProductionConfig, adUnitPath: string) {
  const prefix = config.displayAdUnitPrefix?.replace(/\/$/u, "");
  if (!prefix) return false;
  return adUnitPath === prefix || adUnitPath.startsWith(`${prefix}/`);
}

export function configuredGoogleSellerRows(config: GamProductionConfig) {
  if (!config.publisherId || !config.adsTxtRelationship) return [];
  // The certification-authority field is optional. AYIN publishes only values explicitly
  // configured for the real seller account instead of fabricating a TAG ID.
  return [`google.com, ${config.publisherId}, ${config.adsTxtRelationship}`];
}

export function classifyGamRuntimeEvents(events: RuntimeEvent[]) {
  const ima = emptyRuntimeDiagnostics();
  const gpt = emptyRuntimeDiagnostics();

  for (const event of events) {
    const metadata = objectRecord(event.metadata);
    const provider = typeof metadata?.provider === "string" ? metadata.provider : null;
    const errorCode = typeof metadata?.errorCode === "string" ? metadata.errorCode : null;
    const target = provider === "GOOGLE_IMA" ? ima : provider === "GOOGLE_GPT" ? gpt : null;
    if (!target) continue;

    target.lastEventAt ??= event.occurredAt.toISOString();
    if (event.eventType === "REQUEST") target.requests += 1;
    if (event.eventType === "FILL") target.fills += 1;
    if (event.eventType !== "ERROR") continue;

    target.lastErrorCode ??= errorCode;
    if (provider === "GOOGLE_IMA" && errorCode?.startsWith("IMA_NO_FILL_")) {
      target.noFill += 1;
    } else if (provider === "GOOGLE_GPT" && errorCode === "GPT_EMPTY_OR_NETWORK_FAILURE") {
      target.ambiguousEmpty += 1;
    } else {
      target.technicalErrors += 1;
    }
  }

  return {
    ima: finalizeHealth(ima, "IMA"),
    gpt: finalizeHealth(gpt, "GPT"),
  };
}

function emptyRuntimeDiagnostics(): Omit<GamRuntimeProviderDiagnostics, "health"> {
  return {
    requests: 0,
    fills: 0,
    noFill: 0,
    technicalErrors: 0,
    ambiguousEmpty: 0,
    lastErrorCode: null,
    lastEventAt: null,
  };
}

function finalizeHealth(
  value: Omit<GamRuntimeProviderDiagnostics, "health">,
  provider: "IMA" | "GPT",
): GamRuntimeProviderDiagnostics {
  let health: RuntimeHealth = "NO_DATA";
  if (value.technicalErrors > 0 && value.fills === 0) health = "DEGRADED";
  else if (provider === "GPT" && value.ambiguousEmpty > 0 && value.fills === 0)
    health = "INDETERMINATE";
  else if (value.fills > 0 || value.noFill > 0 || value.requests > 0) health = "HEALTHY";
  return { health, ...value };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function mask(value: string | null) {
  if (!value) return null;
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function maskPublisher(value: string | null) {
  if (!value) return null;
  return `pub-************${value.slice(-4)}`;
}
