import { Prisma } from "@ayin/db";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";

import { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import { DatabaseService } from "../database/database.service.js";
import { assertAdminFinanceAuthority } from "./admin-finance-authority.js";
import { decryptPayoutDestination } from "./creator-finance.crypto.js";

const revealPayoutDestinationSchema = z
  .object({
    reason: z.string().trim().min(8).max(500),
  })
  .strict();

interface PayoutDestinationRow {
  payoutId: string;
  channelId: string;
  channelName: string;
  channelHandle: string;
  payoutStatus: string;
  payoutProvider: string;
  amount: string;
  currency: string;
  requestedAt: Date;
  processedAt: Date | null;
  paidAt: Date | null;
  externalReference: string | null;
  failureReason: string | null;
  paymentProfileId: string | null;
  legalName: string | null;
  destinationEncrypted: string | null;
  destinationMask: string | null;
  countryCode: string | null;
}

@Injectable()
export class AdminPayoutDestinationService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
  ) {}

  async details(payoutId: string) {
    const row = await this.payoutRow(this.validPayoutId(payoutId));
    const snapshotAvailable = Boolean(row.destinationEncrypted && row.legalName);
    return {
      payoutId: row.payoutId,
      channel: {
        id: row.channelId,
        name: row.channelName,
        handle: row.channelHandle,
      },
      status: row.payoutStatus,
      provider: row.payoutProvider,
      amount: row.amount,
      currency: row.currency,
      requestedAt: row.requestedAt,
      processedAt: row.processedAt,
      paidAt: row.paidAt,
      externalReference: row.externalReference,
      failureReason: row.failureReason,
      beneficiarySnapshotAvailable: snapshotAvailable,
      paymentProfile: row.paymentProfileId
        ? {
            id: row.paymentProfileId,
            legalName: row.legalName,
            provider: row.payoutProvider,
            destinationMask: row.destinationMask,
            countryCode: row.countryCode,
            hasDestination: Boolean(row.destinationEncrypted),
          }
        : null,
      destinationRevealAllowed:
        snapshotAvailable &&
        row.payoutProvider === "MANUAL" &&
        (row.payoutStatus === "PENDING" || row.payoutStatus === "PROCESSING"),
    };
  }

  async reveal(actorAccountId: string, payoutId: string, raw: unknown) {
    const parsed = revealPayoutDestinationSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException("Invalid destination reveal reason.");
    const targetId = this.validPayoutId(payoutId);
    return this.database.client.$transaction(async (tx) => {
      const row = await this.payoutRow(targetId, tx, true);
      await assertAdminFinanceAuthority(tx, actorAccountId);
      if (!row.destinationEncrypted || !row.legalName)
        throw new ConflictException("PAYOUT_BENEFICIARY_SNAPSHOT_NOT_CONFIGURED");
      if (!new Set(["PENDING", "PROCESSING"]).has(row.payoutStatus))
        throw new ConflictException("PAYOUT_DESTINATION_REVEAL_NOT_ALLOWED_FOR_STATUS");
      if (row.payoutProvider !== "MANUAL")
        throw new ConflictException("PAYOUT_DESTINATION_REVEAL_ONLY_FOR_MANUAL_PAYOUTS");

      // Snapshot/status/authority remain locked until the audit commits. An audit
      // failure cannot return sensitive data, and mutable profiles are never read.
      const destination = decryptPayoutDestination(row.destinationEncrypted);
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "payout.destination_revealed",
        entityType: "Payout",
        entityId: row.payoutId,
        reason: parsed.data.reason,
        metadata: {
          channelId: row.channelId,
          paymentProfileId: row.paymentProfileId,
          provider: row.payoutProvider,
          payoutStatus: row.payoutStatus,
          destinationMask: row.destinationMask,
          source: "IMMUTABLE_PAYOUT_SNAPSHOT",
        },
      });
      return {
        payoutId: row.payoutId,
        channelId: row.channelId,
        provider: row.payoutProvider,
        legalName: row.legalName,
        countryCode: row.countryCode,
        destination,
        destinationMask: row.destinationMask,
        sensitive: true,
        cacheable: false,
      };
    });
  }

  private validPayoutId(value: string) {
    const parsed = z.string().uuid().safeParse(value);
    if (!parsed.success) throw new BadRequestException("Invalid payout identifier.");
    return parsed.data;
  }

  private async payoutRow(
    payoutId: string,
    tx?: Prisma.TransactionClient,
    lock = false,
  ): Promise<PayoutDestinationRow> {
    const client = tx ?? this.database.client;
    const rows = await client.$queryRaw<PayoutDestinationRow[]>`
      SELECT
        p."id" AS "payoutId",
        p."channelId" AS "channelId",
        c."name" AS "channelName",
        c."handle" AS "channelHandle",
        p."status"::text AS "payoutStatus",
        p."provider" AS "payoutProvider",
        p."amount"::text AS "amount",
        p."currency" AS "currency",
        p."requestedAt" AS "requestedAt",
        p."processedAt" AS "processedAt",
        p."paidAt" AS "paidAt",
        p."externalReference" AS "externalReference",
        p."failureReason" AS "failureReason",
        p."paymentProfileId" AS "paymentProfileId",
        p."legalNameSnapshot" AS "legalName",
        p."destinationEncryptedSnapshot" AS "destinationEncrypted",
        p."destinationMaskSnapshot" AS "destinationMask",
        p."countryCodeSnapshot" AS "countryCode"
      FROM "Payout" p
      JOIN "Channel" c ON c."id" = p."channelId"
      WHERE p."id" = ${payoutId}::uuid
      LIMIT 1
      ${lock ? Prisma.sql`/* ayin-payout-destination-lock */ FOR UPDATE OF p` : Prisma.empty}
    `;
    const row = rows[0];
    if (!row) throw new NotFoundException("PAYOUT_NOT_FOUND");
    return row;
  }
}
