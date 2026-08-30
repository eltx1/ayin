import { Inject, Injectable } from "@nestjs/common";

import { AdvertisingControlService } from "./advertising-control.service.js";
import { loadGamProductionConfig, type GamProductionConfig } from "./gam-production.config.js";

export const GAM_PRODUCTION_CONFIG = Symbol("GAM_PRODUCTION_CONFIG");

export type GamConsentMode = "PERSONALIZED" | "NON_PERSONALIZED" | "LIMITED_ADS";

export interface GamRequestContext {
  channelId?: string | null;
  videoId?: string | null;
  deviceClass: "MOBILE" | "TABLET" | "DESKTOP" | "TV" | "UNKNOWN";
  sessionId: string;
  consentMode: GamConsentMode;
  childDirected?: boolean;
  underAgeOfConsent?: boolean;
}

@Injectable()
export class GamProductionService {
  constructor(
    @Inject(GAM_PRODUCTION_CONFIG) private readonly config: GamProductionConfig,
    @Inject(AdvertisingControlService) private readonly advertising: AdvertisingControlService,
  ) {}

  async diagnostics() {
    const emergencyKillSwitch = await this.advertising.isEmergencyKilled();
    const missing = [
      ["GAM_NETWORK_CODE", this.config.networkCode],
      ["GAM_PUBLISHER_ID", this.config.publisherId],
      ["GAM_VIDEO_AD_UNIT_PATH", this.config.videoAdUnitPath],
      ["GAM_DISPLAY_AD_UNIT_PREFIX", this.config.displayAdUnitPrefix],
      ["GAM_ADS_TXT_RELATIONSHIP", this.config.adsTxtRelationship],
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key);

    return {
      provider: "GOOGLE_AD_MANAGER" as const,
      configured: this.config.complete,
      productionEnabled: this.config.productionEnabled,
      testMode: this.config.testMode,
      emergencyKillSwitch,
      missing,
      networkCode: mask(this.config.networkCode),
      publisherId: maskPublisher(this.config.publisherId),
      videoAdUnitConfigured: Boolean(this.config.videoAdUnitPath),
      displayAdUnitPrefixConfigured: Boolean(this.config.displayAdUnitPrefix),
      adsTxtConfigured: Boolean(this.config.publisherId && this.config.adsTxtRelationship),
      readyForLiveRequests:
        this.config.complete &&
        this.config.productionEnabled &&
        !this.config.testMode &&
        !emergencyKillSwitch,
    };
  }

  async buildClientConfiguration(context: GamRequestContext) {
    const killed = await this.advertising.isEmergencyKilled();
    if (killed) return { enabled: false as const, reason: "EMERGENCY_KILL_SWITCH" as const };
    if (!this.config.complete) return { enabled: false as const, reason: "GAM_CONFIG_INCOMPLETE" as const };
    if (!this.config.productionEnabled && !this.config.testMode)
      return { enabled: false as const, reason: "GAM_DISABLED" as const };

    const targeting: Record<string, string> = {
      ayin_device: context.deviceClass.toLowerCase(),
      ayin_session: context.sessionId,
      ayin_privacy: context.consentMode.toLowerCase(),
    };
    if (context.channelId) targeting.ayin_channel = context.channelId;
    if (context.videoId) targeting.ayin_video = context.videoId;

    return {
      enabled: true as const,
      testMode: this.config.testMode,
      networkCode: this.config.networkCode,
      videoAdUnitPath: this.config.videoAdUnitPath,
      displayAdUnitPrefix: this.config.displayAdUnitPrefix,
      privacy: {
        nonPersonalizedAds: context.consentMode !== "PERSONALIZED",
        limitedAds: context.consentMode === "LIMITED_ADS",
        childDirectedTreatment: context.childDirected ?? false,
        underAgeOfConsent: context.underAgeOfConsent ?? false,
      },
      imaParameters: {
        ...(context.consentMode !== "PERSONALIZED" ? { npa: "1" } : {}),
        ...(context.underAgeOfConsent ? { tfua: "1" } : {}),
      },
      targeting,
      reporting: {
        sessionId: context.sessionId,
        channelId: context.channelId ?? null,
        videoId: context.videoId ?? null,
      },
    };
  }

  authorizedSellerRows() {
    if (!this.config.publisherId || !this.config.adsTxtRelationship) return [];
    return [
      `google.com, ${this.config.publisherId}, ${this.config.adsTxtRelationship}, f08c47fec0942fa0`,
    ];
  }
}

export function createGamProductionConfig(): GamProductionConfig {
  return loadGamProductionConfig();
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
