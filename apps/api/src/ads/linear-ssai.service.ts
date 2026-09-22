import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import type {
  CreatorTvAdBreakContext,
  CreatorTvAdBreakHook,
  CreatorTvAdBreakMarker,
} from "../creator/creator-tv-ad-break.hook.js";
import type {
  LinearChannelPlan,
  LinearOutputState,
} from "../creator/creator-tv-linear.provider.js";
import { DatabaseService } from "../database/database.service.js";
import { loadGamProductionConfig } from "./gam-production.config.js";
import {
  loadLinearSsaiConfig,
  type LinearSsaiConfig,
} from "./linear-ssai.config.js";
import { resolveVideoAdPolicy } from "./video-ad-policy.js";
import {
  defaultVideoAdSettings,
  videoAdSettingsSchema,
} from "./video-ad.service.js";

export const LINEAR_SSAI_CONFIG = Symbol("LINEAR_SSAI_CONFIG");

@Injectable()
export class LinearSsaiService implements CreatorTvAdBreakHook {
  constructor(
    @Inject(LINEAR_SSAI_CONFIG) private readonly config: LinearSsaiConfig,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async getBreaks(context: CreatorTvAdBreakContext): Promise<CreatorTvAdBreakMarker[]> {
    const signaling = await this.signalingState();
    if (!signaling.enabled || !this.config.breakDurationSeconds) return [];

    const durationMs = this.config.breakDurationSeconds * 1000;
    const videoIds = [...new Set(context.programs.map((program) => program.videoId))];
    const [settingsRow, channelOverride, videoOverrides] = await Promise.all([
      this.database.client.platformSetting.findUnique({
        where: { namespace_key: { namespace: "ADVERTISING", key: "videoAdsV1" } },
        select: { value: true },
      }),
      this.database.client.videoAdOverride.findUnique({
        where: { channelId: context.channelId },
      }),
      videoIds.length
        ? this.database.client.videoAdOverride.findMany({
            where: { videoId: { in: videoIds } },
          })
        : Promise.resolve([]),
    ]);
    const parsedSettings = videoAdSettingsSchema.safeParse(settingsRow?.value);
    const settings = parsedSettings.success ? parsedSettings.data : defaultVideoAdSettings;
    if (!settings.masterEnabled) return [];

    const overrideByVideo = new Map(
      videoOverrides.flatMap((override) =>
        override.videoId ? [[override.videoId, override] as const] : [],
      ),
    );
    const policyByVideo = new Map(
      videoIds.map((videoId) => [
        videoId,
        linearPolicy(
          settings,
          channelOverride,
          overrideByVideo.get(videoId) ?? null,
          gamProductionReady(),
        ),
      ]),
    );

    const breaks: CreatorTvAdBreakMarker[] = [];
    for (const program of context.programs) {
      if (program.creatorPreference?.mode === "DISABLED") continue;
      const policy = policyByVideo.get(program.videoId);
      if (!policy?.enabled || !policy.midRollEnabled || !policy.source) continue;

      const programDurationMs = program.endsAt.getTime() - program.startsAt.getTime();
      const rawOffsets =
        program.creatorPreference?.mode === "CUSTOM"
          ? program.creatorPreference.offsetsSeconds.map((value) => value * 1000)
          : automaticOffsets(programDurationMs, policy.midRollEverySec * 1000);

      let previousEndMs = -1;
      for (const offsetMs of [...new Set(rawOffsets)].sort((left, right) => left - right)) {
        if (!Number.isSafeInteger(offsetMs) || offsetMs <= 0) continue;
        if (offsetMs + durationMs > programDurationMs) continue;
        if (offsetMs < previousEndMs) continue;

        const opportunityId = opportunityIdentity(
          context.tvChannelId,
          program.occurrenceKey,
          offsetMs,
          durationMs,
        );
        breaks.push({
          id: opportunityId,
          opportunityId,
          occurrenceKey: program.occurrenceKey,
          offsetMs,
          durationMs,
          source: policy.source,
        });
        previousEndMs = offsetMs + durationMs;
      }
    }

    return breaks;
  }

  async signalingState() {
    const emergencyKillSwitch = await this.emergencyKilled();
    const killed = emergencyKillSwitch || this.config.killSwitch;
    const enabled = this.config.enabled && !killed && Boolean(this.config.breakDurationSeconds);
    return {
      enabled,
      format: enabled ? ("HLS_CUE_OUT_IN" as const) : ("NONE" as const),
      scte35Binary: false as const,
      emergencyKillSwitch,
      taskKillSwitch: this.config.killSwitch,
      reason: !this.config.enabled
        ? ("FEATURE_DISABLED" as const)
        : killed
          ? ("KILL_SWITCH" as const)
          : !this.config.breakDurationSeconds
            ? ("BREAK_DURATION_UNCONFIGURED" as const)
            : null,
    };
  }

  async publicCapability(plan: LinearChannelPlan, state: LinearOutputState) {
    const signaling = await this.signalingState();
    const gamProduction = gamProductionReady();
    const daiConfigured = this.config.gamDaiEnabled && Boolean(this.config.gamDaiAssetKey);
    const allBreaksSupportedByDai = plan.adMarkers.every(
      (marker) => marker.source === "PROGRAMMATIC",
    );
    const daiAvailable =
      signaling.enabled &&
      daiConfigured &&
      gamProduction.enabled &&
      allBreaksSupportedByDai &&
      state.status === "READY" &&
      Boolean(state.hlsMasterUrl);

    return {
      signaling,
      dai: {
        provider: "GOOGLE_AD_MANAGER_DAI" as const,
        integration: "SSB" as const,
        configured: daiConfigured,
        available: daiAvailable,
        assetKey: daiAvailable ? this.config.gamDaiAssetKey : null,
        playbackUrl:
          daiAvailable && this.config.gamDaiAssetKey
            ? googleDaiSsbUrl(this.config.gamDaiAssetKey)
            : null,
        contentSourceUrl: state.status === "READY" ? (state.hlsMasterUrl ?? null) : null,
        attribution: {
          tvChannelId: plan.tvChannelId,
          channelId: plan.channelId,
          channelHandle: plan.channelHandle,
        },
        reason: !daiConfigured
          ? ("DAI_NOT_CONFIGURED" as const)
          : !gamProduction.enabled
            ? gamProduction.reason
            : !signaling.enabled
              ? ("SIGNALING_DISABLED" as const)
              : !allBreaksSupportedByDai
                ? ("UNSUPPORTED_BREAK_SOURCE" as const)
                : state.status !== "READY" || !state.hlsMasterUrl
                  ? ("CONTENT_STREAM_NOT_READY" as const)
                  : null,
      },
      clientSideImaFallback: true as const,
      opportunities: plan.adMarkers.map((marker) => {
        const program = plan.programs.find(
          (candidate) => candidate.occurrenceKey === marker.occurrenceKey,
        );
        const startsAt = program
          ? new Date(Date.parse(program.startsAt) + marker.offsetMs).toISOString()
          : null;
        const endsAt =
          startsAt && marker.durationMs
            ? new Date(Date.parse(startsAt) + marker.durationMs).toISOString()
            : null;
        return {
          opportunityId: marker.opportunityId,
          occurrenceKey: marker.occurrenceKey,
          videoId: program?.videoId ?? null,
          startsAt,
          endsAt,
          durationMs: marker.durationMs,
          source: marker.source,
        };
      }),
    };
  }

  private async emergencyKilled(): Promise<boolean> {
    const row = await this.database.client.platformSetting.findUnique({
      where: { namespace_key: { namespace: "ADVERTISING", key: "emergencyKillSwitch" } },
      select: { value: true },
    });
    return row?.value === true;
  }
}

function linearPolicy(
  settings: typeof defaultVideoAdSettings,
  channelOverride: Parameters<typeof resolveVideoAdPolicy>[1],
  videoOverride: Parameters<typeof resolveVideoAdPolicy>[2],
  gamProduction: ReturnType<typeof gamProductionReady>,
) {
  const resolved = resolveVideoAdPolicy(settings, channelOverride, videoOverride);
  if (!resolved.enabled || !resolved.midRollEnabled) {
    return {
      enabled: false as const,
      midRollEnabled: false,
      midRollEverySec: resolved.midRollEverySec,
      source: null,
    };
  }

  const explicitTagUrl = resolved.vastTagUrl ?? settings.externalVastTagUrl;
  if (explicitTagUrl) {
    return {
      enabled: true as const,
      midRollEnabled: true,
      midRollEverySec: resolved.midRollEverySec,
      source: "DIRECT" as const,
    };
  }
  if (gamProduction.enabled) {
    return {
      enabled: true as const,
      midRollEnabled: true,
      midRollEverySec: resolved.midRollEverySec,
      source: "PROGRAMMATIC" as const,
    };
  }
  if (settings.houseCreativeUrl) {
    return {
      enabled: true as const,
      midRollEnabled: true,
      midRollEverySec: resolved.midRollEverySec,
      source: "HOUSE" as const,
    };
  }
  return {
    enabled: false as const,
    midRollEnabled: false,
    midRollEverySec: resolved.midRollEverySec,
    source: null,
  };
}

function gamProductionReady() {
  const config = loadGamProductionConfig();
  if (config.killSwitch) {
    return { enabled: false as const, reason: "GAM_KILL_SWITCH" as const };
  }
  if (!config.complete) {
    return { enabled: false as const, reason: "GAM_CONFIG_INCOMPLETE" as const };
  }
  if (!config.productionEnabled || config.testMode) {
    return { enabled: false as const, reason: "GAM_PRODUCTION_NOT_READY" as const };
  }
  return { enabled: true as const };
}

function automaticOffsets(programDurationMs: number, intervalMs: number): number[] {
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) return [];
  const offsets: number[] = [];
  for (let offset = intervalMs; offset < programDurationMs; offset += intervalMs) {
    offsets.push(offset);
  }
  return offsets;
}

export function opportunityIdentity(
  tvChannelId: string,
  occurrenceKey: string,
  offsetMs: number,
  durationMs: number,
): string {
  const digest = createHash("sha256")
    .update([tvChannelId, occurrenceKey, String(offsetMs), String(durationMs)].join(":"))
    .digest("hex")
    .slice(0, 24);
  return "ayin-" + digest;
}

export function googleDaiSsbUrl(assetKey: string): string {
  return "https://pubads.g.doubleclick.net/ssai/event/" + encodeURIComponent(assetKey) + "/master.m3u8";
}

export function createLinearSsaiConfig(): LinearSsaiConfig {
  return loadLinearSsaiConfig();
}
