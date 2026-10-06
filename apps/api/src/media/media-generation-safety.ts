import type { Prisma } from "@ayin/db";

export const ACTIVE_MEDIA_JOB_STATUSES = [
  "INGESTING",
  "QUEUED",
  "INTEGRITY_QUEUED",
  "PROCESSING",
  "UPLOADING",
  "VERIFYING",
] as const;

// Serialize generation creation/revival per video, without locking the Video row.
// Batch callers take their capacity lock first, then this lock, then write rows.
// Hash collisions only serialize unrelated videos; they cannot weaken isolation.
export async function lockMediaGeneration(tx: Prisma.TransactionClient, videoId: string) {
  // UUID input may use upper-case hex while PostgreSQL returns lower-case hex.
  const canonicalVideoId = videoId.toLowerCase();
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(86192043, hashtext(${canonicalVideoId}))`;
}

export async function hasNewerMediaGeneration(
  tx: Prisma.TransactionClient,
  job: { videoId: string; generation: number },
): Promise<boolean> {
  const where = { videoId: job.videoId, generation: { gt: job.generation } };
  const [processing, playback] = await Promise.all([
    tx.mediaProcessingJob.findFirst({ where, select: { id: true } }),
    tx.mediaPlaybackGeneration.findFirst({ where, select: { id: true } }),
  ]);
  return Boolean(processing || playback);
}

export async function hasActiveMediaJob(
  tx: Prisma.TransactionClient,
  videoId: string,
  excludingJobId?: string,
) {
  return Boolean(
    await tx.mediaProcessingJob.findFirst({
      where: {
        videoId,
        status: { in: [...ACTIVE_MEDIA_JOB_STATUSES] },
        ...(excludingJobId ? { id: { not: excludingJobId } } : {}),
      },
      select: { id: true },
    }),
  );
}
