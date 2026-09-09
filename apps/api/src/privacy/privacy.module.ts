import { Module } from "@nestjs/common";

import { AdminModule } from "../admin/admin.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { MediaModule } from "../media/media.module.js";
import { ObservabilityModule } from "../observability/observability.module.js";
import { AdminPrivacyController, PrivacyController } from "./privacy.controller.js";
import { PrivacyExportService } from "./privacy-export.service.js";
import { PrivacyLifecycleService } from "./privacy-lifecycle.service.js";
import { PrivacyLifecycleWorkerService } from "./privacy-lifecycle-worker.service.js";

@Module({
  imports: [AuthModule, DatabaseModule, MediaModule, AdminModule, ObservabilityModule],
  controllers: [PrivacyController, AdminPrivacyController],
  providers: [PrivacyExportService, PrivacyLifecycleService, PrivacyLifecycleWorkerService],
  exports: [PrivacyLifecycleService, PrivacyLifecycleWorkerService],
})
export class PrivacyModule {}
