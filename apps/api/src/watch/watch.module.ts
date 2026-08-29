import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { PlatformConfigModule } from "../platform-config/platform-config.module.js";
import { PublicWatchController, WatchProgressController } from "./watch.controller.js";
import { WatchService } from "./watch.service.js";

@Module({
  imports: [AuthModule, DatabaseModule, PlatformConfigModule],
  controllers: [PublicWatchController, WatchProgressController],
  providers: [WatchService],
  exports: [WatchService],
})
export class WatchModule {}
