import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { MediaModule } from "../media/media.module.js";
import { PlatformConfigModule } from "../platform-config/platform-config.module.js";
import {
  AdminCommunityController,
  CommunityController,
  CreatorCommunityController,
  PublicCommunityController,
} from "./community.controller.js";
import { CommunityService } from "./community.service.js";
@Module({
  imports: [AdminModule, AuthModule, DatabaseModule, MediaModule, PlatformConfigModule],
  controllers: [
    CreatorCommunityController,
    PublicCommunityController,
    CommunityController,
    AdminCommunityController,
  ],
  providers: [CommunityService],
  exports: [CommunityService],
})
export class CommunityModule {}
