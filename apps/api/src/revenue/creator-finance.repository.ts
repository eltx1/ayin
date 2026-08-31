import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";

export type PayoutProvider = "MANUAL" | "BANK_TRANSFER" | "PAYPAL" | "PAYONEER" | "WISE";
export type IdentityVerificationStatus = "NOT_STARTED" | "PENDING" | "VERIFIED" | "REJECTED";
export type TaxVerificationStatus = "NOT_PROVIDED" | "PENDING" | "VERIFIED" | "REQUIRES_ACTION";
export type RevenueDisputeCategory = "EARNINGS" | "PAYOUT" | "OTHER";
export type RevenueDisputeStatus = "OPEN" | "REVIEWING" | "RESOLVED" | "REJECTED";

export interface CreatorPayoutProfileRow {
  id: string;
  channelId: string;
  legalName: string;
  preferredCurrency: string;
  provider: PayoutProvider;
  destinationEncrypted: string | null;
  destinationMask: string | null;
  countryCode: string | null;
  identityStatus: IdentityVerificationStatus;
  taxStatus: TaxVerificationStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface RevenueDisputeRow {
  id: string;
  channelId: string;
  payoutId: string | null;
  createdByAccountId: string;
  category: RevenueDisputeCategory;
  message: string;
  status: RevenueDisputeStatus;
  resolution: string | null;
  resolvedByAccountId: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}

export interface AdminRevenueDisputeRow extends RevenueDisputeRow {
  channelName: string;
  channelHandle: string;
  creatorEmail: string;
  payoutAmount: string | null;
  payoutCurrency: string | null;
  payoutStatus: string | null;
}

@Injectable()
export class CreatorFinanceRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async getProfile(channelId: string): Promise<CreatorPayoutProfileRow | null> {
    const rows = await this.database.client.$queryRaw<CreatorPayoutProfileRow[]>`
      SELECT
        "id", "channelId", "legalName", "preferredCurrency", "provider",
        "destinationEncrypted", "destinationMask", "countryCode",
        "identityStatus", "taxStatus", "createdAt", "updatedAt"
      FROM "CreatorPayoutProfile"
      WHERE "channelId" = ${channelId}::uuid
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async upsertProfile(input: {
    channelId: string;
    legalName: string;
    preferredCurrency: string;
    provider: PayoutProvider;
    destinationEncrypted: string | null;
    destinationMask: string | null;
    countryCode: string | null;
  }): Promise<CreatorPayoutProfileRow> {
    const id = randomUUID();
    const now = new Date();
    const rows = await this.database.client.$queryRaw<CreatorPayoutProfileRow[]>`
      INSERT INTO "CreatorPayoutProfile" (
        "id", "channelId", "legalName", "preferredCurrency", "provider",
        "destinationEncrypted", "destinationMask", "countryCode", "createdAt", "updatedAt"
      ) VALUES (
        ${id}::uuid, ${input.channelId}::uuid, ${input.legalName}, ${input.preferredCurrency},
        ${input.provider}, ${input.destinationEncrypted}, ${input.destinationMask}, ${input.countryCode},
        ${now}, ${now}
      )
      ON CONFLICT ("channelId") DO UPDATE SET
        "legalName" = EXCLUDED."legalName",
        "preferredCurrency" = EXCLUDED."preferredCurrency",
        "provider" = EXCLUDED."provider",
        "destinationEncrypted" = COALESCE(EXCLUDED."destinationEncrypted", "CreatorPayoutProfile"."destinationEncrypted"),
        "destinationMask" = COALESCE(EXCLUDED."destinationMask", "CreatorPayoutProfile"."destinationMask"),
        "countryCode" = EXCLUDED."countryCode",
        "updatedAt" = EXCLUDED."updatedAt"
      RETURNING
        "id", "channelId", "legalName", "preferredCurrency", "provider",
        "destinationEncrypted", "destinationMask", "countryCode",
        "identityStatus", "taxStatus", "createdAt", "updatedAt"
    `;
    const profile = rows[0];
    if (!profile) throw new Error("PAYOUT_PROFILE_SAVE_FAILED");
    return profile;
  }

  async listCreatorDisputes(channelId: string): Promise<RevenueDisputeRow[]> {
    return this.database.client.$queryRaw<RevenueDisputeRow[]>`
      SELECT
        "id", "channelId", "payoutId", "createdByAccountId", "category", "message",
        "status", "resolution", "resolvedByAccountId", "createdAt", "updatedAt", "resolvedAt"
      FROM "RevenueDispute"
      WHERE "channelId" = ${channelId}::uuid
      ORDER BY "createdAt" DESC
      LIMIT 100
    `;
  }

  async createDispute(input: {
    channelId: string;
    payoutId: string | null;
    createdByAccountId: string;
    category: RevenueDisputeCategory;
    message: string;
  }): Promise<RevenueDisputeRow> {
    const id = randomUUID();
    const now = new Date();
    const rows = await this.database.client.$queryRaw<RevenueDisputeRow[]>`
      INSERT INTO "RevenueDispute" (
        "id", "channelId", "payoutId", "createdByAccountId", "category", "message",
        "status", "createdAt", "updatedAt"
      ) VALUES (
        ${id}::uuid, ${input.channelId}::uuid, ${input.payoutId}::uuid, ${input.createdByAccountId}::uuid,
        ${input.category}, ${input.message}, 'OPEN', ${now}, ${now}
      )
      RETURNING
        "id", "channelId", "payoutId", "createdByAccountId", "category", "message",
        "status", "resolution", "resolvedByAccountId", "createdAt", "updatedAt", "resolvedAt"
    `;
    const dispute = rows[0];
    if (!dispute) throw new Error("REVENUE_DISPUTE_CREATE_FAILED");
    return dispute;
  }

  async listAdminDisputes(status?: RevenueDisputeStatus): Promise<AdminRevenueDisputeRow[]> {
    return this.database.client.$queryRaw<AdminRevenueDisputeRow[]>`
      SELECT
        d."id", d."channelId", d."payoutId", d."createdByAccountId", d."category", d."message",
        d."status", d."resolution", d."resolvedByAccountId", d."createdAt", d."updatedAt", d."resolvedAt",
        c."name" AS "channelName", c."handle" AS "channelHandle", a."email" AS "creatorEmail",
        CASE WHEN p."amount" IS NULL THEN NULL ELSE p."amount"::text END AS "payoutAmount",
        p."currency" AS "payoutCurrency", p."status"::text AS "payoutStatus"
      FROM "RevenueDispute" d
      JOIN "Channel" c ON c."id" = d."channelId"
      JOIN "Account" a ON a."id" = d."createdByAccountId"
      LEFT JOIN "Payout" p ON p."id" = d."payoutId"
      WHERE (${status ?? null}::text IS NULL OR d."status" = ${status ?? null})
      ORDER BY d."createdAt" DESC
      LIMIT 250
    `;
  }

  async updateDispute(input: {
    disputeId: string;
    status: RevenueDisputeStatus;
    resolution: string | null;
    resolvedByAccountId: string;
  }): Promise<RevenueDisputeRow> {
    const now = new Date();
    const terminal = input.status === "RESOLVED" || input.status === "REJECTED";
    const rows = await this.database.client.$queryRaw<RevenueDisputeRow[]>`
      UPDATE "RevenueDispute"
      SET
        "status" = ${input.status},
        "resolution" = ${input.resolution},
        "resolvedByAccountId" = ${terminal ? input.resolvedByAccountId : null}::uuid,
        "resolvedAt" = ${terminal ? now : null},
        "updatedAt" = ${now}
      WHERE "id" = ${input.disputeId}::uuid
      RETURNING
        "id", "channelId", "payoutId", "createdByAccountId", "category", "message",
        "status", "resolution", "resolvedByAccountId", "createdAt", "updatedAt", "resolvedAt"
    `;
    const dispute = rows[0];
    if (!dispute) throw new Error("REVENUE_DISPUTE_NOT_FOUND");
    return dispute;
  }
}
