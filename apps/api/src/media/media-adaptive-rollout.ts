import type { MediaProcessingJob } from "@ayin/db";

export const ADAPTIVE_PLAYBACK_FEATURE_FLAG = "player.hls.enabled" as const;
export const ADAPTIVE_BACKFILL_MARKER = "#adaptive-backfill-g" as const;
export const ADAPTIVE_BACKFILL_HARD_BATCH_MAX = 20;
export const ADAPTIVE_BACKFILL_HARD_IN_FLIGHT_MAX = 4;

export const ADAPTIVE_RECOVERY_MODES = [
  "INCOMPLETE_HLS",
  "STALE_PROCESSING",
  "VERIFIED_HLS_MISSING_DB",
  "DB_MANIFEST_MISSING",
  "FAILED_BACKFILL",
] as const;

export type AdaptiveRecoveryMode = (typeof ADAPTIVE_RECOVERY_MODES)[number];

export function isAdaptiveBackfillJob(job: Pick<MediaProcessingJob, "stagingKey">): boolean {
  return job.stagingKey.includes(ADAPTIVE_BACKFILL_MARKER);
}
