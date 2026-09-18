import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { AdminPayoutCreationService } from "./admin-payout-creation.service.js";
import { encryptPayoutDestination, maskPayoutDestination } from "./creator-finance.crypto.js";
import {
  EXTERNAL_PAYOUT_PROVIDER_ADAPTER,
  type ExternalPayoutProviderAdapter,
} from "./external-payout-provider.adapter.js";
import {
  CreatorFinanceRepository,
  type CreatorPayoutProfileRow,
  type RevenueDisputeStatus,
} from "./creator-finance.repository.js";
import { PAYOUT_PROVIDER_ADAPTER, type PayoutProviderAdapter } from "./payout-provider.adapter.js";
import { PayoutProviderTransferService } from "./payout-provider-transfer.service.js";
import { toSafePayoutView } from "./payout-safe-view.js";
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
    @Inject(AdminPayoutCreationService)
    private readonly payoutCreation: AdminPayoutCreationService,
    @Inject(PAYOUT_PROVIDER_ADAPTER) private readonly payoutProvider: PayoutProviderAdapter,
    @Inject(EXTERNAL_PAYOUT_PROVIDER_ADAPTER)
    private readonly externalPayoutProvider: ExternalPayoutProviderAdapter,
    @Inject(PayoutProviderTransferService)
    private readonly providerTransfers: PayoutProviderTransferService,
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
    const externalCapabilities = this.externalPayoutProvider.capabilities();
    const externalProfileReady = Boolean(
      profile &&
      profile.provider === externalCapabilities.provider &&
      externalCapabilities.connected &&
      externalCapabilities.productionEnabled &&
      externalCapabilities.idempotentSubmission &&
      externalCapabilities.supportsDestinationTokenization &&
      profile.providerDestinationTokenEncrypted &&
      profile.providerDestinationVerifiedAt,
    );
    const manualProfileReady = Boolean(
      profile &&
      profile.provider === this.payoutProvider.kind &&
      this.payoutProvider.connected &&
      profile.destinationEncrypted,
    );
    const profileReady = Boolean(
      profile?.legalName && profile.destinationMask && (manualProfileReady || externalProfileReady),
    );
    const thresholdMet = thresholdMicros <= 0n || availableMicros >= thresholdMicros;
    const providerReady = Boolean(manualProfileReady || externalProfileReady);
    const progress =
      thresholdMicros <= 0n
        ? 100
        : Number(((availableMicros > 0n ? availableMicros : 0n) * 10_000n) / thresholdMicros) / 100;

    return {
      ...base,
      payouts: base.payouts.map((payout) => toSafePayoutView(payout)),
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
        activeProvider: profile?.provider ?? this.payoutProvider.kind,
        manualPayoutEnabled: this.payoutProvider.kind === "MANUAL" && this.payoutProvider.connected,
        externalProvidersConnected:
          externalCapabilities.connected && externalCapabilities.productionEnabled,
        externalProvider: {
          provider: externalCapabilities.provider,
          connected: externalCapabilities.connected,
          productionEnabled: externalCapabilities.productionEnabled,
        },
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

    const externalCapabilities = this.externalPayoutProvider.capabilities();
    const configuredExternalProfile =
      input.provider === externalCapabilities.provider &&
      externalCapabilities.connected &&
      externalCapabilities.productionEnabled;
    if (input.provider !== "MANUAL" && !configuredExternalProfile) {
      throw new Error("PAYOUT_PROVIDER_NOT_CONNECTED");
    }
    const tokenizedExternalProfile =
      configuredExternalProfile && externalCapabilities.supportsDestinationTokenization;
    if (tokenizedExternalProfile && input.destination) {
      throw new Error("PAYOUT_PROVIDER_USE_TOKENIZED_DESTINATION");
    }

    const encrypted = input.destination ? encryptPayoutDestination(input.destination) : null;
    const mask = input.destination ? maskPayoutDestination(input.destination) : null;

    const saved = await this.database.client.$transaction(async (tx) => {
      const existing = await tx.creatorPayoutProfile.findUnique({
        where: { channelId: channel.id },
        select: {
          provider: true,
          destinationEncrypted: true,
          providerDestinationTokenEncrypted: true,
        },
      });
      const providerChanged = Boolean(existing && existing.provider !== input.provider);
      const reusableManualDestination =
        input.provider === "MANUAL" &&
        existing?.provider === "MANUAL" &&
        existing.destinationEncrypted;
      const reusableExternalToken =
        !providerChanged && Boolean(existing?.providerDestinationTokenEncrypted);
      if (
        !tokenizedExternalProfile &&
        !encrypted &&
        !reusableManualDestination &&
        input.provider === "MANUAL"
      ) {
        throw new Error("PAYOUT_DESTINATION_REQUIRED");
      }
      if (tokenizedExternalProfile && !reusableExternalToken && !existing) {
        // The profile can be created before provider-side token verification. Payout readiness
        // remains false until verifyDestination stores the encrypted provider token.
      }

      // Beneficiary details and their audit row are one atomic finance mutation. Any failure in
      // either write rolls the complete profile update back.
      const profile = await tx.creatorPayoutProfile.upsert({
        where: { channelId: channel.id },
        update: {
          legalName: input.legalName,
          preferredCurrency: input.preferredCurrency,
          provider: input.provider,
          ...(encrypted !== null ? { destinationEncrypted: encrypted, destinationMask: mask } : {}),
          ...(providerChanged
            ? {
                providerDestinationTokenEncrypted: null,
                providerDestinationVerifiedAt: null,
              }
            : {}),
          countryCode: input.countryCode ?? null,
        },
        create: {
          channelId: channel.id,
          legalName: input.legalName,
          preferredCurrency: input.preferredCurrency,
          provider: input.provider,
          destinationEncrypted: encrypted,
          destinationMask: mask,
          providerDestinationTokenEncrypted: null,
          providerDestinationVerifiedAt: null,
          countryCode: input.countryCode ?? null,
        },
      });

      await tx.adminAuditLog.create({
        data: {
          actorAccountId: accountId,
          action: "creator.payout_profile_updated",
          entityType: "CreatorPayoutProfile",
          entityId: profile.id,
          metadata: {
            channelId: channel.id,
            provider: profile.provider,
            preferredCurrency: profile.preferredCurrency,
            destinationConfigured: Boolean(profile.destinationEncrypted),
          },
        },
      });
      return profile;
    });

    return this.serializeProfile(saved as CreatorPayoutProfileRow);
  }

  async requestPayout(accountId: string, raw: unknown) {
    const input = creatorPayoutRequestSchema.parse(raw);
    const channel = await this.creatorChannel(accountId);
    if (!channel) throw new Error("CREATOR_CHANNEL_NOT_FOUND");
    const profile = await this.finance.getProfile(channel.id);
    if (!profile?.destinationMask || !profile.legalName) {
      throw new Error("PAYOUT_PROFILE_INCOMPLETE");
    }
    const externalCapabilities = this.externalPayoutProvider.capabilities();
    const manualProviderReady =
      profile.provider === this.payoutProvider.kind &&
      this.payoutProvider.connected &&
      Boolean(profile.destinationEncrypted);
    const externalProviderReady =
      profile.provider === externalCapabilities.provider &&
      externalCapabilities.connected &&
      externalCapabilities.productionEnabled &&
      externalCapabilities.idempotentSubmission &&
      externalCapabilities.supportsDestinationTokenization &&
      Boolean(profile.providerDestinationTokenEncrypted) &&
      Boolean(profile.providerDestinationVerifiedAt);
    if (!manualProviderReady && !externalProviderReady) {
      throw new Error("PAYOUT_PROVIDER_NOT_CONNECTED");
    }

    const payout = await this.payoutCreation.createForCreator({
      actorAccountId: accountId,
      channelId: channel.id,
      ...(input.currency ? { requestedCurrency: input.currency } : {}),
      expectedProvider: profile.provider,
    });
    if (!payout.destinationMaskSnapshot) {
      throw new Error("PAYOUT_PROFILE_INCOMPLETE");
    }

    if (externalProviderReady) {
      const submitted = await this.providerTransfers.submit(accountId, payout.id, {
        reason: "Creator requested payout through the configured external provider.",
      });
      await this.database.client.adminAuditLog.create({
        data: {
          actorAccountId: accountId,
          action: "creator.payout_requested",
          entityType: "Payout",
          entityId: payout.id,
          metadata: {
            channelId: channel.id,
            currency: payout.currency,
            provider: externalCapabilities.provider,
            providerMode: "EXTERNAL_PROVIDER",
            paymentProfileId: payout.paymentProfileId,
            payoutStatus: submitted.payout.status,
          },
        },
      });
      return {
        payout: submitted.payout,
        requestSource: "CREATOR",
        provider: externalCapabilities.provider,
        destinationMask: payout.destinationMaskSnapshot,
        paymentIntegration: "EXTERNAL_PROVIDER" as const,
      };
    }

    const handoff = await this.payoutProvider.createHandoff({
      payoutId: payout.id,
      channelId: channel.id,
      amount: payout.amount,
      currency: payout.currency,
      destinationMask: payout.destinationMaskSnapshot,
    });
    if (!handoff.accepted) {
      await this.revenue.updatePayoutStatus(accountId, payout.id, {
        status: "CANCELLED",
        reason: "Payout provider did not accept the payout handoff.",
        failureReason: "PAYOUT_PROVIDER_HANDOFF_REJECTED",
      });
      throw new Error("PAYOUT_PROVIDER_HANDOFF_REJECTED");
    }

    await this.database.client.adminAuditLog.create({
      data: {
        actorAccountId: accountId,
        action: "creator.payout_requested",
        entityType: "Payout",
        entityId: payout.id,
        metadata: {
          channelId: channel.id,
          currency: payout.currency,
          provider: handoff.provider,
          providerMode: handoff.mode,
          paymentProfileId: payout.paymentProfileId,
        },
      },
    });

    return {
      payout: toSafePayoutView(payout),
      requestSource: "CREATOR",
      provider: handoff.provider,
      destinationMask: payout.destinationMaskSnapshot,
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
    const externalCapabilities = this.externalPayoutProvider.capabilities();
    return {
      pendingPayouts: pending,
      processingPayouts: processing,
      openDisputes: Number(disputes[0]?.count ?? 0n),
      pendingValue,
      mode:
        externalCapabilities.connected && externalCapabilities.productionEnabled
          ? ("PROVIDER_AND_MANUAL_PAYOUT" as const)
          : ("MANUAL_PAYOUT" as const),
      externalProvidersConnected:
        externalCapabilities.connected && externalCapabilities.productionEnabled,
      externalProvider: {
        provider: externalCapabilities.provider,
        connected: externalCapabilities.connected,
        productionEnabled: externalCapabilities.productionEnabled,
      },
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
      hasDestination: Boolean(
        profile.destinationEncrypted || profile.providerDestinationTokenEncrypted,
      ),
      providerDestinationVerifiedAt: profile.providerDestinationVerifiedAt,
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
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { channel: { select: { id: true, name: true, handle: true } } },
    });
    return membership?.channel ?? null;
  }
}
