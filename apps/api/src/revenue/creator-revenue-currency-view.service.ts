import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import type { CreatorFinanceService } from "./creator-finance.service.js";
import { formatMoneyMicros, parseMoneyMicros } from "./money.js";
import { RevenueService } from "./revenue.service.js";

type CreatorRevenueOverview = NonNullable<Awaited<ReturnType<CreatorFinanceService["overview"]>>>;

@Injectable()
export class CreatorRevenueCurrencyViewService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RevenueService) private readonly revenue: RevenueService,
  ) {}

  async normalize(overview: CreatorRevenueOverview): Promise<CreatorRevenueOverview> {
    const currency = overview.paymentProfile?.preferredCurrency ?? overview.currency;
    const [entries, recentLedger] = await Promise.all([
      this.database.client.earningsLedgerEntry.findMany({
        where: { channelId: overview.channel.id, currency },
        include: {
          video: { select: { id: true, title: true, slug: true } },
          payout: { select: { id: true, status: true } },
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 5000,
      }),
      this.revenue.searchLedger({
        channelId: overview.channel.id,
        currency,
        page: 1,
        take: 10,
      }),
    ]);

    let estimated = 0n;
    let finalized = 0n;
    let available = 0n;
    let onHold = 0n;
    const byVideo = new Map<
      string,
      { videoId: string; title: string; estimated: bigint; finalized: bigint }
    >();
    const byPeriod = new Map<string, { period: string; estimated: bigint; finalized: bigint }>();

    for (const entry of entries) {
      const amount = parseMoneyMicros(String(entry.amount));
      const isEstimated = entry.state === "ESTIMATED";
      const isFinalized = entry.state === "FINAL" || entry.state === "ADJUSTMENT";
      if (isEstimated) estimated += amount;
      if (isFinalized) finalized += amount;
      if (isFinalized && entry.payoutId === null) available += amount;
      if (
        isFinalized &&
        entry.payout &&
        (entry.payout.status === "PENDING" || entry.payout.status === "PROCESSING")
      ) {
        onHold += amount;
      }

      const period = (entry.periodStart ?? entry.occurredAt).toISOString().slice(0, 7);
      const periodBucket = byPeriod.get(period) ?? { period, estimated: 0n, finalized: 0n };
      if (isEstimated) periodBucket.estimated += amount;
      if (isFinalized) periodBucket.finalized += amount;
      byPeriod.set(period, periodBucket);

      if (entry.videoId && entry.video) {
        const videoBucket = byVideo.get(entry.videoId) ?? {
          videoId: entry.videoId,
          title: entry.video.title,
          estimated: 0n,
          finalized: 0n,
        };
        if (isEstimated) videoBucket.estimated += amount;
        if (isFinalized) videoBucket.finalized += amount;
        byVideo.set(entry.videoId, videoBucket);
      }
    }

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
      byVideo: [...byVideo.values()]
        .map((item) => ({
          videoId: item.videoId,
          title: item.title,
          estimated: formatMoneyMicros(item.estimated),
          finalized: formatMoneyMicros(item.finalized),
        }))
        .sort((a, b) => Number(b.finalized) - Number(a.finalized)),
      byPeriod: [...byPeriod.values()]
        .map((item) => ({
          period: item.period,
          estimated: formatMoneyMicros(item.estimated),
          finalized: formatMoneyMicros(item.finalized),
        }))
        .sort((a, b) => b.period.localeCompare(a.period)),
      recentLedger: recentLedger.items,
    };
  }
}
