import { Prisma } from "@ayin/db";
import { ConflictException, NotFoundException } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.guard.js";
import { AuthHttpError, unauthorized } from "../auth/auth.errors.js";
import { lockStaffRoleChanges } from "../database/staff-role-lock.js";
import { adminForbidden } from "./admin.errors.js";

export type AccountWriteActor = AuthenticatedRequest["ayinAuth"];

// Staff/MFA advisory -> actor credential -> sorted Accounts -> roles/session.
// Credential first also matches existing recovery-code regeneration; account
// NO KEY UPDATE protects versions while allowing unrelated FK key-share reads.
export async function lockAdminAccountWrite(
  tx: Prisma.TransactionClient,
  actor: AccountWriteActor,
  accountId: string,
  expectedUpdatedAt?: string,
  domainRoles: readonly ("OPERATIONS" | "CONTENT_MODERATOR" | "AD_MANAGER")[] = ["OPERATIONS"],
  additionalAccountIds: readonly string[] = [],
) {
  await lockStaffRoleChanges(tx);
  const credentials = await tx.$queryRaw<Array<{ status: string; version: number }>>(
    Prisma.sql`SELECT "status", "version" FROM "AccountMfaCredential"
      WHERE "accountId" = ${actor.accountId}::uuid FOR SHARE /* ayin-admin-account-write-lock */`,
  );
  // Additional IDs come only from server-side ownership observations. Keep them
  // in this same ordered acquisition, after the unchanged staff/MFA prefix.
  const ids = [
    ...new Set([actor.accountId, accountId, ...additionalAccountIds].map((id) => id.toLowerCase())),
  ].sort();
  const accounts = await tx.$queryRaw<
    Array<{ id: string; status: string; authVersion: number; updatedAt: Date }>
  >(Prisma.sql`SELECT "id", "status", "authVersion", "updatedAt" FROM "Account"
    WHERE "id" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY "id" FOR NO KEY UPDATE /* ayin-admin-account-write-lock */`);
  const currentActor = accounts.find((row) => row.id === actor.accountId);
  if (
    !currentActor ||
    currentActor.status !== "ACTIVE" ||
    currentActor.authVersion !== actor.authVersion
  )
    throw unauthorized();
  const roles = await tx.$queryRaw<Array<{ role: string }>>(
    Prisma.sql`SELECT "role" FROM "AdminRoleAssignment" WHERE "accountId" = ${actor.accountId}::uuid
      AND "role"::text IN (${Prisma.join(["SUPERADMIN", "ADMIN", ...domainRoles])}) FOR SHARE`,
  );
  if (!roles.length) throw adminForbidden("Administration authority changed.");
  // Prisma stores expiresAt as a UTC-naive TIMESTAMP(3). Keep the comparison
  // on the database wall clock without interpreting it in the session timezone.
  const sessions = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "AccountSession" WHERE "id" = ${actor.sessionId}::uuid
      AND "accountId" = ${actor.accountId}::uuid AND "authVersion" = ${actor.authVersion}
      AND "revokedAt" IS NULL AND "expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC') FOR SHARE`,
  );
  if (!sessions.length) throw unauthorized();
  if (roles.some((row) => row.role === "SUPERADMIN" || row.role === "ADMIN")) {
    if (!actor.mfaAt || actor.mfaVersion === undefined) throw unauthorized();
    if (!credentials.some((row) => row.status === "ENABLED" && row.version === actor.mfaVersion))
      throw unauthorized();
  }
  if (!actor.reauthAt || actor.reauthAt < Math.floor(Date.now() / 1000) - 300)
    throw new AuthHttpError(
      403,
      "STEP_UP_REQUIRED",
      "Verify again before this sensitive operation.",
    );
  const target = accounts.find((row) => row.id === accountId);
  if (!target) throw new NotFoundException("Account record unavailable.");
  if (
    expectedUpdatedAt !== undefined &&
    target.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()
  )
    throw new ConflictException(
      "Account changed. Read the original account before reviewing this operation.",
    );
  return target;
}

export function nextAccountVersion(previous: Date) {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}
