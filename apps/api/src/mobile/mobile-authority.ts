import type { Prisma } from "@ayin/db";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import {
  lockAdminAccountWrite,
  type AccountWriteActor,
} from "../admin/admin-account-write-authority.js";
export type MobileActor = AccountWriteActor;
export async function lockMobileAccountWrite(tx: Prisma.TransactionClient, actor: MobileActor) {
  await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${actor.accountId}::uuid FOR NO KEY UPDATE`;
  await tx.$queryRaw`SELECT id FROM "AccountSession" WHERE id=${actor.sessionId}::uuid FOR SHARE`;
  const [account, session] = await Promise.all([
    tx.account.findUnique({
      where: { id: actor.accountId },
      select: { status: true, authVersion: true },
    }),
    tx.accountSession.findUnique({
      where: { id: actor.sessionId },
      select: { accountId: true, authVersion: true, revokedAt: true, expiresAt: true },
    }),
  ]);
  if (
    !account ||
    account.status !== "ACTIVE" ||
    account.authVersion !== actor.authVersion ||
    !session ||
    session.accountId !== actor.accountId ||
    session.authVersion !== actor.authVersion ||
    session.revokedAt ||
    session.expiresAt.getTime() <= Date.now()
  )
    throw new UnauthorizedException();
}
export async function lockMobileAdminWrite(
  tx: Prisma.TransactionClient,
  actor: MobileActor,
  targetAccountId = actor.accountId,
) {
  await lockAdminAccountWrite(tx, actor, targetAccountId);
  // General ADMIN bypasses some existing domain roles, but mobile release controls
  // deliberately retain the explicit SUPERADMIN boundary after the request guard.
  if (
    !(await tx.adminRoleAssignment.findFirst({
      where: { accountId: actor.accountId, role: "SUPERADMIN" },
      select: { id: true },
    }))
  )
    throw new ForbiddenException("Mobile release controls require current SUPERADMIN authority.");
}
