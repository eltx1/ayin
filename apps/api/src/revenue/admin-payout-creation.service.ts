import { Inject, Injectable } from "@nestjs/common";

import { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import { DatabaseService } from "../database/database.service.js";
import { formatMoneyMicros, parseMoneyMicros } from "./money.js";
import { payoutCreateSchema } from "./revenue.schemas.js";
import { RevenueService } from "./revenue.service.js";

@Injectable()
export class AdminPayoutCreationService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
    @Inject(RevenueService) private readonly revenue: RevenueService,
  ) {}

  async create(actorAccountId: string, raw: unknown) {
    const data = payoutCreateSchema.parse(raw);
    const settings = await this.revenue.getSettings();
    const threshold = BigInt(settings.payoutThresholdMicros);

    return this.database.client.$transaction(async (tx) => {
      await tx.channel.findUniqueOrThrow({ where: { id: data.channelId } });

      const activePayout = await tx.payout.count({
        where: {
          channelId: data.channelId,
          currency: data.currency,
          status: { in: ["PENDING", "PROCESSING"] },
        },
      });
      if (activePayout > 0) throw new Error("PAYOUT_ALREADY_IN_PROGRESS");

      // Finance-created payouts must capture the beneficiary that exists at creation time.
      // Never depend on the mutable creator profile later when an operator reveals a destination.
      const profile = await tx.creatorPayoutProfile.findUnique({
        where: { channelId: data.channelId },
      });
      if (!profile?.destinationEncrypted || !profile.destinationMask || !profile.legalName) {
        throw new Error("PAYOUT_PROFILE_INCOMPLETE");
      }

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
          provider: "MANUAL",
          requestSource: "ADMIN",
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
        actorAccountId,
        action: "PAYOUT_CREATED",
        entityType: "Payout",
        entityId: payout.id,
        metadata: {
          channelId: data.channelId,
          amount: formatMoneyMicros(amountMicros),
          currency: data.currency,
          entryCount: entries.length,
          requestSource: "ADMIN",
          paymentProfileId: profile.id,
          beneficiarySnapshotted: true,
        },
      });

      // Deliberately never return the encrypted destination through the ordinary admin API.
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
