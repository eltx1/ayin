import type { Prisma } from "@ayin/db";
import { Injectable } from "@nestjs/common";

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
