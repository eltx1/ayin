import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { PlatformConfigModule } from "../platform-config/platform-config.module.js";
import { AdminAuditLogService } from "./admin-audit-log.service.js";
import { AdminAuthorizationService } from "./admin-authorization.service.js";
import { AdminController } from "./admin.controller.js";
import { AdminGuard } from "./admin.guard.js";
import { AdminSettingsService } from "./admin-settings.service.js";

@Module({
  imports: [AuthModule, PlatformConfigModule],
  controllers: [AdminController],
  providers: [AdminAuditLogService, AdminAuthorizationService, AdminGuard, AdminSettingsService],
  exports: [AdminAuthorizationService, AdminGuard],
})
export class AdminModule {}
