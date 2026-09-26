import { Module } from "@nestjs/common";

import { AdminModule } from "../admin/admin.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { VideoPolicyModule } from "../video-policy/video-policy.module.js";
import {
  AdminAnalyticsController,
  CreatorAnalyticsController,
  PublicAnalyticsController,
} from "./analytics.controller.js";
import { AnalyticsRollupService } from "./analytics-rollup.service.js";
import { AnalyticsRollupWorkerService } from "./analytics-rollup-worker.service.js";
import { AnalyticsService } from "./analytics.service.js";

@Module({
  imports: [DatabaseModule, AuthModule, AdminModule, VideoPolicyModule],
  controllers: [PublicAnalyticsController, CreatorAnalyticsController, AdminAnalyticsController],
  providers: [AnalyticsService, AnalyticsRollupService, AnalyticsRollupWorkerService],
  exports: [AnalyticsService, AnalyticsRollupService],
})
export class AnalyticsModule {}
