import type { MediaProcessingJob } from "@ayin/db";
import {
  canonicalFallbackObjectKey,
  hlsMasterObjectKey,
  type MediaGenerationNamespace,
} from "./media-architecture-v2.js";

export type MediaClaimIdentity = {
  attempt?: number | undefined;
  outputAttemptId?: string | null | undefined;
};
export function capturedMediaClaim(
  job: Pick<MediaProcessingJob, "inputIntegrityVersion" | "attempt" | "currentOutputAttemptId">,
): MediaClaimIdentity {
  if (
    job.inputIntegrityVersion === 1 &&
    (!job.currentOutputAttemptId || !Number.isSafeInteger(job.attempt) || job.attempt < 1)
  )
    throw new Error("The required media job has no captured output attempt.");
  return job.inputIntegrityVersion === 1
    ? { attempt: job.attempt, outputAttemptId: job.currentOutputAttemptId }
    : {};
}
export function outputAttemptNamespace(
  job: Pick<
    MediaProcessingJob,
    "inputIntegrityVersion" | "currentOutputAttemptId" | "videoId" | "generation"
  >,
  channelId: string,
): MediaGenerationNamespace {
  if (job.inputIntegrityVersion === 1 && !job.currentOutputAttemptId)
    throw new Error("A required media job has no captured output attempt.");
  return {
    channelId,
    videoId: job.videoId,
    generation: job.generation,
    ...(job.inputIntegrityVersion === 1 ? { outputAttemptId: job.currentOutputAttemptId! } : {}),
  };
}
export function outputAttemptAddresses(
  namespace: MediaGenerationNamespace & { outputAttemptId: string },
) {
  const canonicalR2ObjectKey = canonicalFallbackObjectKey(namespace);
  const prefix = canonicalR2ObjectKey.slice(0, -"canonical.mp4".length);
  return {
    prefix,
    canonicalR2ObjectKey,
    hlsR2Prefix: hlsMasterObjectKey(namespace).slice(0, -"master.m3u8".length),
    thumbnailR2ObjectKey: `${prefix}thumbnail.jpg`,
  };
}
