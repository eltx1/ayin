import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { TrustedRegionService } from "./trusted-region.service.js";
import { VideoPolicyService } from "./video-policy.service.js";

@Module({
  imports: [DatabaseModule],
  providers: [VideoPolicyService, TrustedRegionService],
  exports: [VideoPolicyService, TrustedRegionService],
})
export class VideoPolicyModule {}
