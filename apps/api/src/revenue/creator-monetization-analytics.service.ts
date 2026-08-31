import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";

function decimalToMicros(value: string): bigint {
  const normalized = value.trim();
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const micros = BigInt(whole || "0") * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
  return negative ? -micros : micros;
}

function microsToMoney(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 1_000_000n}.${(absolute % 1_000_000n)
    .toString()
    .padStart(6, "0")}`;
}

function ratioPerThousand(amountMicros: bigint, denominator: number): string | null {
  if (denominator <= 0) return null;
  return microsToMoney((amountMicros * 1000n) / BigInt(denominator));
}

function csv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

@Injectable()
export class CreatorMonetizationAnalyticsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async analytics(accountId: string) {
    const channel = await this.creatorChannel(accountId);
    if (!channel) return null;
    const from30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const from90d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const [entries, videoStarts30d, adStarts30d] = await Promise.all([
      this.database.client.earningsLedgerEntry.findMany({
        where: { channelId: channel.id, occurredAt: { gte: from90d } },
        select: {
          amount: true,
          state: true,
          currency: true,
          adSource: true,
          occurredAt: true,
          periodStart: true,
        },
        orderBy: { occurredAt: "asc" },
        take: 10_000,
      }),
      this.database.client.analyticsEvent.count({
        where: { channelId: channel.id, eventName: "VIDEO_START", occurredAt: { gte: from30d } },
      }),
      this.database.client.analyticsEvent.count({
        where: { channelId: channel.id, eventName: "AD_START", occurredAt: { gte: from30d } },
      }),
    ]);

    const currency = entries[0]?.currency ?? "USD";
    const mixedCurrency = entries.some((entry) => entry.currency !== currency);
    const daily = new Map<string, { estimated: bigint; finalized: bigint }>();
    const bySource = new Map<string, { estimated: bigint; finalized: bigint }>();
    let finalized30d = 0n;

    for (const entry of entries) {
      if (entry.currency !== currency) continue;
      const amount = decimalToMicros(String(entry.amount));
      const finalized = entry.state !== "ESTIMATED";
      const day = (entry.periodStart ?? entry.occurredAt).toISOString().slice(0, 10);
      const dayBucket = daily.get(day) ?? { estimated: 0n, finalized: 0n };
      if (finalized) dayBucket.finalized += amount;
      else dayBucket.estimated += amount;
      daily.set(day, dayBucket);

      const source = entry.adSource?.trim() || "UNATTRIBUTED";
      const sourceBucket = bySource.get(source) ?? { estimated: 0n, finalized: 0n };
      if (finalized) sourceBucket.finalized += amount;
      else sourceBucket.estimated += amount;
      bySource.set(source, sourceBucket);

      if (finalized && entry.occurredAt >= from30d) finalized30d += amount;
    }

    return {
      channel,
      currency,
      mixedCurrency,
      windowDays: 30,
      videoStarts: videoStarts30d,
      monetizedAdStarts: adStarts30d,
      creatorRpm: ratioPerThousand(finalized30d, videoStarts30d),
      creatorCpm: ratioPerThousand(finalized30d, adStarts30d),
      finalizedRevenue30d: microsToMoney(finalized30d),
      byDay: [...daily.entries()]
        .map(([day, value]) => ({
          day,
          estimated: microsToMoney(value.estimated),
          finalized: microsToMoney(value.finalized),
        }))
        .sort((a, b) => b.day.localeCompare(a.day)),
      byAdSource: [...bySource.entries()]
        .map(([source, value]) => ({
          source,
          estimated: microsToMoney(value.estimated),
          finalized: microsToMoney(value.finalized),
        }))
        .sort((a, b) => b.finalized.localeCompare(a.finalized)),
      countryRevenueAttribution: {
        available: false,
        reason:
          "Current imported earnings ledger entries do not carry a trusted country revenue dimension. AYIN will not fabricate country revenue attribution.",
        rows: [] as Array<{ country: string; revenue: string }>,
      },
      estimatedPayoutDate: null,
      payoutTimingReason:
        "Manual payout processing is enabled, but no guaranteed payout calendar has been configured.",
    };
  }

  async statement(accountId: string) {
    const channel = await this.creatorChannel(accountId);
    if (!channel) return null;
    const [ledger, payouts] = await Promise.all([
      this.database.client.earningsLedgerEntry.findMany({
        where: { channelId: channel.id },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 10_000,
        select: {
          id: true,
          type: true,
          state: true,
          amount: true,
          grossAmount: true,
          currency: true,
          revenueShareBps: true,
          adSource: true,
          periodStart: true,
          periodEnd: true,
          occurredAt: true,
          memo: true,
          videoId: true,
          payoutId: true,
        },
      }),
      this.database.client.payout.findMany({
        where: { channelId: channel.id },
        orderBy: { requestedAt: "desc" },
        take: 1_000,
        select: {
          id: true,
          status: true,
          amount: true,
          currency: true,
          externalReference: true,
          requestedAt: true,
          processedAt: true,
          paidAt: true,
          failureReason: true,
        },
      }),
    ]);
    const generatedAt = new Date();
    const lines = [
      [
        "recordType",
        "id",
        "stateOrStatus",
        "amount",
        "grossAmount",
        "currency",
        "revenueShareBps",
        "adSource",
        "periodStart",
        "periodEnd",
        "occurredOrRequestedAt",
        "videoId",
        "payoutIdOrReference",
        "memoOrFailure",
      ]
        .map(csv)
        .join(","),
      ...ledger.map((item) =>
        [
          `LEDGER_${item.type}`,
          item.id,
          item.state,
          item.amount,
          item.grossAmount,
          item.currency,
          item.revenueShareBps,
          item.adSource,
          item.periodStart,
          item.periodEnd,
          item.occurredAt,
          item.videoId,
          item.payoutId,
          item.memo,
        ]
          .map(csv)
          .join(","),
      ),
      ...payouts.map((item) =>
        [
          "PAYOUT",
          item.id,
          item.status,
          item.amount,
          null,
          item.currency,
          null,
          null,
          null,
          null,
          item.requestedAt,
          null,
          item.externalReference,
          item.failureReason,
        ]
          .map(csv)
          .join(","),
      ),
    ];
    return {
      filename: `ayin-${channel.handle}-statement-${generatedAt.toISOString().slice(0, 10)}.csv`,
      generatedAt: generatedAt.toISOString(),
      channel,
      format: "CSV",
      content: lines.join("\n"),
    };
  }

  private async creatorChannel(accountId: string) {
    const membership = await this.database.client.channelMember.findFirst({
      where: {
        accountId,
        role: { in: ["OWNER", "ADMIN"] },
        channel: { status: { not: "REMOVED" } },
      },
      orderBy: { createdAt: "asc" },
      select: { channel: { select: { id: true, name: true, handle: true } } },
    });
    return membership?.channel ?? null;
  }
}
