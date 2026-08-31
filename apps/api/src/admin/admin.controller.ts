import { Body, Controller, Get, Inject, Param, Patch, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../auth/auth.guard.js";
import { DatabaseService } from "../database/database.service.js";
import { FeatureFlagService } from "../platform-config/feature-flag.service.js";
import { AdminAuditLogService } from "./admin-audit-log.service.js";
import { AdminAuthorizationService } from "./admin-authorization.service.js";
import { adminBadRequest } from "./admin.errors.js";
import {
  AdminGuard,
  type AdminAuthenticatedRequest,
  RequireAdminRoles,
} from "./admin.guard.js";
import { AdminSettingsService } from "./admin-settings.service.js";

const updateSettingSchema = z.object({
  value: z.unknown(),
  confirmHighImpact: z.boolean().optional(),
  reason: z.string().trim().min(3).max(500).optional(),
});

const staffRoles = [
  "OPERATIONS",
  "CONTENT_MODERATOR",
  "AD_MANAGER",
  "FINANCE_MANAGER",
] as const;

@Controller("admin")
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(
    @Inject(AdminAuthorizationService)
    private readonly authorization: AdminAuthorizationService,
    @Inject(AdminSettingsService) private readonly settings: AdminSettingsService,
    @Inject(FeatureFlagService) private readonly featureFlags: FeatureFlagService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AdminAuditLogService) private readonly audit: AdminAuditLogService,
  ) {}

  @Get("session")
  @RequireAdminRoles(...staffRoles)
  async session(@Req() request: AdminAuthenticatedRequest) {
    return {
      accountId: request.ayinAuth.accountId,
      roles: await this.authorization.getRoles(request.ayinAuth.accountId),
    };
  }

  @Get("settings")
  @RequireAdminRoles("OPERATIONS")
  async listSettings(@Req() request: AdminAuthenticatedRequest) {
    return this.settings.list(request.ayinAdmin.roles);
  }

  @Patch("settings/:key")
  @RequireAdminRoles("OPERATIONS")
  async updateSetting(
    @Req() request: AdminAuthenticatedRequest,
    @Param("key") key: string,
    @Body() body: unknown,
  ) {
    if (!body || typeof body !== "object" || !("value" in body)) {
      throw adminBadRequest("INVALID_PLATFORM_SETTING", "A setting value is required.");
    }
    const parsed = updateSettingSchema.safeParse(body);
    if (!parsed.success) {
      throw adminBadRequest(
        "INVALID_PLATFORM_SETTING_REQUEST",
        parsed.error.issues[0]?.message ?? "The setting update is invalid.",
      );
    }
    return this.settings.update(
      request.ayinAuth.accountId,
      request.ayinAdmin.roles,
      key,
      parsed.data,
    );
  }

  @Get("feature-flags")
  @RequireAdminRoles("OPERATIONS")
  async listFeatureFlags() {
    return { flags: await this.featureFlags.list() };
  }

  @Patch("feature-flags/:key")
  @RequireAdminRoles("OPERATIONS")
  async updateFeatureFlag(
    @Req() request: AdminAuthenticatedRequest,
    @Param("key") key: string,
    @Body() body: unknown,
  ) {
    try {
      return await this.database.client.$transaction(async (tx) => {
        const flag = await this.featureFlags.updateInTransaction(tx, key, body);
        await this.audit.recordInTransaction(tx, {
          actorAccountId: request.ayinAuth.accountId,
          action: "feature_flag.updated",
          entityType: "FeatureFlag",
          entityId: flag.key,
          metadata: {
            enabled: flag.enabled,
            rolloutPercentage: flag.rolloutPercentage,
          },
        });
        return flag;
      });
    } catch (error) {
      if (
        error instanceof z.ZodError ||
        (error instanceof Error && error.message.includes("Feature flag key"))
      ) {
        throw adminBadRequest("INVALID_FEATURE_FLAG", "The feature flag update is invalid.");
      }
      throw error;
    }
  }
}
