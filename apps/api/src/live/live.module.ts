import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { MediaModule } from "../media/media.module.js";
import {
  MuxLiveWebhookController,
  PublicLiveController,
  StudioLiveController,
} from "./live.controller.js";
import {
  LIVE_INGEST_PROVIDER,
  type LiveIngestProvider,
  UnconfiguredLiveIngestProvider,
} from "./live-provider.js";
import { MuxLiveIngestProvider } from "./mux-live-provider.js";
import { LiveRecordingHandoffService } from "./live-recording-handoff.service.js";
import { LiveRecordingWorkerService } from "./live-recording-worker.service.js";
import { LiveService } from "./live.service.js";

export function selectLiveIngestProvider(
  mux: MuxLiveIngestProvider,
  fallback: UnconfiguredLiveIngestProvider,
): LiveIngestProvider {
  return mux.configured ? mux : fallback;
}

@Module({
  imports: [AuthModule, DatabaseModule, MediaModule],
  controllers: [PublicLiveController, StudioLiveController, MuxLiveWebhookController],
  providers: [
    LiveService,
    LiveRecordingHandoffService,
    LiveRecordingWorkerService,
    UnconfiguredLiveIngestProvider,
    {
      provide: MuxLiveIngestProvider,
      useFactory: () => new MuxLiveIngestProvider(process.env),
    },
    {
      provide: LIVE_INGEST_PROVIDER,
      inject: [MuxLiveIngestProvider, UnconfiguredLiveIngestProvider],
      useFactory: selectLiveIngestProvider,
    },
  ],
  exports: [LiveService, LIVE_INGEST_PROVIDER],
})
export class LiveModule {}
