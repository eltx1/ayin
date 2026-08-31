import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { formatMoneyMicros, parseMoneyMicros } from "./money.js";
import { revenueImportSchema } from "./revenue.schemas.js";

interface MonetizationNotificationInput {
  channelId: string;
  title: string;
  body: string;
  data?: Prisma.InputJsonObject;
}

@Injectable()
export class CreatorMonetizationNotificationService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async notifyChannel(input: MonetizationNotificationInput) {
    return this.database.client.$transaction((tx) => this.notifyChannelInTransaction(tx, input));
  }

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

  async notifyFinalizedRevenueImport(raw: unknown, importedAfter: Date) {
    const parsed = revenueImportSchema.safeParse(raw);
    if (!parsed.success) return { notifications: 0 };
    const finalKeys = parsed.data.entries
      .filter((entry) => entry.state === "FINAL")
      .map((entry) => `${parsed.data.source}:${entry.idempotencyKey}`);
    if (!finalKeys.length) return { notifications: 0 };

    const rows = await this.database.client.earningsLedgerEntry.findMany({
      where: {
        idempotencyKey: { in: finalKeys },
        state: "FINAL",
        finalizedAt: { gte: importedAfter },
      },
      select: { channelId: true, currency: true, amount: true },
    });
    const buckets = new Map<string, { channelId: string; currency: string; total: bigint }>();
    for (const row of rows) {
      const key = `${row.channelId}:${row.currency}`;
      const bucket = buckets.get(key) ?? {
        channelId: row.channelId,
        currency: row.currency,
        total: 0n,
      };
      bucket.total += parseMoneyMicros(String(row.amount));
      buckets.set(key, bucket);
    }

    let notifications = 0;
    for (const bucket of buckets.values()) {
      const result = await this.notifyChannel({
        channelId: bucket.channelId,
        title: "Finalized earnings updated",
        body: `${bucket.currency} ${formatMoneyMicros(bucket.total)} in newly imported creator earnings has been finalized.`,
        data: {
          event: "FINALIZED_EARNINGS_UPDATED",
          currency: bucket.currency,
          amount: formatMoneyMicros(bucket.total),
        },
      });
      notifications += result.created;
    }
    return { notifications };
  }
}
