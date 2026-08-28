import { Module } from "@nestjs/common";

import { FeatureFlagService } from "./feature-flag.service.js";
import { PlatformSettingsService } from "./platform-settings.service.js";
import { PublicPlatformController } from "./public-platform.controller.js";

@Module({
  controllers: [PublicPlatformController],
  providers: [FeatureFlagService, PlatformSettingsService],
  exports: [FeatureFlagService, PlatformSettingsService],
})
export class PlatformConfigModule {}
