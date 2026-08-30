import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { PlatformConfigModule } from "../platform-config/platform-config.module.js";
import { RecommendationController } from "./recommendation.controller.js";
import { RecommendationService } from "./recommendation.service.js";

@Module({
  imports: [DatabaseModule, PlatformConfigModule],
  controllers: [RecommendationController],
  providers: [RecommendationService],
  exports: [RecommendationService],
})
export class RecommendationModule {}
