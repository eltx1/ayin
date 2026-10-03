import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Inject,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { AdminGuard, RequireAdminRoles } from "../admin/admin.guard.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { GamProductionService } from "./gam-production.service.js";

const contextSchema = z.object({
  channelId: z.string().uuid().nullable().optional(),
  videoId: z.string().uuid().nullable().optional(),
  deviceClass: z.enum(["MOBILE", "TABLET", "DESKTOP", "TV", "UNKNOWN"]),
  consentMode: z.enum(["PERSONALIZED", "NON_PERSONALIZED", "LIMITED_ADS"]).default("LIMITED_ADS"),
  childDirected: z.enum(["0", "1"]).optional(),
  underAgeOfConsent: z.enum(["0", "1"]).optional(),
  ageTreatment: z.enum(["UNSPECIFIED", "CHILD", "TEEN"]).optional(),
});

@Controller("ads/gam")
export class GamClientConfigurationController {
  constructor(@Inject(GamProductionService) private readonly gam: GamProductionService) {}

  @Get("config")
  @Header("Cache-Control", "private, no-store")
  clientConfig(@Query() query: Record<string, unknown>) {
    const result = contextSchema.safeParse(query);
    if (!result.success) throw new BadRequestException("Invalid advertising request context.");
    const parsed = result.data;
    return this.gam.buildClientConfiguration({
      channelId: parsed.channelId ?? null,
      videoId: parsed.videoId ?? null,
      deviceClass: parsed.deviceClass,
      consentMode: parsed.consentMode,
      childDirected: parsed.childDirected === "1",
      underAgeOfConsent: parsed.underAgeOfConsent === "1",
      ...(parsed.ageTreatment ? { ageTreatment: parsed.ageTreatment } : {}),
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
