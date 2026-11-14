import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@ayin/db";
import { DatabaseService } from "../database/database.service.js";
import { AdminAuditLogService } from "../admin/admin-audit-log.service.js";
import {
  defaultMobileRuntimeConfig,
  mobileRuntimeConfigSchema,
  type MobileRuntimeConfig,
} from "./mobile.schemas.js";

import { lockMobileAdminWrite, type MobileActor } from "./mobile-authority.js";

const identity = { namespace: "PLATFORM" as const, key: "mobileRuntimeConfigV1" };
@Injectable()
export class MobileConfigService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
  ) {}
  async get(): Promise<MobileRuntimeConfig> {
    const row = await this.db.client.platformSetting.findUnique({
      where: { namespace_key: identity },
      select: { value: true, schemaVersion: true },
    });
    const parsed = row?.schemaVersion === 1 ? mobileRuntimeConfigSchema.safeParse(row.value) : null;
    return parsed?.success ? parsed.data : structuredClone(defaultMobileRuntimeConfig);
  }
  async update(actor: MobileActor, raw: unknown, reason: string) {
    const actorAccountId = actor.accountId;
    const config = mobileRuntimeConfigSchema.parse(raw);
    await this.db.client.$transaction(async (tx) => {
      await lockMobileAdminWrite(tx, actor);
      const previous = await tx.platformSetting.findUnique({
        where: { namespace_key: identity },
        select: { value: true },
      });
      await tx.platformSetting.upsert({
        where: { namespace_key: identity },
        create: {
          ...identity,
          valueType: "JSON",
          schemaVersion: 1,
          value: config as Prisma.InputJsonValue,
          description:
            "Native mobile runtime configuration; managed exclusively by AYIN admin mobile controls.",
        },
        update: { value: config as Prisma.InputJsonValue, schemaVersion: 1, valueType: "JSON" },
      });
      await this.audit.recordInTransaction(tx, {
        actorAccountId,
        action: "mobile.config.updated",
        entityType: "PlatformSetting",
        entityId: "PLATFORM.mobileRuntimeConfigV1",
        reason,
        metadata: {
          previousValue: previous?.value ?? null,
          newValue: config as Prisma.InputJsonValue,
        },
      });
    });
    return config;
  }
}
