import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";

import { AdminGuard, RequireAdminRoles, RequireAdminStepUp } from "../admin/admin.guard.js";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard.js";
import { CreatorComplianceService } from "./creator-compliance.service.js";

@Controller("creator/studio/revenue/compliance")
@UseGuards(AuthGuard)
export class CreatorComplianceController {
  constructor(
    @Inject(CreatorComplianceService)
    private readonly compliance: CreatorComplianceService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  status(@Req() request: AuthenticatedRequest) {
    return this.compliance.creatorStatus(request.ayinAuth.accountId);
  }

  @Post("start")
  @Header("Cache-Control", "no-store")
  start(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.compliance.startCreatorStep(request.ayinAuth.accountId, body);
  }

  @Post("refresh")
  @Header("Cache-Control", "no-store")
  refresh(@Req() request: AuthenticatedRequest) {
    return this.compliance.refreshCreator(request.ayinAuth.accountId);
  }
}

@Controller("admin/revenue/channels")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("FINANCE_MANAGER")
export class AdminCreatorComplianceController {
  constructor(
    @Inject(CreatorComplianceService)
    private readonly compliance: CreatorComplianceService,
  ) {}

  @Get(":channelId/compliance")
  @Header("Cache-Control", "no-store")
  status(@Param("channelId") channelId: string) {
    return this.compliance.adminStatus(channelId);
  }

  @Patch(":channelId/compliance")
  @RequireAdminStepUp()
  @Header("Cache-Control", "no-store")
  override(
    @Req() request: AuthenticatedRequest,
    @Param("channelId") channelId: string,
    @Body() body: unknown,
  ) {
    return this.compliance.adminOverride(request.ayinAuth.accountId, channelId, body);
  }
}
