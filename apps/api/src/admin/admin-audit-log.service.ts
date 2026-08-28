import type { Prisma } from "@ayin/db";
import { Injectable } from "@nestjs/common";

export interface AdminAuditInput {
  actorAccountId: string;
  action: string;
  entityType: string;
  entityId?: string;
  reason?: string;
  metadata?: Prisma.InputJsonObject;
}

@Injectable()
export class AdminAuditLogService {
  async recordInTransaction(tx: Prisma.TransactionClient, input: AdminAuditInput) {
    return tx.adminAuditLog.create({
      data: {
        actorAccountId: input.actorAccountId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        reason: input.reason,
        metadata: input.metadata,
      },
    });
  }
}
