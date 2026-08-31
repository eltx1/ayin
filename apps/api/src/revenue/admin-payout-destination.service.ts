import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";

import { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import { DatabaseService } from "../database/database.service.js";
import { decryptPayoutDestination } from "./creator-finance.crypto.js";

const revealPayoutDestinationSchema = z
  .object({
    reason: z.string().trim().min(8).max(500),
  })
  .strict();

interface PayoutDestinationRow {
  payoutId: string;
  channelId: string;
  payoutStatus: string;
  payoutProvider: string;
  paymentProfileId: string | null;
  legalName: string | null;
  profileProvider: string | null;
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

  async reveal(actorAccountId: string, payoutId: string, raw: unknown) {
    const input = revealPayoutDestinationSchema.parse(raw);
    const rows = await this.database.client.$queryRaw<PayoutDestinationRow[]>`
      SELECT
        p."id" AS "payoutId",
        p."channelId" AS "channelId",
        p."status"::text AS "payoutStatus",
        p."provider" AS "payoutProvider",
        p."paymentProfileId" AS "paymentProfileId",
        cpp."legalName" AS "legalName",
        cpp."provider" AS "profileProvider",
        cpp."destinationEncrypted" AS "destinationEncrypted",
        cpp."destinationMask" AS "destinationMask",
        cpp."countryCode" AS "countryCode"
      FROM "Payout" p
      LEFT JOIN "CreatorPayoutProfile" cpp
        ON cpp."id" = p."paymentProfileId"
        OR (p."paymentProfileId" IS NULL AND cpp."channelId" = p."channelId")
      WHERE p."id" = ${payoutId}::uuid
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new Error("PAYOUT_NOT_FOUND");
    if (!row.destinationEncrypted || !row.legalName) {
      throw new Error("PAYOUT_DESTINATION_NOT_CONFIGURED");
    }
    if (!new Set(["PENDING", "PROCESSING"]).has(row.payoutStatus)) {
      throw new Error("PAYOUT_DESTINATION_REVEAL_NOT_ALLOWED_FOR_STATUS");
    }
    if (row.payoutProvider !== "MANUAL" || row.profileProvider !== "MANUAL") {
      throw new Error("PAYOUT_DESTINATION_REVEAL_ONLY_FOR_MANUAL_PAYOUTS");
    }

    const destination = decryptPayoutDestination(row.destinationEncrypted);
    await this.database.client.$transaction(async (tx) => {
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "payout.destination_revealed",
        entityType: "Payout",
        entityId: row.payoutId,
        reason: input.reason,
        metadata: {
          channelId: row.channelId,
          paymentProfileId: row.paymentProfileId,
          provider: row.payoutProvider,
          payoutStatus: row.payoutStatus,
          destinationMask: row.destinationMask,
        },
      });
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
  }
}
