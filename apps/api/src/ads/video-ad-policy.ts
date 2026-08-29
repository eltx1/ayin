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

export function resolveVideoAdPolicy(
  settings: VideoAdSettings,
  channelOverride: VideoAdOverrideValue | null,
  videoOverride: VideoAdOverrideValue | null,
) {
  return [channelOverride, videoOverride].filter(Boolean).reduce(
    (value, override) => {
      const next = override as VideoAdOverrideValue;
      return {
        enabled: next.enabled ?? value.enabled,
        provider: next.provider === "GOOGLE_IMA" ? "GOOGLE_IMA" : value.provider,
        vastTagUrl: next.vastTagUrl ?? value.vastTagUrl,
        preRollEnabled: next.preRollEnabled ?? value.preRollEnabled,
        midRollEnabled: next.midRollEnabled ?? value.midRollEnabled,
        postRollEnabled: next.postRollEnabled ?? value.postRollEnabled,
        midRollEverySec: next.midRollEverySec ?? value.midRollEverySec,
      } as const;
    },
    {
      enabled: true,
      provider: settings.provider,
      vastTagUrl: null as string | null,
      preRollEnabled: settings.preRollEnabled,
      midRollEnabled: settings.midRollEnabled,
      postRollEnabled: settings.postRollEnabled,
      midRollEverySec: settings.midRollEverySec,
    },
  );
}
