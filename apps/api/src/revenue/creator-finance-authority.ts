import { Prisma } from "@ayin/db";
import { ForbiddenException, NotFoundException } from "@nestjs/common";

export async function lockFinanceChannel(tx: Prisma.TransactionClient, channelId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>(
    Prisma.sql`/* ayin-finance-channel-lock */ SELECT "id", "status" FROM "Channel" WHERE "id" = ${channelId}::uuid FOR UPDATE`,
  );
  const channel = rows[0];
  if (!channel) throw new NotFoundException("Channel not found.");
  return channel;
}

export async function assertCreatorFinanceAuthority(
  tx: Prisma.TransactionClient,
  channelId: string,
  accountId: string,
) {
  const channel = await lockFinanceChannel(tx, channelId);
  if (channel.status === "REMOVED") throw new ForbiddenException("Creator channel unavailable.");
  // Hold the actual membership through commit, so concurrent revocation cannot
  // pass an earlier, out-of-transaction ownership check.
  const members = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "ChannelMember" WHERE "channelId" = ${channelId}::uuid AND "accountId" = ${accountId}::uuid AND "role" IN ('OWNER', 'ADMIN') FOR SHARE`,
  );
  if (!members[0]) throw new ForbiddenException("Creator channel access changed.");
}
