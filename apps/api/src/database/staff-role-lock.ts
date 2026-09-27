import type { Prisma } from "@ayin/db";

// Shared by staff-role changes and MFA operations whose authorization depends
// on those roles. Keep the existing lock identity and transaction lifetime.
export async function lockStaffRoleChanges(
  tx: Pick<Prisma.TransactionClient, "$executeRawUnsafe">,
) {
  await tx.$executeRawUnsafe(
    "DO $$ BEGIN PERFORM pg_advisory_xact_lock(1096379721, 1398034002); END $$;",
  );
}
