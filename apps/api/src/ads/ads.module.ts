import { Module } from "@nestjs/common";

import { AdminModule } from "../admin/admin.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import {
  AdminAdvertisingControlController,
  DirectAdController,
} from "./advertising-control.controller.js";
import { AdvertisingControlService } from "./advertising-control.service.js";
import {
  AdminAuthorizedSellerFileController,
  PublicAuthorizedSellerFileController,
} from "./authorized-seller-file.controller.js";
import { AuthorizedSellerFileService } from "./authorized-seller-file.service.js";
import {
  AdminGamDiagnosticsController,
  GamClientConfigurationController,
} from "./gam-production.controller.js";
import {
  createGamProductionConfig,
  GAM_PRODUCTION_CONFIG,
  GamProductionService,
} from "./gam-production.service.js";
import { AdminPageAdController, PageAdController } from "./page-ad.controller.js";
import { PageAdService } from "./page-ad.service.js";
import { loadLinearSsaiConfig } from "./linear-ssai.config.js";
import {
  LINEAR_SSAI_CONFIG,
  LinearSsaiService,
} from "./linear-ssai.service.js";
import { AdminVideoAdController, VideoAdController } from "./video-ad.controller.js";
import { VideoAdService } from "./video-ad.service.js";

@Module({
  imports: [DatabaseModule, AuthModule, AdminModule],
  controllers: [
    VideoAdController,
    AdminVideoAdController,
    PageAdController,
    AdminPageAdController,
    DirectAdController,
    AdminAdvertisingControlController,
    GamClientConfigurationController,
    AdminGamDiagnosticsController,
    PublicAuthorizedSellerFileController,
    AdminAuthorizedSellerFileController,
  ],
  providers: [
    VideoAdService,
    PageAdService,
    AdvertisingControlService,
    GamProductionService,
    AuthorizedSellerFileService,
    LinearSsaiService,
    { provide: GAM_PRODUCTION_CONFIG, useFactory: createGamProductionConfig },
    { provide: LINEAR_SSAI_CONFIG, useFactory: loadLinearSsaiConfig },
  ],
  exports: [
    VideoAdService,
    PageAdService,
    AdvertisingControlService,
    GamProductionService,
    AuthorizedSellerFileService,
    LinearSsaiService,
  ],
})
export class AdsModule {}
