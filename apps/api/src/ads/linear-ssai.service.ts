import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import type {
  CreatorTvAdBreakContext,
  CreatorTvAdBreakHook,
  CreatorTvAdBreakMarker,
} from "../creator/creator-tv-ad-break.hook.js";
import type { LinearChannelPlan, LinearOutputState } from "../creator/creator-tv-linear.provider.js";
import { AdvertisingControlService } from "./advertising-control.service.js";
import { GamProductionService } from "./gam-production.service.js";
import {
  loadLinearSsaiConfig,
  type LinearSsaiConfig,
} from "./linear-ssai.config.js";
import { VideoAdService } from "./video-ad.service.js";

export const LINEAR_SSAI_CONFIG = Symbol("LINEAR_SSAI_CONFIG");

@Injectable()
export class LinearSsaiService implements CreatorTvAdBreakHook {
  constructor(
    @Inject(LINEAR_SSAI_CONFIG) private readonly config: LinearSsaiConfig,
    @Inject(AdvertisingControlService)
    private readonly advertising: AdvertisingControlService,
    @Inject(VideoAdService) private readonly videoAds: VideoAdService,
    @Inject(GamProductionService) private readonly gam: GamProductionService,
  ) {}

  async getBreaks(context: CreatorTvAdBreakContext): Promise<CreatorTvAdBreakMarker[]> {
    const signaling = await this.signalingState();
    if (!signaling.enabled || !this.config.breakDurationSeconds) return [];

    const durationMs = this.config.breakDurationSeconds * 1000;
    const breaks: CreatorTvAdBreakMarker[] = [];

    for (const program of context.programs) {
      if (program.creatorPreference?.mode === "DISABLED") continue;
      const policy = await this.videoAds.resolveLinearBreakPolicy(context.channelId, program.videoId);
      if (!policy.enabled || !policy.midRollEnabled || !policy.source) continue;

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
    const emergencyKillSwitch = await this.advertising.isEmergencyKilled();
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
    const [signaling, gamProduction] = await Promise.all([
      this.signalingState(),
      this.gam.productionRequestState(),
    ]);
    const daiConfigured = this.config.gamDaiEnabled && Boolean(this.config.gamDaiAssetKey);
    const daiAvailable =
      signaling.enabled &&
      daiConfigured &&
      gamProduction.enabled &&
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
        reason: !daiConfigured
          ? ("DAI_NOT_CONFIGURED" as const)
          : !gamProduction.enabled
            ? gamProduction.reason
            : !signaling.enabled
              ? ("SIGNALING_DISABLED" as const)
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
}

function automaticOffsets(programDurationMs: number, intervalMs: number): number[] {
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) return [];
  const offsets: number[] = [];
  for (let offset = intervalMs; offset < programDurationMs; offset += intervalMs) offsets.push(offset);
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
