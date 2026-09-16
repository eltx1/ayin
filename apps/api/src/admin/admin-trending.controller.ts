import { Body, Controller, Get, Inject, Put, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../auth/auth.guard.js";
import { trendingConfigSchema } from "../platform-config/trending-settings.js";
import { AdminTrendingService } from "./admin-trending.service.js";
import { adminBadRequest } from "./admin.errors.js";
import {
  AdminGuard,
  type AdminAuthenticatedRequest,
  RequireAdminRoles,
  RequireAdminStepUp,
} from "./admin.guard.js";

const updateTrendingSchema = z
  .object({
    config: trendingConfigSchema,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

@Controller("admin/trending-settings")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("OPERATIONS")
export class AdminTrendingController {
  constructor(@Inject(AdminTrendingService) private readonly trending: AdminTrendingService) {}

  @Get()
  getConfig() {
    return this.trending.getConfig();
  }

  @Put()
  @RequireAdminStepUp()
  updateConfig(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    const parsed = updateTrendingSchema.safeParse(body);
    if (!parsed.success) {
      throw adminBadRequest(
        "INVALID_TRENDING_CONFIG",
        "Check the bounded Trending weights and cohort settings.",
      );
    }
    return this.trending.updateConfig(
      request.ayinAuth.accountId,
      parsed.data.config,
      parsed.data.reason,
    );
  }
}
