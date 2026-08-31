import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { encryptPayoutDestination, maskPayoutDestination } from "./creator-finance.crypto.js";
import {
  CreatorFinanceRepository,
  type CreatorPayoutProfileRow,
  type RevenueDisputeStatus,
} from "./creator-finance.repository.js";
import { PAYOUT_PROVIDER_ADAPTER, type PayoutProviderAdapter } from "./payout-provider.adapter.js";
import {
  creatorPayoutRequestSchema,
  payoutProfileSchema,
  revenueDisputeCreateSchema,
  revenueDisputeUpdateSchema,
} from "./revenue.schemas.js";
import { RevenueService } from "./revenue.service.js";

function moneyToMicros(value: string): bigint {
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
  const whole = absolute / 1_000_000n;
  const fraction = (absolute % 1_000_000n).toString().padStart(6, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

@Injectable()
export class CreatorFinanceService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CreatorFinanceRepository) private readonly finance: CreatorFinanceRepository,
    @Inject(RevenueService) private readonly revenue: RevenueService,
    @Inject(PAYOUT_PROVIDER_ADAPTER) private readonly payoutProvider: PayoutProviderAdapter,
  ) {}

  async overview(accountId: string) {
    const base = await this.revenue.creatorRevenue(accountId);
    if (!base) return null;

    const [settings, profile, ledger] = await Promise.all([
      this.revenue.getSettings(),
      this.finance.getProfile(base.channel.id),
      this.revenue.searchLedger({ channelId: base.channel.id, page: 1, take: 10 }),
    ]);

    const finalizedMicros = moneyToMicros(base.finalizedRevenue);
    const availableMicros = moneyToMicros(base.availableForPayout);
    const onHoldMicros = finalizedMicros - availableMicros;
    const thresholdMicros = BigInt(settings.payoutThresholdMicros);
    const openPayout = base.payouts.some(
      (payout) => payout.status === "PENDING" || payout.status === "PROCESSING",
    );
    const profileReady = Boolean(
      profile?.legalName && profile.destinationEncrypted && profile.destinationMask,
    );
    const thresholdMet = thresholdMicros <= 0n || availableMicros >= thresholdMicros;
    const providerReady = Boolean(
      profile && profile.provider === this.payoutProvider.kind && this.payoutProvider.connected,
    );
    const progress =
      thresholdMicros <= 0n
        ? 100
        : Number(((availableMicros > 0n ? availableMicros : 0n) * 10_000n) / thresholdMicros) / 100;

    return {
      ...base,
      onHoldForPayout: microsToMoney(onHoldMicros > 0n ? onHoldMicros : 0n),
      payoutThreshold: microsToMoney(thresholdMicros),
      payoutProgressPercent: Math.min(100, Math.max(0, progress)),
      canRequestPayout: profileReady && thresholdMet && !openPayout && providerReady,
      payoutReadiness: {
        profileReady,
        thresholdMet,
        openPayout,
        providerReady,
      },
      paymentProfile: this.serializeProfile(profile),
      recentLedger: ledger.items,
      providerConnection: {
        activeProvider: this.payoutProvider.kind,
        manualPayoutEnabled: this.payoutProvider.kind === "MANUAL" && this.payoutProvider.connected,
        externalProvidersConnected: false,
      },
    };
  }

  async getProfile(accountId: string) {
    const channel = await this.creatorChannel(accountId);
    if (!channel) return null;
    return this.serializeProfile(await this.finance.getProfile(channel.id));
  }

  async updateProfile(accountId: string, raw: unknown) {
    const input = payoutProfileSchema.parse(raw);
    const channel = await this.creatorChannel(accountId);
    if (!channel) throw new Error("CREATOR_CHANNEL_NOT_FOUND");

    const existing = await this.finance.getProfile(channel.id);
    let encrypted: string | null = null;
    let mask: string | null = null;
    if (input.destination) {
      encrypted = encryptPayoutDestination(input.destination);
      mask = maskPayoutDestination(input.destination);
    } else if (!existing?.destinationEncrypted) {
      throw new Error("PAYOUT_DESTINATION_REQUIRED");
    }

    const saved = await this.finance.upsertProfile({
      channelId: channel.id,
      legalName: input.legalName,
      preferredCurrency: input.preferredCurrency,
      provider: input.provider,
      destinationEncrypted: encrypted,
      destinationMask: mask,
      countryCode: input.countryCode ?? null,
    });

    await this.database.client.adminAuditLog.create({
      data: {
        actorAccountId: accountId,
        action: "creator.payout_profile_updated",
        entityType: "CreatorPayoutProfile",
        entityId: saved.id,
        metadata: {
          channelId: channel.id,
          provider: saved.provider,
          preferredCurrency: saved.preferredCurrency,
          destinationConfigured: Boolean(saved.destinationEncrypted),
        },
      },
    });

    return this.serializeProfile(saved);
  }

  async requestPayout(accountId: string, raw: unknown) {
    const input = creatorPayoutRequestSchema.parse(raw);
    const channel = await this.creatorChannel(accountId);
    if (!channel) throw new Error("CREATOR_CHANNEL_NOT_FOUND");
    const profile = await this.finance.getProfile(channel.id);
    if (!profile?.destinationEncrypted || !profile.destinationMask || !profile.legalName) {
      throw new Error("PAYOUT_PROFILE_INCOMPLETE");
    }
    if (profile.provider !== this.payoutProvider.kind || !this.payoutProvider.connected) {
      throw new Error("PAYOUT_PROVIDER_NOT_CONNECTED");
    }

    const currency = input.currency ?? profile.preferredCurrency;
    const activePayout = await this.database.client.payout.count({
      where: { channelId: channel.id, currency, status: { in: ["PENDING", "PROCESSING"] } },
    });
    if (activePayout > 0) throw new Error("PAYOUT_ALREADY_IN_PROGRESS");

    const payout = await this.revenue.createPayout(accountId, { channelId: channel.id, currency });
    const handoff = await this.payoutProvider.createHandoff({
      payoutId: payout.id,
      channelId: channel.id,
      amount: payout.amount,
      currency,
      destinationMask: profile.destinationMask,
    });
    if (!handoff.accepted) {
      await this.revenue.updatePayoutStatus(accountId, payout.id, {
        status: "CANCELLED",
        reason: "Payout provider did not accept the payout handoff.",
        failureReason: "PAYOUT_PROVIDER_HANDOFF_REJECTED",
      });
      throw new Error("PAYOUT_PROVIDER_HANDOFF_REJECTED");
    }

    await this.database.client.$executeRaw`
      UPDATE "Payout"
      SET "provider" = ${this.payoutProvider.kind}, "requestSource" = 'CREATOR', "paymentProfileId" = ${profile.id}::uuid
      WHERE "id" = ${payout.id}::uuid
    `;
    await this.database.client.adminAuditLog.create({
      data: {
        actorAccountId: accountId,
        action: "creator.payout_requested",
        entityType: "Payout",
        entityId: payout.id,
        metadata: {
          channelId: channel.id,
          currency,
          provider: handoff.provider,
          providerMode: handoff.mode,
          paymentProfileId: profile.id,
        },
      },
    });

    return {
      payout,
      requestSource: "CREATOR",
      provider: handoff.provider,
      destinationMask: profile.destinationMask,
      paymentIntegration: handoff.mode,
    };
  }

  async listDisputes(accountId: string) {
    const channel = await this.creatorChannel(accountId);
    if (!channel) return null;
    return this.finance.listCreatorDisputes(channel.id);
  }

  async createDispute(accountId: string, raw: unknown) {
    const input = revenueDisputeCreateSchema.parse(raw);
    const channel = await this.creatorChannel(accountId);
    if (!channel) throw new Error("CREATOR_CHANNEL_NOT_FOUND");
    if (input.payoutId) {
      const payout = await this.database.client.payout.findFirst({
        where: { id: input.payoutId, channelId: channel.id },
        select: { id: true },
      });
      if (!payout) throw new Error("PAYOUT_NOT_FOUND");
    }
    const dispute = await this.finance.createDispute({
      channelId: channel.id,
      payoutId: input.payoutId ?? null,
      createdByAccountId: accountId,
      category: input.category,
      message: input.message,
    });
    await this.database.client.adminAuditLog.create({
      data: {
        actorAccountId: accountId,
        action: "creator.revenue_dispute_created",
        entityType: "RevenueDispute",
        entityId: dispute.id,
        metadata: {
          channelId: channel.id,
          category: dispute.category,
          ...(dispute.payoutId ? { payoutId: dispute.payoutId } : {}),
        },
      },
    });
    return dispute;
  }

  async adminDisputes(status?: string) {
    const allowed: RevenueDisputeStatus[] = ["OPEN", "REVIEWING", "RESOLVED", "REJECTED"];
    if (status && !allowed.includes(status as RevenueDisputeStatus)) {
      throw new Error("INVALID_REVENUE_DISPUTE_STATUS");
    }
    return this.finance.listAdminDisputes(status as RevenueDisputeStatus | undefined);
  }

  async updateAdminDispute(actorAccountId: string, disputeId: string, raw: unknown) {
    const input = revenueDisputeUpdateSchema.parse(raw);
    const dispute = await this.finance.updateDispute({
      disputeId,
      status: input.status,
      resolution: input.resolution ?? null,
      resolvedByAccountId: actorAccountId,
    });
    await this.database.client.adminAuditLog.create({
      data: {
        actorAccountId,
        action: "revenue.dispute_updated",
        entityType: "RevenueDispute",
        entityId: dispute.id,
        reason: input.reason,
        metadata: {
          status: dispute.status,
          channelId: dispute.channelId,
          ...(dispute.payoutId ? { payoutId: dispute.payoutId } : {}),
        },
      },
    });
    return dispute;
  }

  async adminFinanceSummary() {
    const [pending, processing, disputes, pendingValue] = await Promise.all([
      this.database.client.payout.count({ where: { status: "PENDING" } }),
      this.database.client.payout.count({ where: { status: "PROCESSING" } }),
      this.database.client.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS "count" FROM "RevenueDispute" WHERE "status" IN ('OPEN', 'REVIEWING')
      `,
      this.database.client.$queryRaw<Array<{ currency: string; amount: string }>>`
        SELECT "currency", COALESCE(SUM("amount"), 0)::text AS "amount"
        FROM "Payout"
        WHERE "status" IN ('PENDING', 'PROCESSING')
        GROUP BY "currency"
        ORDER BY "currency"
      `,
    ]);
    return {
      pendingPayouts: pending,
      processingPayouts: processing,
      openDisputes: Number(disputes[0]?.count ?? 0n),
      pendingValue,
      mode: "MANUAL_PAYOUT",
      externalProvidersConnected: false,
    };
  }

  private serializeProfile(profile: CreatorPayoutProfileRow | null) {
    if (!profile) return null;
    return {
      id: profile.id,
      channelId: profile.channelId,
      legalName: profile.legalName,
      preferredCurrency: profile.preferredCurrency,
      provider: profile.provider,
      destinationMask: profile.destinationMask,
      countryCode: profile.countryCode,
      identityStatus: profile.identityStatus,
      taxStatus: profile.taxStatus,
      hasDestination: Boolean(profile.destinationEncrypted),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
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
