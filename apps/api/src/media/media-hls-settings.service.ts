import type { MediaProcessingJob } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";
import type { MediaRenditionIdentity } from "./media-architecture-v2.js";
import { isAdaptiveBackfillJob } from "./media-adaptive-rollout.js";

export interface MediaHlsOperationalSettings {
  enabled: boolean;
  allowedIdentities: readonly MediaRenditionIdentity[];
  videoBitrateKbps: Record<MediaRenditionIdentity, number>;
  audioBitrateKbps: Record<MediaRenditionIdentity, number>;
  segmentDurationSeconds: number;
  maxOutputHeight: number;
  scratchMaxBytesPerJob: number;
  ffmpegThreadsPerJob: number;
  ffmpegPreset: string;
}

@Injectable()
export class MediaHlsSettingsService {
  constructor(
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {}

  async resolve(
    job?: Pick<MediaProcessingJob, "generation" | "stagingKey">,
  ): Promise<MediaHlsOperationalSettings> {
    const [
      enabled,
      newUploadsEnabled,
      backfillEnabled,
      enable360p,
      enable480p,
      enable720p,
      enable1080p,
      video360p,
      video480p,
      video720p,
      video1080p,
      audio360p,
      audio480p,
      audio720p,
      audio1080p,
      segmentDurationSeconds,
      maxOutputHeight,
      scratchMaxBytesPerJob,
      ffmpegThreadsPerJob,
      ffmpegPreset,
    ] = await Promise.all([
      this.settings.get("mediaHlsEnabled"),
      this.settings.get("mediaHlsNewUploadsEnabled"),
      this.settings.get("mediaHlsBackfillEnabled"),
      this.settings.get("mediaHls360pEnabled"),
      this.settings.get("mediaHls480pEnabled"),
      this.settings.get("mediaHls720pEnabled"),
      this.settings.get("mediaHls1080pEnabled"),
      this.settings.get("mediaHls360pVideoBitrateKbps"),
      this.settings.get("mediaHls480pVideoBitrateKbps"),
      this.settings.get("mediaHls720pVideoBitrateKbps"),
      this.settings.get("mediaHls1080pVideoBitrateKbps"),
      this.settings.get("mediaHls360pAudioBitrateKbps"),
      this.settings.get("mediaHls480pAudioBitrateKbps"),
      this.settings.get("mediaHls720pAudioBitrateKbps"),
      this.settings.get("mediaHls1080pAudioBitrateKbps"),
      this.settings.get("mediaHlsSegmentDurationSeconds"),
      this.settings.get("mediaHlsMaxOutputHeight"),
      this.settings.get("mediaProcessingScratchMaxBytesPerJob"),
      this.settings.get("mediaProcessingFfmpegThreadsPerJob"),
      this.settings.get("mediaProcessingPreset"),
    ]);

    const allowedIdentities: MediaRenditionIdentity[] = [];
    if (enable360p as boolean) allowedIdentities.push("360p");
    if (enable480p as boolean) allowedIdentities.push("480p");
    if (enable720p as boolean) allowedIdentities.push("720p");
    if (enable1080p as boolean) allowedIdentities.push("1080p");

    // The queue owns pause/resume semantics: paused backfill jobs are not claimed, while
    // already-claimed work is allowed to finish safely. The generation service therefore
    // only checks the durable backfill enable switch once a worker owns a backfill job.
    const rolloutEnabled = job
      ? isAdaptiveBackfillJob(job)
        ? (backfillEnabled as boolean)
        : (newUploadsEnabled as boolean)
      : true;

    return {
      enabled: (enabled as boolean) && rolloutEnabled,
      allowedIdentities,
      videoBitrateKbps: {
        "360p": video360p as number,
        "480p": video480p as number,
        "720p": video720p as number,
        "1080p": video1080p as number,
      },
      audioBitrateKbps: {
        "360p": audio360p as number,
        "480p": audio480p as number,
        "720p": audio720p as number,
        "1080p": audio1080p as number,
      },
      segmentDurationSeconds: segmentDurationSeconds as number,
      maxOutputHeight: maxOutputHeight as number,
      scratchMaxBytesPerJob: scratchMaxBytesPerJob as number,
      ffmpegThreadsPerJob: ffmpegThreadsPerJob as number,
      ffmpegPreset: ffmpegPreset as string,
    };
  }
}
