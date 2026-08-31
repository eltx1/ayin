import type { Prisma } from "@ayin/db";
import { Injectable } from "@nestjs/common";

interface MonetizationNotificationInput {
  channelId: string;
  title: string;
  body: string;
  data?: Prisma.InputJsonObject;
}

@Injectable()
export class CreatorMonetizationNotificationService {
  async notifyChannelInTransaction(
    tx: Prisma.TransactionClient,
    input: MonetizationNotificationInput,
  ) {
    const members = await tx.channelMember.findMany({
      where: {
        channelId: input.channelId,
        role: { in: ["OWNER", "ADMIN"] },
      },
      select: { accountId: true },
    });
    const accountIds = [...new Set(members.map((member) => member.accountId))];
    if (!accountIds.length) return { created: 0 };

    await tx.notification.createMany({
      data: accountIds.map((accountId) => ({
        accountId,
        type: "MONETIZATION" as const,
        title: input.title,
        body: input.body,
        ...(input.data ? { data: input.data } : {}),
      })),
    });
    return { created: accountIds.length };
  }
}
