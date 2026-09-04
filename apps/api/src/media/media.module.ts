import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { PlatformConfigModule } from "../platform-config/platform-config.module.js";
import { DevelopmentMediaStorageAdapter } from "./development-media-storage.adapter.js";
import { E2eMediaStorageAdapter } from "./e2e-media-storage.adapter.js";
import {
  MEDIA_STORAGE_ADAPTER,
  MEDIA_STORAGE_CONFIG,
  type MediaStorageAdapter,
} from "./media-storage.adapter.js";
import { loadMediaStorageConfig, type MediaStorageConfig } from "./media-storage.config.js";
import { MediaProcessingExecutorService } from "./media-processing-executor.service.js";
import { MediaProcessingLifecycleService } from "./media-processing-lifecycle.service.js";
import { MediaProcessingQueueService } from "./media-processing-queue.service.js";
import { MediaProcessingStorageService } from "./media-processing-storage.service.js";
import { MediaProcessingWorkerService } from "./media-processing-worker.service.js";
import { MediaUploadController } from "./media-upload.controller.js";
import { MediaUploadService } from "./media-upload.service.js";
import { R2MediaStorageAdapter } from "./r2-media-storage.adapter.js";
import { UploadRateLimiter } from "./upload-rate-limiter.js";
import { UploadSessionTokenService } from "./upload-session-token.service.js";

@Module({
  imports: [AuthModule, DatabaseModule, PlatformConfigModule],
  controllers: [MediaUploadController],
  providers: [
    { provide: MEDIA_STORAGE_CONFIG, useFactory: () => loadMediaStorageConfig() },
    {
      provide: MEDIA_STORAGE_ADAPTER,
      inject: [MEDIA_STORAGE_CONFIG],
      useFactory: (config: MediaStorageConfig): MediaStorageAdapter => {
        if (config.mode === "r2") return new R2MediaStorageAdapter(config);
        if (config.mode === "e2e") return new E2eMediaStorageAdapter();
        return new DevelopmentMediaStorageAdapter();
      },
    },
    UploadSessionTokenService,
    UploadRateLimiter,
    MediaUploadService,
    MediaProcessingQueueService,
    MediaProcessingLifecycleService,
    MediaProcessingStorageService,
    MediaProcessingExecutorService,
    MediaProcessingWorkerService,
  ],
  exports: [
    MEDIA_STORAGE_ADAPTER,
    MEDIA_STORAGE_CONFIG,
    MediaUploadService,
    MediaProcessingQueueService,
    MediaProcessingLifecycleService,
    MediaProcessingStorageService,
    MediaProcessingExecutorService,
    MediaProcessingWorkerService,
  ],
})
export class MediaModule {}
