import { Prisma } from "@ayin/db";
import { ForbiddenException } from "@nestjs/common";

// Recheck the existing Finance/privileged role scope and retain it through commit.
// This helper locks Account before roles; staff-role revocation uses the same
// order. Callers must also account for their own domain locks when placing it.
export async function assertAdminFinanceAuthority(tx: Prisma.TransactionClient, accountId: string) {
  const accounts = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "Account" WHERE "id" = ${accountId}::uuid AND "status" = 'ACTIVE' FOR SHARE`,
  );
  if (!accounts.length) throw new ForbiddenException("Financial authority is no longer available.");
  const roles = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "AdminRoleAssignment" WHERE "accountId" = ${accountId}::uuid AND "role" IN ('SUPERADMIN', 'ADMIN', 'FINANCE_MANAGER') FOR SHARE`,
  );
  if (!roles.length) throw new ForbiddenException("Financial authority is no longer available.");
}
