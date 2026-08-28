import type { Prisma } from "@ayin/db";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import {
  isPlatformSettingKey,
  platformSettingCatalog,
  platformSettingSections,
  type PlatformSettingKey,
} from "../platform-config/platform-settings.catalog.js";
import {
  PlatformSettingsService,
  PlatformSettingValidationError,
} from "../platform-config/platform-settings.service.js";
import { AdminAuditLogService } from "./admin-audit-log.service.js";
import { adminBadRequest, adminForbidden } from "./admin.errors.js";
import type { AdminRole } from "./admin.roles.js";

export interface AdminSettingUpdateInput {
  value: unknown;
  confirmHighImpact?: boolean;
  reason?: string;
}

@Injectable()
export class AdminSettingsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
  ) {}

  async list(actorRoles: AdminRole[]) {
    const resolved = await this.settings.listResolved();
    return {
      actorRoles,
      sections: platformSettingSections.map((section) => ({
        ...section,
        settings: resolved.filter((setting) => platformSettingCatalog[setting.key].section === section.id),
      })),
    };
  }

  async update(
    actorAccountId: string,
    actorRoles: AdminRole[],
    keyValue: string,
    input: AdminSettingUpdateInput,
  ) {
    if (!isPlatformSettingKey(keyValue)) {
      throw adminBadRequest("UNKNOWN_PLATFORM_SETTING", "This platform setting is not supported.");
    }
    const key: PlatformSettingKey = keyValue;
    const definition = platformSettingCatalog[key];
    if (definition.superadminOnly && !actorRoles.includes("SUPERADMIN")) {
      throw adminForbidden("This high-risk setting requires SUPERADMIN.");
    }

    let validatedValue: unknown;
    try {
      validatedValue = this.settings.validate(key, input.value);
    } catch (error) {
      if (error instanceof PlatformSettingValidationError) {
        throw adminBadRequest("INVALID_PLATFORM_SETTING", error.message);
      }
      throw error;
    }

    return this.database.client.$transaction(async (tx) => {
      const previous = await this.settings.getResolvedInTransaction(tx, key);
      const changed = JSON.stringify(previous.value) !== JSON.stringify(validatedValue);
      if (changed && definition.highImpact && input.confirmHighImpact !== true) {
        throw adminBadRequest(
          "HIGH_IMPACT_CONFIRMATION_REQUIRED",
          "Confirm this high-impact setting change before saving.",
        );
      }

      const row = await this.settings.setInTransaction(tx, key, validatedValue);
      if (changed) {
        await this.audit.recordInTransaction(tx, {
          actorAccountId,
          action: "platform_setting.updated",
          entityType: "PlatformSetting",
          entityId: `${definition.namespace}.${definition.key}`,
          reason: input.reason?.trim() || undefined,
          metadata: {
            key,
            namespace: definition.namespace,
            previousValue: previous.value as Prisma.InputJsonValue,
            newValue: validatedValue as Prisma.InputJsonValue,
            highImpact: definition.highImpact,
          },
        });
      }

      return {
        key,
        value: row.value,
        highImpact: definition.highImpact,
        changed,
      };
    });
  }
}
