import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import { DatabaseService } from "../database/database.service.js";
import { selectEffectiveContract } from "./contract-selection.js";
import {
  applyRevenueShareMicros,
  formatMoneyMicros,
  parseMoneyMicros,
} from "./money.js";
import {
  adjustmentSchema,
  contractOverrideSchema,
  ledgerQuerySchema,
  payoutCreateSchema,
  payoutStatusSchema,
  revenueImportSchema,
  revenueSettingsSchema,
} from "./revenue.schemas.js";

const DEFAULT_CREATOR_SHARE_BPS = 0;
const DEFAULT_PAYOUT_THRESHOLD_MICROS = "0";

type Tx = Prisma.TransactionClient;

@Injectable()
export class RevenueService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
  ) {}

  async getSettings() {
    const rows = await this.database.client.platformSetting.findMany({
      where: {
        namespace: "MONETIZATION",
        key: { in: ["defaultCreatorRevenueShareBps", "payoutThresholdMicros"] },
      },
      select: { key: true, value: true },
    });
    const values = new Map(rows.map((row) => [row.key, row.value]));
    const rawShare = values.get("defaultCreatorRevenueShareBps");
    const rawThreshold = values.get("payoutThresholdMicros");
    return {
      defaultCreatorRevenueShareBps:
        typeof rawShare === "number" && Number.isInteger(rawShare)
          ? Math.max(0, Math.min(10_000, rawShare))
          : DEFAULT_CREATOR_SHARE_BPS,
      payoutThresholdMicros:
        typeof rawThreshold === "string" && /^\d+$/.test(rawThreshold)
          ? rawThreshold
          : DEFAULT_PAYOUT_THRESHOLD_MICROS,
    };
  }

  async updateSettings(actorAccountId: string, input: unknown) {
    const settings = revenueSettingsSchema.parse(input);
    await this.database.client.$transaction(async (tx) => {
      await tx.platformSetting.upsert({
        where: {
          namespace_key: {
            namespace: "MONETIZATION",
            key: "defaultCreatorRevenueShareBps",
          },
        },
        update: {
          value: settings.defaultCreatorRevenueShareBps,
          valueType: "INTEGER",
          schemaVersion: 1,
        },
        create: {
          namespace: "MONETIZATION",
          key: "defaultCreatorRevenueShareBps",
          valueType: "INTEGER",
          value: settings.defaultCreatorRevenueShareBps,
          schemaVersion: 1,
          description: "Default creator revenue share in basis points.",
        },
      });
      await tx.platformSetting.upsert({
        where: {
          namespace_key: { namespace: "MONETIZATION", key: "payoutThresholdMicros" },
        },
        update: { value: settings.payoutThresholdMicros, valueType: "STRING", schemaVersion: 1 },
        create: {
          namespace: "MONETIZATION",
          key: "payoutThresholdMicros",
          valueType: "STRING",
          value: settings.payoutThresholdMicros,
          schemaVersion: 1,
          description: "Minimum finalized creator balance in six-decimal currency micros.",
        },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "REVENUE_SETTINGS_UPDATED",
        entityType: "PlatformSetting",
        entityId: "MONETIZATION/revenue",
        metadata: {
          defaultCreatorRevenueShareBps: settings.defaultCreatorRevenueShareBps,
          payoutThresholdMicros: settings.payoutThresholdMicros,
        },
      });
    });
    return settings;
  }

  async getChannelContracts(channelId: string) {
    await this.database.client.channel.findUniqueOrThrow({ where: { id: channelId } });
    const [settings, contracts] = await Promise.all([
      this.getSettings(),
      this.database.client.creatorContract.findMany({
        where: { channelId },
        orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      }),
    ]);
    return { defaultRevenueShareBps: settings.defaultCreatorRevenueShareBps, contracts };
  }

  async createChannelContract(actorAccountId: string, channelId: string, input: unknown) {
    const data = contractOverrideSchema.parse(input);
    await this.database.client.channel.findUniqueOrThrow({ where: { id: channelId } });
    return this.database.client.$transaction(async (tx) => {
      const contract = await tx.creatorContract.create({
        data: {
          channelId,
          status: data.status,
          revenueShareBps: data.revenueShareBps,
          effectiveFrom: new Date(data.effectiveFrom),
          ...(data.effectiveTo ? { effectiveTo: new Date(data.effectiveTo) } : {}),
          ...(data.termsVersion ? { termsVersion: data.termsVersion } : {}),
        },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "CREATOR_CONTRACT_CREATED",
        entityType: "CreatorContract",
        entityId: contract.id,
        metadata: {
          channelId,
          revenueShareBps: data.revenueShareBps,
          effectiveFrom: data.effectiveFrom,
          effectiveTo: data.effectiveTo ?? null,
          status: data.status,
        },
      });
      return contract;
    });
  }

  async resolveContract(channelId: string, at: Date) {
    return this.resolveContractWithClient(this.database.client, channelId, at);
  }

  async importRevenue(actorAccountId: string, input: unknown) {
    const data = revenueImportSchema.parse(input);
    return this.database.client.$transaction(async (tx) => {
      let created = 0;
      let duplicates = 0;
      for (const entry of data.entries) {
        const idempotencyKey = `${data.source}:${entry.idempotencyKey}`;
        const existing = await tx.earningsLedgerEntry.findUnique({
          where: { idempotencyKey },
          select: { id: true },
        });
        if (existing) {
          duplicates += 1;
          continue;
        }

        const periodStart = new Date(entry.periodStart);
        const periodEnd = new Date(entry.periodEnd);
        await this.assertAttribution(tx, entry.channelId, entry.videoId ?? null, entry.campaignId ?? null);
        const contract = await this.resolveContractWithClient(tx, entry.channelId, periodEnd);
        const grossMicros = parseMoneyMicros(entry.grossAmount);
        const creatorMicros = applyRevenueShareMicros(grossMicros, contract.revenueShareBps);
        await tx.earningsLedgerEntry.create({
          data: {
            channelId: entry.channelId,
            ...(contract.contractId ? { contractId: contract.contractId } : {}),
            ...(entry.campaignId ? { campaignId: entry.campaignId } : {}),
            ...(entry.videoId ? { videoId: entry.videoId } : {}),
            type: "AD_REVENUE",
            state: entry.state,
            grossAmount: formatMoneyMicros(grossMicros),
            amount: formatMoneyMicros(creatorMicros),
            currency: entry.currency,
            revenueShareBps: contract.revenueShareBps,
            idempotencyKey,
            adSource: entry.adSource ?? data.source,
            periodStart,
            periodEnd,
            occurredAt: periodEnd,
            ...(entry.state === "FINAL" ? { finalizedAt: new Date() } : {}),
            ...(entry.memo ? { memo: entry.memo } : {}),
          },
        });
        created += 1;
      }
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "REVENUE_IMPORTED",
        entityType: "EarningsLedgerEntry",
        entityId: data.source,
        metadata: { source: data.source, created, duplicates, requested: data.entries.length },
      });
      return { created, duplicates, requested: data.entries.length };
    });
  }

  async addAdjustment(actorAccountId: string, input: unknown) {
    const data = adjustmentSchema.parse(input);
    await this.assertAttribution(
      this.database.client,
      data.channelId,
      data.videoId ?? null,
      data.campaignId ?? null,
    );
    return this.database.client.$transaction(async (tx) => {
      const entry = await tx.earningsLedgerEntry.create({
        data: {
          channelId: data.channelId,
          ...(data.campaignId ? { campaignId: data.campaignId } : {}),
          ...(data.videoId ? { videoId: data.videoId } : {}),
          type: "ADJUSTMENT",
          state: "ADJUSTMENT",
          amount: formatMoneyMicros(parseMoneyMicros(data.amount)),
          currency: data.currency,
          memo: data.reason,
          ...(data.periodStart ? { periodStart: new Date(data.periodStart) } : {}),
          ...(data.periodEnd ? { periodEnd: new Date(data.periodEnd) } : {}),
          finalizedAt: new Date(),
        },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "REVENUE_ADJUSTMENT_CREATED",
        entityType: "EarningsLedgerEntry",
        entityId: entry.id,
        reason: data.reason,
        metadata: {
          channelId: data.channelId,
          amount: data.amount,
          currency: data.currency,
          videoId: data.videoId ?? null,
          campaignId: data.campaignId ?? null,
        },
      });
      return entry;
    });
  }

  async searchLedger(query: unknown) {
    const data = ledgerQuerySchema.parse(query);
    const where: Prisma.EarningsLedgerEntryWhereInput = {
      ...(data.channelId ? { channelId: data.channelId } : {}),
      ...(data.videoId ? { videoId: data.videoId } : {}),
      ...(data.campaignId ? { campaignId: data.campaignId } : {}),
      ...(data.state ? { state: data.state } : {}),
      ...(data.currency ? { currency: data.currency } : {}),
      ...(data.from || data.to
        ? {
            occurredAt: {
              ...(data.from ? { gte: new Date(data.from) } : {}),
              ...(data.to ? { lte: new Date(data.to) } : {}),
            },
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.database.client.earningsLedgerEntry.count({ where }),
      this.database.client.earningsLedgerEntry.findMany({
        where,
        include: {
          channel: { select: { name: true, handle: true } },
          video: { select: { title: true, slug: true } },
          campaign: { select: { name: true } },
          payout: { select: { id: true, status: true } },
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        skip: (data.page - 1) * data.take,
        take: data.take,
      }),
    ]);
    return {
      items: items.map((item) => this.serializeLedger(item)),
      pagination: {
        total,
        page: data.page,
        take: data.take,
        pages: Math.max(1, Math.ceil(total / data.take)),
      },
    };
  }

  async creatorRevenue(accountId: string) {
    const channel = await this.creatorChannel(accountId);
    if (!channel) return null;
    const [entries, payouts, contract] = await Promise.all([
      this.database.client.earningsLedgerEntry.findMany({
        where: { channelId: channel.id },
        include: { video: { select: { id: true, title: true } } },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 5000,
      }),
      this.database.client.payout.findMany({
        where: { channelId: channel.id },
        orderBy: [{ requestedAt: "desc" }],
        take: 100,
      }),
      this.resolveContract(channel.id, new Date()),
    ]);

    let estimated = 0n;
    let finalized = 0n;
    let available = 0n;
    const byVideo = new Map<string, { videoId: string; title: string; estimated: bigint; finalized: bigint }>();
    const byPeriod = new Map<string, { period: string; estimated: bigint; finalized: bigint }>();
    for (const entry of entries) {
      const amount = parseMoneyMicros(String(entry.amount));
      const isEstimated = entry.state === "ESTIMATED";
      if (isEstimated) estimated += amount;
      else finalized += amount;
      if (!isEstimated && entry.payoutId === null) available += amount;

      const period = (entry.periodStart ?? entry.occurredAt).toISOString().slice(0, 7);
      const periodBucket = byPeriod.get(period) ?? { period, estimated: 0n, finalized: 0n };
      if (isEstimated) periodBucket.estimated += amount;
      else periodBucket.finalized += amount;
      byPeriod.set(period, periodBucket);

      if (entry.videoId && entry.video) {
        const bucket = byVideo.get(entry.videoId) ?? {
          videoId: entry.videoId,
          title: entry.video.title,
          estimated: 0n,
          finalized: 0n,
        };
        if (isEstimated) bucket.estimated += amount;
        else bucket.finalized += amount;
        byVideo.set(entry.videoId, bucket);
      }
    }
    const currency = entries[0]?.currency ?? payouts[0]?.currency ?? "USD";
    return {
      channel,
      contract,
      currency,
      estimatedRevenue: formatMoneyMicros(estimated),
      finalizedRevenue: formatMoneyMicros(finalized),
      availableForPayout: formatMoneyMicros(available),
      byVideo: [...byVideo.values()]
        .map((item) => ({
          videoId: item.videoId,
          title: item.title,
          estimated: formatMoneyMicros(item.estimated),
          finalized: formatMoneyMicros(item.finalized),
        }))
        .sort((a, b) => b.finalized.localeCompare(a.finalized)),
      byPeriod: [...byPeriod.values()]
        .map((item) => ({
          period: item.period,
          estimated: formatMoneyMicros(item.estimated),
          finalized: formatMoneyMicros(item.finalized),
        }))
        .sort((a, b) => b.period.localeCompare(a.period)),
      payouts: payouts.map((payout) => ({
        ...payout,
        amount: String(payout.amount),
      })),
    };
  }

  async createPayout(actorAccountId: string, input: unknown) {
    const data = payoutCreateSchema.parse(input);
    const settings = await this.getSettings();
    const threshold = BigInt(settings.payoutThresholdMicros);
    return this.database.client.$transaction(async (tx) => {
      await tx.channel.findUniqueOrThrow({ where: { id: data.channelId } });
      const entries = await tx.earningsLedgerEntry.findMany({
        where: {
          channelId: data.channelId,
          currency: data.currency,
          payoutId: null,
          state: { in: ["FINAL", "ADJUSTMENT"] },
          type: { in: ["AD_REVENUE", "ADJUSTMENT"] },
        },
        select: { id: true, amount: true },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      });
      const amountMicros = entries.reduce(
        (total, entry) => total + parseMoneyMicros(String(entry.amount)),
        0n,
      );
      if (amountMicros <= 0n) throw new Error("NO_PAYABLE_BALANCE");
      if (amountMicros < threshold) throw new Error("PAYOUT_THRESHOLD_NOT_MET");
      const payout = await tx.payout.create({
        data: {
          channelId: data.channelId,
          amount: formatMoneyMicros(amountMicros),
          currency: data.currency,
          status: "PENDING",
        },
      });
      await tx.earningsLedgerEntry.updateMany({
        where: { id: { in: entries.map((entry) => entry.id) } },
        data: { payoutId: payout.id },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "PAYOUT_CREATED",
        entityType: "Payout",
        entityId: payout.id,
        metadata: {
          channelId: data.channelId,
          amount: formatMoneyMicros(amountMicros),
          currency: data.currency,
          entryCount: entries.length,
        },
      });
      return { ...payout, amount: String(payout.amount), paymentIntegration: "NOT_CONFIGURED" };
    });
  }

  async updatePayoutStatus(actorAccountId: string, payoutId: string, input: unknown) {
    const data = payoutStatusSchema.parse(input);
    return this.database.client.$transaction(async (tx) => {
      const current = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
      this.assertPayoutTransition(current.status, data.status);
      const now = new Date();
      const payout = await tx.payout.update({
        where: { id: payoutId },
        data: {
          status: data.status,
          ...(data.externalReference !== undefined
            ? { externalReference: data.externalReference }
            : {}),
          ...(data.failureReason !== undefined ? { failureReason: data.failureReason } : {}),
          ...(data.status === "PROCESSING" ? { processedAt: now } : {}),
          ...(data.status === "PAID" ? { processedAt: current.processedAt ?? now, paidAt: now } : {}),
        },
      });
      if (data.status === "FAILED" || data.status === "CANCELLED") {
        await tx.earningsLedgerEntry.updateMany({
          where: { payoutId },
          data: { payoutId: null },
        });
      }
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "PAYOUT_STATUS_UPDATED",
        entityType: "Payout",
        entityId: payoutId,
        reason: data.reason,
        metadata: { from: current.status, to: data.status },
      });
      return { ...payout, amount: String(payout.amount), paymentIntegration: "NOT_CONFIGURED" };
    });
  }

  async listPayouts(query: { channelId?: string; status?: string; page?: number; take?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const take = Math.max(1, Math.min(100, query.take ?? 25));
    const where: Prisma.PayoutWhereInput = {
      ...(query.channelId ? { channelId: query.channelId } : {}),
      ...(query.status && ["PENDING", "PROCESSING", "PAID", "FAILED", "CANCELLED"].includes(query.status)
        ? { status: query.status as Prisma.EnumPayoutStatusFilter["equals"] }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.database.client.payout.count({ where }),
      this.database.client.payout.findMany({
        where,
        include: { channel: { select: { name: true, handle: true } } },
        orderBy: [{ requestedAt: "desc" }],
        skip: (page - 1) * take,
        take,
      }),
    ]);
    return {
      items: items.map((item) => ({ ...item, amount: String(item.amount) })),
      pagination: { total, page, take, pages: Math.max(1, Math.ceil(total / take)) },
    };
  }

  private async resolveContractWithClient(
    client: Pick<Tx, "creatorContract" | "platformSetting"> | typeof this.database.client,
    channelId: string,
    at: Date,
  ) {
    const [contracts, defaultRow] = await Promise.all([
      client.creatorContract.findMany({
        where: {
          channelId,
          status: "ACTIVE",
          OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: at } }],
          AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] }],
        },
        orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      }),
      client.platformSetting.findUnique({
        where: {
          namespace_key: {
            namespace: "MONETIZATION",
            key: "defaultCreatorRevenueShareBps",
          },
        },
        select: { value: true },
      }),
    ]);
    const selected = selectEffectiveContract(contracts, at);
    const rawDefault = defaultRow?.value;
    const defaultBps =
      typeof rawDefault === "number" && Number.isInteger(rawDefault)
        ? Math.max(0, Math.min(10_000, rawDefault))
        : DEFAULT_CREATOR_SHARE_BPS;
    return selected
      ? {
          source: "CHANNEL_OVERRIDE" as const,
          contractId: selected.id,
          revenueShareBps: selected.revenueShareBps as number,
          effectiveFrom: selected.effectiveFrom,
          effectiveTo: selected.effectiveTo,
        }
      : {
          source: "ADMIN_DEFAULT" as const,
          contractId: null,
          revenueShareBps: defaultBps,
          effectiveFrom: null,
          effectiveTo: null,
        };
  }

  private async assertAttribution(
    client: Pick<Tx, "channel" | "video" | "campaign"> | typeof this.database.client,
    channelId: string,
    videoId: string | null,
    campaignId: string | null,
  ) {
    await client.channel.findUniqueOrThrow({ where: { id: channelId } });
    if (videoId) {
      const video = await client.video.findUniqueOrThrow({
        where: { id: videoId },
        select: { channelId: true },
      });
      if (video.channelId !== channelId) throw new Error("VIDEO_CHANNEL_MISMATCH");
    }
    if (campaignId) await client.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  }

  private async creatorChannel(accountId: string) {
    const membership = await this.database.client.channelMember.findFirst({
      where: {
        accountId,
        role: { in: ["OWNER", "ADMIN", "EDITOR"] },
        channel: { status: { not: "REMOVED" } },
      },
      orderBy: { createdAt: "asc" },
      select: { channel: { select: { id: true, name: true, handle: true } } },
    });
    return membership?.channel ?? null;
  }

  private serializeLedger<T extends { amount: unknown; grossAmount?: unknown }>(item: T) {
    return {
      ...item,
      amount: String(item.amount),
      ...(item.grossAmount !== undefined
        ? { grossAmount: item.grossAmount === null ? null : String(item.grossAmount) }
        : {}),
    };
  }

  private assertPayoutTransition(from: string, to: string) {
    if (from === to) return;
    const allowed: Record<string, string[]> = {
      PENDING: ["PROCESSING", "CANCELLED"],
      PROCESSING: ["PAID", "FAILED", "CANCELLED"],
      FAILED: [],
      PAID: [],
      CANCELLED: [],
    };
    if (!allowed[from]?.includes(to)) throw new Error("INVALID_PAYOUT_STATUS_TRANSITION");
  }
}
