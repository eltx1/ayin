import { Module } from "@nestjs/common";

import { AdminModule } from "../admin/admin.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import {
  AdminAdvertisingControlController,
  DirectAdController,
} from "./advertising-control.controller.js";
import { AdvertisingControlService } from "./advertising-control.service.js";
import { AdminPageAdController, PageAdController } from "./page-ad.controller.js";
import { PageAdService } from "./page-ad.service.js";
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
  ],
  providers: [VideoAdService, PageAdService, AdvertisingControlService],
  exports: [VideoAdService, PageAdService, AdvertisingControlService],
})
export class AdsModule {}
