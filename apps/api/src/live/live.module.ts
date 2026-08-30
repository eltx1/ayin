import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { PublicLiveController, StudioLiveController } from "./live.controller.js";
import { LIVE_INGEST_PROVIDER, UnconfiguredLiveIngestProvider } from "./live-provider.js";
import { LiveService } from "./live.service.js";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [PublicLiveController, StudioLiveController],
  providers: [
    LiveService,
    UnconfiguredLiveIngestProvider,
    { provide: LIVE_INGEST_PROVIDER, useExisting: UnconfiguredLiveIngestProvider },
  ],
  exports: [LiveService, LIVE_INGEST_PROVIDER],
})
export class LiveModule {}
