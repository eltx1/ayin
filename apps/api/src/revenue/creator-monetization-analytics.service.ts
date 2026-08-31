import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";

function decimalToMicros(value: unknown): bigint {
  const normalized = String(value ?? "0").trim();
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

interface CurrencyRow {
  currency: string;
}

interface MixedCurrencyRow {
  mixedCurrency: boolean;
}

interface FinalizedRow {
  amount: unknown;
}

interface DailyRevenueRow {
  day: string;
  estimated: unknown;
  finalized: unknown;
}

interface SourceRevenueRow {
  source: string;
  estimated: unknown;
  finalized: unknown;
}

@Injectable()
export class CreatorMonetizationAnalyticsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async analytics(accountId: string) {
    const channel = await this.creatorChannel(accountId);
    if (!channel) return null;
    const from30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const from90d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const [profile, latestCurrencyRows] = await Promise.all([
      this.database.client.creatorPayoutProfile.findUnique({
        where: { channelId: channel.id },
        select: { preferredCurrency: true },
      }),
      this.database.client.$queryRaw<CurrencyRow[]>`
        SELECT "currency"
        FROM "EarningsLedgerEntry"
        WHERE "channelId" = ${channel.id}::uuid
        ORDER BY "occurredAt" DESC, "id" DESC
        LIMIT 1
      `,
    ]);
    const currency = profile?.preferredCurrency ?? latestCurrencyRows[0]?.currency ?? "USD";

    const [
      finalizedRows,
      dailyRows,
      sourceRows,
      mixedCurrencyRows,
      videoStarts30d,
      adStarts30d,
    ] = await Promise.all([
      this.database.client.$queryRaw<FinalizedRow[]>`
        SELECT COALESCE(SUM("amount"), 0) AS "amount"
        FROM "EarningsLedgerEntry"
        WHERE "channelId" = ${channel.id}::uuid
          AND "currency" = ${currency}
          AND "state" IN ('FINAL', 'ADJUSTMENT')
          AND "occurredAt" >= ${from30d}
      `,
      this.database.client.$queryRaw<DailyRevenueRow[]>`
        SELECT
          TO_CHAR(DATE_TRUNC('day', COALESCE("periodStart", "occurredAt")), 'YYYY-MM-DD') AS "day",
          COALESCE(SUM(CASE WHEN "state" = 'ESTIMATED' THEN "amount" ELSE 0 END), 0) AS "estimated",
          COALESCE(SUM(CASE WHEN "state" IN ('FINAL', 'ADJUSTMENT') THEN "amount" ELSE 0 END), 0) AS "finalized"
        FROM "EarningsLedgerEntry"
        WHERE "channelId" = ${channel.id}::uuid
          AND "currency" = ${currency}
          AND "occurredAt" >= ${from90d}
        GROUP BY DATE_TRUNC('day', COALESCE("periodStart", "occurredAt"))
        ORDER BY DATE_TRUNC('day', COALESCE("periodStart", "occurredAt")) DESC
      `,
      this.database.client.$queryRaw<SourceRevenueRow[]>`
        SELECT
          COALESCE(NULLIF(BTRIM("adSource"), ''), 'UNATTRIBUTED') AS "source",
          COALESCE(SUM(CASE WHEN "state" = 'ESTIMATED' THEN "amount" ELSE 0 END), 0) AS "estimated",
          COALESCE(SUM(CASE WHEN "state" IN ('FINAL', 'ADJUSTMENT') THEN "amount" ELSE 0 END), 0) AS "finalized"
        FROM "EarningsLedgerEntry"
        WHERE "channelId" = ${channel.id}::uuid
          AND "currency" = ${currency}
          AND "occurredAt" >= ${from90d}
        GROUP BY COALESCE(NULLIF(BTRIM("adSource"), ''), 'UNATTRIBUTED')
        ORDER BY "finalized" DESC, "source" ASC
      `,
      this.database.client.$queryRaw<MixedCurrencyRow[]>`
        SELECT COUNT(DISTINCT "currency") > 1 AS "mixedCurrency"
        FROM "EarningsLedgerEntry"
        WHERE "channelId" = ${channel.id}::uuid
          AND "occurredAt" >= ${from90d}
      `,
      this.database.client.analyticsEvent.count({
        where: { channelId: channel.id, eventName: "VIDEO_START", occurredAt: { gte: from30d } },
      }),
      this.database.client.analyticsEvent.count({
        where: { channelId: channel.id, eventName: "AD_START", occurredAt: { gte: from30d } },
      }),
    ]);

    const finalized30d = decimalToMicros(finalizedRows[0]?.amount);
    const mixedCurrency = mixedCurrencyRows[0]?.mixedCurrency ?? false;

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
      byDay: dailyRows.map((item) => ({
        day: item.day,
        estimated: microsToMoney(decimalToMicros(item.estimated)),
        finalized: microsToMoney(decimalToMicros(item.finalized)),
      })),
      byAdSource: sourceRows.map((item) => ({
        source: item.source,
        estimated: microsToMoney(decimalToMicros(item.estimated)),
        finalized: microsToMoney(decimalToMicros(item.finalized)),
      })),
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
