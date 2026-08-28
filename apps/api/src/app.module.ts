import { Module } from "@nestjs/common";

import { AdminModule } from "./admin/admin.module.js";
import { AppController } from "./app.controller.js";
import { AuthModule } from "./auth/auth.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { MediaModule } from "./media/media.module.js";
import { PlatformConfigModule } from "./platform-config/platform-config.module.js";

@Module({
  imports: [DatabaseModule, PlatformConfigModule, AuthModule, AdminModule, MediaModule],
  controllers: [AppController],
})
export class AppModule {}
