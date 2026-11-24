import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  Inject,
  Param,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import {
  AdminGuard,
  type AdminAuthenticatedRequest,
  RequireAdminRoles,
  RequireAdminStepUp,
} from "../admin/admin.guard.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { AdManagerService } from "./ad-manager.service.js";

@Controller("admin/ad-manager")
@UseGuards(AuthGuard, AdminGuard)
@RequireAdminRoles("AD_MANAGER")
export class AdminAdManagerController {
  constructor(@Inject(AdManagerService) private readonly manager: AdManagerService) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  overview() {
    return this.manager.overview();
  }

  @Put("web")
  @RequireAdminStepUp()
  @Header("Cache-Control", "private, no-store")
  updateWeb(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    return this.validated(() => this.manager.updateWeb(request.ayinAuth, body));
  }

  @Put("web/slots/:key")
  @RequireAdminStepUp()
  @Header("Cache-Control", "private, no-store")
  updateSlot(
    @Req() request: AdminAuthenticatedRequest,
    @Param("key") key: string,
    @Body() body: unknown,
  ) {
    return this.validated(() => this.manager.updateSlot(request.ayinAuth, key, body));
  }

  @Put("video")
  @RequireAdminStepUp()
  @Header("Cache-Control", "private, no-store")
  updateVideo(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    return this.validated(() => this.manager.updateVideo(request.ayinAuth, body));
  }

  @Put("emergency")
  @RequireAdminStepUp()
  @Header("Cache-Control", "private, no-store")
  updateEmergency(@Req() request: AdminAuthenticatedRequest, @Body() body: unknown) {
    return this.validated(() => this.manager.updateEmergency(request.ayinAuth, body));
  }

  private async validated<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof z.ZodError)) throw error;
      const issue = error.issues[0];
      throw new HttpException(
        {
          error: {
            code: "INVALID_AD_MANAGER_INPUT",
            message: issue?.message ?? "Check the advertising settings.",
            field: issue?.path.join(".") ?? null,
          },
        },
        400,
      );
    }
  }
}
