import type { MediaProcessingJobStatus } from "@ayin/db";

// The queue lane is private worker compatibility state. Existing API clients
// truthfully see a waiting job as QUEUED; it is never reported as active ingest.
export function publicMediaProcessingStatus(status: MediaProcessingJobStatus) {
  return status === "INTEGRITY_QUEUED" ? "QUEUED" : status;
}
export function publicMediaProcessingJob<T extends { status: MediaProcessingJobStatus }>(
  job: T | null | undefined,
) {
  return job ? { ...job, status: publicMediaProcessingStatus(job.status) } : null;
}
export function publicMediaProcessingCounts(counts: Record<string, number>) {
  const { INTEGRITY_QUEUED: integrityQueued = 0, ...publicCounts } = counts;
  if (integrityQueued) publicCounts.QUEUED = (publicCounts.QUEUED ?? 0) + integrityQueued;
  return publicCounts;
}
