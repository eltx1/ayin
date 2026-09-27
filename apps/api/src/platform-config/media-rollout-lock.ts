import type { Prisma } from "@ayin/db";

// Settings writers and backfill/recovery mutations share this transaction boundary.
// Acquire before any per-video generation lock. A committed pause prevents later
// batches from enqueueing; it does not cancel work that committed before the pause.
export async function lockMediaRollout(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock($1)", 86192042);
}
