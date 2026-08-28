import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { MediaModule } from "../media/media.module.js";
import { PlatformConfigModule } from "../platform-config/platform-config.module.js";
import { QuickUploadController } from "./quick-upload.controller.js";
import { QuickUploadService } from "./quick-upload.service.js";

@Module({
  imports: [AuthModule, DatabaseModule, MediaModule, PlatformConfigModule],
  controllers: [QuickUploadController],
  providers: [QuickUploadService],
})
export class CreatorModule {}
