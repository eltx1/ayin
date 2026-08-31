import { Inject, Injectable } from "@nestjs/common";

import { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import { DatabaseService } from "../database/database.service.js";
import { formatMoneyMicros, parseMoneyMicros } from "./money.js";
import { payoutCreateSchema } from "./revenue.schemas.js";
import { RevenueService } from "./revenue.service.js";

type PayoutRequestSource = "ADMIN" | "CREATOR";

@Injectable()
export class AdminPayoutCreationService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
    @Inject(RevenueService) private readonly revenue: RevenueService,
  ) {}

  async create(actorAccountId: string, raw: unknown) {
    const data = payoutCreateSchema.parse(raw);
    return this.createWithBeneficiarySnapshot({
      actorAccountId,
      channelId: data.channelId,
      currency: data.currency,
      requestSource: "ADMIN",
      expectedProvider: "MANUAL",
    });
  }

  async createForCreator(input: {
    actorAccountId: string;
    channelId: string;
    requestedCurrency?: string | undefined;
    expectedProvider: string;
  }) {
    return this.createWithBeneficiarySnapshot({
      actorAccountId: input.actorAccountId,
      channelId: input.channelId,
      ...(input.requestedCurrency ? { currency: input.requestedCurrency } : {}),
      requestSource: "CREATOR",
      expectedProvider: input.expectedProvider,
    });
  }

  private async createWithBeneficiarySnapshot(input: {
    actorAccountId: string;
    channelId: string;
    currency?: string | undefined;
    requestSource: PayoutRequestSource;
    expectedProvider: string;
  }) {
    const settings = await this.revenue.getSettings();
    const threshold = BigInt(settings.payoutThresholdMicros);

    return this.database.client.$transaction(async (tx) => {
      await tx.channel.findUniqueOrThrow({ where: { id: input.channelId } });

      // The payout profile is deliberately read inside the same transaction that creates the
      // payout and reserves its ledger entries. This prevents an active payout from ever existing
      // without an immutable beneficiary snapshot if the process is interrupted between writes.
      const profile = await tx.creatorPayoutProfile.findUnique({
        where: { channelId: input.channelId },
      });
      if (!profile?.destinationEncrypted || !profile.destinationMask || !profile.legalName) {
        throw new Error("PAYOUT_PROFILE_INCOMPLETE");
      }
      if (profile.provider !== input.expectedProvider) {
        throw new Error("PAYOUT_PROVIDER_NOT_CONNECTED");
      }

      const data = payoutCreateSchema.parse({
        channelId: input.channelId,
        currency: input.currency ?? profile.preferredCurrency,
      });

      const activePayout = await tx.payout.count({
        where: {
          channelId: data.channelId,
          currency: data.currency,
          status: { in: ["PENDING", "PROCESSING"] },
        },
      });
      if (activePayout > 0) throw new Error("PAYOUT_ALREADY_IN_PROGRESS");

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
          provider: profile.provider,
          requestSource: input.requestSource,
          paymentProfileId: profile.id,
          destinationEncryptedSnapshot: profile.destinationEncrypted,
          destinationMaskSnapshot: profile.destinationMask,
          legalNameSnapshot: profile.legalName,
          countryCodeSnapshot: profile.countryCode,
        },
      });

      const reserved = await tx.earningsLedgerEntry.updateMany({
        where: {
          id: { in: entries.map((entry) => entry.id) },
          payoutId: null,
        },
        data: { payoutId: payout.id },
      });
      if (reserved.count !== entries.length) {
        throw new Error("PAYOUT_BALANCE_RESERVATION_CONFLICT");
      }

      await this.audit.recordInTransaction(tx, {
        actorAccountId: input.actorAccountId,
        action: "PAYOUT_CREATED",
        entityType: "Payout",
        entityId: payout.id,
        metadata: {
          channelId: data.channelId,
          amount: formatMoneyMicros(amountMicros),
          currency: data.currency,
          entryCount: entries.length,
          requestSource: input.requestSource,
          paymentProfileId: profile.id,
          beneficiarySnapshotted: true,
        },
      });

      // Encrypted beneficiary material never leaves this transaction through an ordinary API
      // response. Only the dedicated audited reveal endpoint is allowed to decrypt a snapshot.
      return {
        id: payout.id,
        channelId: payout.channelId,
        status: payout.status,
        amount: String(payout.amount),
        currency: payout.currency,
        externalReference: payout.externalReference,
        provider: payout.provider,
        requestSource: payout.requestSource,
        paymentProfileId: payout.paymentProfileId,
        destinationMaskSnapshot: payout.destinationMaskSnapshot,
        legalNameSnapshot: payout.legalNameSnapshot,
        countryCodeSnapshot: payout.countryCodeSnapshot,
        requestedAt: payout.requestedAt,
        processedAt: payout.processedAt,
        paidAt: payout.paidAt,
        failureReason: payout.failureReason,
        createdAt: payout.createdAt,
        updatedAt: payout.updatedAt,
        paymentIntegration: "NOT_CONFIGURED" as const,
      };
    });
  }
}
