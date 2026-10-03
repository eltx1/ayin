import { Prisma } from "@ayin/db";
import { ForbiddenException } from "@nestjs/common";

// Recheck the same existing Finance/privileged role scope after a blocking
// financial lock, and hold the matched authority until the write commits.
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
