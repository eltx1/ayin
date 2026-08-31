import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AdminGuard, RequireAdminRoles } from "../admin/admin.guard.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { GamProductionService } from "./gam-production.service.js";

const contextSchema = z.object({
  channelId: z.string().uuid().nullable().optional(),
  videoId: z.string().uuid().nullable().optional(),
  deviceClass: z.enum(["MOBILE", "TABLET", "DESKTOP", "TV", "UNKNOWN"]),
  sessionId: z.string().trim().min(8).max(120),
  consentMode: z.enum(["PERSONALIZED", "NON_PERSONALIZED", "LIMITED_ADS"]),
  childDirected: z.enum(["0", "1"]).optional(),
  underAgeOfConsent: z.enum(["0", "1"]).optional(),
});

@Controller("ads/gam")
export class GamClientConfigurationController {
  constructor(@Inject(GamProductionService) private readonly gam: GamProductionService) {}

  @Get("config")
  clientConfig(@Query() query: Record<string, unknown>) {
    const parsed = contextSchema.parse(query);
    return this.gam.buildClientConfiguration({
      channelId: parsed.channelId ?? null,
      videoId: parsed.videoId ?? null,
      deviceClass: parsed.deviceClass,
      sessionId: parsed.sessionId,
      consentMode: parsed.consentMode,
      childDirected: parsed.childDirected === "1",
      underAgeOfConsent: parsed.underAgeOfConsent === "1",
    });
  }
}

@Controller("admin/advertising/gam")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("AD_MANAGER")
export class AdminGamDiagnosticsController {
  constructor(@Inject(GamProductionService) private readonly gam: GamProductionService) {}

  @Get("diagnostics")
  diagnostics() {
    return this.gam.diagnostics();
  }

  @Get("authorized-sellers")
  sellers() {
    return { rows: this.gam.authorizedSellerRows() };
  }
}
