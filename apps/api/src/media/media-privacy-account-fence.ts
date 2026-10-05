import { Prisma } from "@ayin/db";
import { ConflictException } from "@nestjs/common";

// Observe before taking any actor Account lock. Privacy locks the owner Account
// before selecting its media; creation must lock the whole observed account set
// in one canonical order, not actor first and owner second.
export async function observeChannelMediaOwners(tx: Prisma.TransactionClient, channelId: string) {
  const owners = await tx.channelMember.findMany({
    where: { channelId, role: "OWNER" },
    select: { accountId: true },
    orderBy: { accountId: "asc" },
  });
  return owners.map(({ accountId }) => accountId);
}

export async function lockChannelMediaAccounts(
  tx: Prisma.TransactionClient,
  actorAccountId: string,
  ownerAccountIds: readonly string[],
) {
  const ids = [
    ...new Set([actorAccountId, ...ownerAccountIds].map((id) => id.toLowerCase())),
  ].sort();
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "Account"
      WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY id FOR SHARE /* ayin-media-owner-account-lock */`,
  );
}

// Administrators instead pass these server-derived IDs into the existing
// authority helper, preserving its staff/MFA -> sorted Accounts prefix. Both
// callers revalidate ownership after the Account wait and before media locks.
export async function assertChannelMediaOwners(
  tx: Prisma.TransactionClient,
  channelId: string,
  observedOwnerIds: readonly string[],
) {
  const owners = await tx.$queryRaw<Array<{ accountId: string }>>(
    Prisma.sql`SELECT "accountId" FROM "ChannelMember"
      WHERE "channelId" = ${channelId}::uuid AND role = 'OWNER'
      ORDER BY "accountId" FOR SHARE /* ayin-media-owner-membership-lock */`,
  );
  if (
    owners.length !== observedOwnerIds.length ||
    owners.some((owner, index) => owner.accountId !== observedOwnerIds[index])
  ) {
    throw new ConflictException(
      "Channel ownership changed. Read the current channel before retrying.",
    );
  }
}
