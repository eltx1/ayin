import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { CreatorModule } from "../creator/creator.module.js";
import { MediaModule } from "../media/media.module.js";
import { PlatformConfigModule } from "../platform-config/platform-config.module.js";
import { VideoPolicyModule } from "../video-policy/video-policy.module.js";
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
import { AdminObservabilityController } from "./admin-observability.controller.js";
import { AdminProductController, PublicProductController } from "./admin-product.controller.js";
import { AdminProductService } from "./admin-product.service.js";
import { AdminScopedDirectoryController } from "./admin-scoped-directory.controller.js";
import { AdminSettingsService } from "./admin-settings.service.js";
import { AdminTrendingController } from "./admin-trending.controller.js";
import { AdminTrendingService } from "./admin-trending.service.js";
import { AdminVideoMetadataController } from "./admin-video-metadata.controller.js";
import { AdminVideoPolicyController } from "./admin-video-policy.controller.js";
import { AdminVideoPolicyService } from "./admin-video-policy.service.js";
import { AdminController } from "./admin.controller.js";
import { AdminGuard } from "./admin.guard.js";
import { CatalogAdminMediaService } from "./catalog-admin-media.service.js";
import { ContentSeedingController } from "./content-seeding.controller.js";
import { ContentSeedingService } from "./content-seeding.service.js";

@Module({
  imports: [AuthModule, CreatorModule, MediaModule, PlatformConfigModule, VideoPolicyModule],
  controllers: [
    AdminController,
    AdminControlController,
    AdminVideoMetadataController,
    AdminVideoPolicyController,
    AdminGovernanceController,
    AdminMediaProcessingController,
    AdminObservabilityController,
    AdminScopedDirectoryController,
    SupportTicketController,
    AdminProductController,
    AdminTrendingController,
    PublicProductController,
    ContentSeedingController,
  ],
  providers: [
    AdminAuditLogService,
    AdminAuthorizationService,
    AdminGuard,
    AdminSettingsService,
    AdminVideoPolicyService,
    AdminControlService,
    AdminCommandCenterService,
    AdminGovernanceService,
    AdminProductService,
    AdminTrendingService,
    CatalogAdminMediaService,
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
    AdminTrendingService,
    CatalogAdminMediaService,
    ContentSeedingService,
  ],
})
export class AdminModule {}
