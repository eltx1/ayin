import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import type { CreatorFinanceService } from "./creator-finance.service.js";
import { formatMoneyMicros, parseMoneyMicros } from "./money.js";
import { RevenueService } from "./revenue.service.js";

type CreatorRevenueOverview = NonNullable<Awaited<ReturnType<CreatorFinanceService["overview"]>>>;

interface RevenueTotalsRow {
  estimated: unknown;
  finalized: unknown;
  available: unknown;
  onHold: unknown;
}

interface RevenueVideoRow {
  videoId: string;
  title: string;
  estimated: unknown;
  finalized: unknown;
}

interface RevenuePeriodRow {
  period: string;
  estimated: unknown;
  finalized: unknown;
}

function moneyMicros(value: unknown): bigint {
  return parseMoneyMicros(String(value ?? "0"));
}

@Injectable()
export class CreatorRevenueCurrencyViewService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RevenueService) private readonly revenue: RevenueService,
  ) {}

  async normalize(overview: CreatorRevenueOverview): Promise<CreatorRevenueOverview> {
    const currency = overview.paymentProfile?.preferredCurrency ?? overview.currency;
    const channelId = overview.channel.id;
    const [totalsRows, videoRows, periodRows, recentLedger] = await Promise.all([
      this.database.client.$queryRaw<RevenueTotalsRow[]>`
        SELECT
          COALESCE(SUM(CASE WHEN e."state" = 'ESTIMATED' THEN e."amount" ELSE 0 END), 0) AS "estimated",
          COALESCE(SUM(CASE WHEN e."state" IN ('FINAL', 'ADJUSTMENT') THEN e."amount" ELSE 0 END), 0) AS "finalized",
          COALESCE(SUM(CASE
            WHEN e."state" IN ('FINAL', 'ADJUSTMENT') AND e."payoutId" IS NULL THEN e."amount"
            ELSE 0
          END), 0) AS "available",
          COALESCE(SUM(CASE
            WHEN e."state" IN ('FINAL', 'ADJUSTMENT') AND p."status" IN ('PENDING', 'PROCESSING') THEN e."amount"
            ELSE 0
          END), 0) AS "onHold"
        FROM "EarningsLedgerEntry" e
        LEFT JOIN "Payout" p ON p."id" = e."payoutId"
        WHERE e."channelId" = ${channelId}::uuid
          AND e."currency" = ${currency}
      `,
      this.database.client.$queryRaw<RevenueVideoRow[]>`
        SELECT
          e."videoId" AS "videoId",
          v."title" AS "title",
          COALESCE(SUM(CASE WHEN e."state" = 'ESTIMATED' THEN e."amount" ELSE 0 END), 0) AS "estimated",
          COALESCE(SUM(CASE WHEN e."state" IN ('FINAL', 'ADJUSTMENT') THEN e."amount" ELSE 0 END), 0) AS "finalized"
        FROM "EarningsLedgerEntry" e
        JOIN "Video" v ON v."id" = e."videoId"
        WHERE e."channelId" = ${channelId}::uuid
          AND e."currency" = ${currency}
          AND e."videoId" IS NOT NULL
        GROUP BY e."videoId", v."title"
        ORDER BY "finalized" DESC, "estimated" DESC, e."videoId" ASC
      `,
      this.database.client.$queryRaw<RevenuePeriodRow[]>`
        SELECT
          TO_CHAR(DATE_TRUNC('month', COALESCE(e."periodStart", e."occurredAt")), 'YYYY-MM') AS "period",
          COALESCE(SUM(CASE WHEN e."state" = 'ESTIMATED' THEN e."amount" ELSE 0 END), 0) AS "estimated",
          COALESCE(SUM(CASE WHEN e."state" IN ('FINAL', 'ADJUSTMENT') THEN e."amount" ELSE 0 END), 0) AS "finalized"
        FROM "EarningsLedgerEntry" e
        WHERE e."channelId" = ${channelId}::uuid
          AND e."currency" = ${currency}
        GROUP BY DATE_TRUNC('month', COALESCE(e."periodStart", e."occurredAt"))
        ORDER BY DATE_TRUNC('month', COALESCE(e."periodStart", e."occurredAt")) DESC
      `,
      this.revenue.searchLedger({
        channelId,
        currency,
        page: 1,
        take: 10,
      }),
    ]);

    const totals = totalsRows[0] ?? {
      estimated: "0",
      finalized: "0",
      available: "0",
      onHold: "0",
    };
    const estimated = moneyMicros(totals.estimated);
    const finalized = moneyMicros(totals.finalized);
    const available = moneyMicros(totals.available);
    const onHold = moneyMicros(totals.onHold);

    const thresholdMicros = parseMoneyMicros(overview.payoutThreshold);
    const positiveAvailable = available > 0n ? available : 0n;
    const thresholdMet = thresholdMicros <= 0n || available >= thresholdMicros;
    const openPayout = overview.payouts.some(
      (payout) =>
        payout.currency === currency &&
        (payout.status === "PENDING" || payout.status === "PROCESSING"),
    );
    const progress =
      thresholdMicros <= 0n ? 100 : Number((positiveAvailable * 10_000n) / thresholdMicros) / 100;
    const payoutReadiness = {
      ...overview.payoutReadiness,
      thresholdMet,
      openPayout,
    };

    return {
      ...overview,
      currency,
      estimatedRevenue: formatMoneyMicros(estimated),
      finalizedRevenue: formatMoneyMicros(finalized),
      availableForPayout: formatMoneyMicros(available),
      onHoldForPayout: formatMoneyMicros(onHold),
      payoutProgressPercent: Math.min(100, Math.max(0, progress)),
      payoutReadiness,
      canRequestPayout:
        payoutReadiness.profileReady &&
        payoutReadiness.thresholdMet &&
        !payoutReadiness.openPayout &&
        payoutReadiness.providerReady,
      byVideo: videoRows.map((item) => ({
        videoId: item.videoId,
        title: item.title,
        estimated: formatMoneyMicros(moneyMicros(item.estimated)),
        finalized: formatMoneyMicros(moneyMicros(item.finalized)),
      })),
      byPeriod: periodRows.map((item) => ({
        period: item.period,
        estimated: formatMoneyMicros(moneyMicros(item.estimated)),
        finalized: formatMoneyMicros(moneyMicros(item.finalized)),
      })),
      recentLedger: recentLedger.items,
    };
  }
}
