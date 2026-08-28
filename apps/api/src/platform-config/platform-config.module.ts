import { Module } from "@nestjs/common";

import { FeatureFlagService } from "./feature-flag.service.js";
import { PlatformSettingsService } from "./platform-settings.service.js";

@Module({
  providers: [FeatureFlagService, PlatformSettingsService],
  exports: [FeatureFlagService, PlatformSettingsService],
})
export class PlatformConfigModule {}
