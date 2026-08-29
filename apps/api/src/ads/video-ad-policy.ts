import type { VideoAdSettings } from "./video-ad.service.js";

export interface VideoAdOverrideValue {
  enabled: boolean | null;
  preRollEnabled: boolean | null;
  midRollEnabled: boolean | null;
  postRollEnabled: boolean | null;
  provider: string | null;
  vastTagUrl: string | null;
  midRollEverySec: number | null;
}

export interface ResolvedVideoAdPolicy {
  enabled: boolean;
  provider: "GOOGLE_IMA";
  vastTagUrl: string | null;
  preRollEnabled: boolean;
  midRollEnabled: boolean;
  postRollEnabled: boolean;
  midRollEverySec: number;
}

export function resolveVideoAdPolicy(
  settings: VideoAdSettings,
  channelOverride: VideoAdOverrideValue | null,
  videoOverride: VideoAdOverrideValue | null,
): ResolvedVideoAdPolicy {
  let resolved: ResolvedVideoAdPolicy = {
    enabled: true,
    provider: settings.provider,
    vastTagUrl: null,
    preRollEnabled: settings.preRollEnabled,
    midRollEnabled: settings.midRollEnabled,
    postRollEnabled: settings.postRollEnabled,
    midRollEverySec: settings.midRollEverySec,
  };

  for (const override of [channelOverride, videoOverride]) {
    if (!override) continue;
    resolved = {
      enabled: override.enabled ?? resolved.enabled,
      provider: override.provider === "GOOGLE_IMA" ? "GOOGLE_IMA" : resolved.provider,
      vastTagUrl: override.vastTagUrl ?? resolved.vastTagUrl,
      preRollEnabled: override.preRollEnabled ?? resolved.preRollEnabled,
      midRollEnabled: override.midRollEnabled ?? resolved.midRollEnabled,
      postRollEnabled: override.postRollEnabled ?? resolved.postRollEnabled,
      midRollEverySec: override.midRollEverySec ?? resolved.midRollEverySec,
    };
  }

  return resolved;
}
