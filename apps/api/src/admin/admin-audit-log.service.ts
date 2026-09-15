import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";

export interface AdminAuditInput {
  actorAccountId: string;
  action: string;
  entityType: string;
  entityId?: string | undefined;
  reason?: string | undefined;
  metadata?: Prisma.InputJsonObject | undefined;
}

@Injectable()
export class AdminAuditLogService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async record(input: AdminAuditInput) {
    return this.recordInTransaction(this.database.client, input);
  }

  async recordInTransaction(tx: Prisma.TransactionClient, input: AdminAuditInput) {
    return tx.adminAuditLog.create({
      data: {
        actorAccountId: input.actorAccountId,
        action: input.action,
        entityType: input.entityType,
        ...(input.entityId !== undefined ? { entityId: input.entityId } : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      },
    });
  }
}
