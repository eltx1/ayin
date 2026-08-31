import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { AdminGuard, RequireAdminRoles } from "../admin/admin.guard.js";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { analyticsBatchSchema } from "./analytics.schemas.js";
import { AnalyticsService } from "./analytics.service.js";

const daysSchema = z.coerce.number().int().min(1).max(365).default(28);
const cleanupSchema = z.object({
  retentionDays: z.coerce.number().int().min(30).max(3650).default(400),
});
const dashboardStaffRoles = [
  "OPERATIONS",
  "CONTENT_MODERATOR",
  "AD_MANAGER",
  "FINANCE_MANAGER",
] as const;

@Controller("analytics")
export class PublicAnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly analytics: AnalyticsService) {}

  @Post("events")
  ingest(@Body() body: unknown) {
    const parsed = analyticsBatchSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(
        { error: { code: "INVALID_ANALYTICS_BATCH", message: "Invalid analytics batch." } },
        400,
      );
    }
    return this.analytics.ingest(parsed.data.events);
  }
}

@Controller("creator/studio/analytics")
@UseGuards(AuthGuard)
export class CreatorAnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly analytics: AnalyticsService) {}

  @Get()
  async metrics(@Req() request: AuthenticatedRequest, @Query("days") rawDays?: string) {
    const parsed = daysSchema.safeParse(rawDays ?? 28);
    if (!parsed.success) throw new HttpException("Invalid analytics period.", 400);
    const metrics = await this.analytics.creatorMetrics(request.ayinAuth.accountId, parsed.data);
    if (!metrics) throw new HttpException("Creator channel not found.", 404);
    return metrics;
  }
}

@Controller("admin/analytics")
@UseGuards(AuthGuard, AdminGuard)
export class AdminAnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly analytics: AnalyticsService) {}

  @Get()
  @RequireAdminRoles(...dashboardStaffRoles)
  metrics() {
    return this.analytics.adminMetrics();
  }

  @Post("cleanup")
  @RequireAdminRoles("OPERATIONS")
  cleanup(@Body() body: unknown) {
    const parsed = cleanupSchema.safeParse(body ?? {});
    if (!parsed.success) throw new HttpException("Invalid retention configuration.", 400);
    return this.analytics.deleteExpired(parsed.data.retentionDays);
  }
}
