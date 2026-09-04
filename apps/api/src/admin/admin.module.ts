import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { MediaModule } from "../media/media.module.js";
import { PlatformConfigModule } from "../platform-config/platform-config.module.js";
import { AdminAuditLogService } from "./admin-audit-log.service.js";
import { AdminAuthorizationService } from "./admin-authorization.service.js";
import { AdminCommandCenterService } from "./admin-command-center.service.js";
import { AdminControlController } from "./admin-control.controller.js";
import { AdminControlService } from "./admin-control.service.js";
import {
  AdminGovernanceController,
  SupportTicketController,
} from "./admin-governance.controller.js";
import { AdminGovernanceService } from "./admin-governance.service.js";
import { AdminMediaProcessingController } from "./admin-media-processing.controller.js";
import { AdminProductController, PublicProductController } from "./admin-product.controller.js";
import { AdminProductService } from "./admin-product.service.js";
import { AdminScopedDirectoryController } from "./admin-scoped-directory.controller.js";
import { AdminSettingsService } from "./admin-settings.service.js";
import { AdminController } from "./admin.controller.js";
import { AdminGuard } from "./admin.guard.js";
import { ContentSeedingController } from "./content-seeding.controller.js";
import { ContentSeedingService } from "./content-seeding.service.js";

@Module({
  imports: [AuthModule, MediaModule, PlatformConfigModule],
  controllers: [
    AdminController,
    AdminControlController,
    AdminGovernanceController,
    AdminMediaProcessingController,
    AdminScopedDirectoryController,
    SupportTicketController,
    AdminProductController,
    PublicProductController,
    ContentSeedingController,
  ],
  providers: [
    AdminAuditLogService,
    AdminAuthorizationService,
    AdminGuard,
    AdminSettingsService,
    AdminControlService,
    AdminCommandCenterService,
    AdminGovernanceService,
    AdminProductService,
    ContentSeedingService,
  ],
  exports: [
    AdminAuditLogService,
    AdminAuthorizationService,
    AdminGuard,
    AdminControlService,
    AdminCommandCenterService,
    AdminGovernanceService,
    AdminProductService,
    ContentSeedingService,
  ],
})
export class AdminModule {}
