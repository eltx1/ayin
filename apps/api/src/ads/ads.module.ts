import { Module } from "@nestjs/common";

import { AdminModule } from "../admin/admin.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
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
  ],
  providers: [VideoAdService, PageAdService],
  exports: [VideoAdService, PageAdService],
})
export class AdsModule {}
