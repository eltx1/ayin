import { Module } from "@nestjs/common";

import { AdsModule } from "../ads/ads.module.js";
import { LinearSsaiService } from "../ads/linear-ssai.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { MediaModule } from "../media/media.module.js";
import { MediaProcessingStorageService } from "../media/media-processing-storage.service.js";
import { PlatformConfigModule } from "../platform-config/platform-config.module.js";
import { VideoPolicyModule } from "../video-policy/video-policy.module.js";
import { CaptionController } from "./caption.controller.js";
import { CaptionService } from "./caption.service.js";
import { CreatorChannelController, PublicChannelController } from "./channel.controller.js";
import { ChannelService } from "./channel.service.js";
import { PublicClipsController } from "./clips.controller.js";
import { ClipsService } from "./clips.service.js";
import { CREATOR_TV_AD_BREAK_HOOK } from "./creator-tv-ad-break.hook.js";
import { CreatorTvController, PublicCreatorTvController } from "./creator-tv.controller.js";
import { PublicCreatorTvLinearOutputController } from "./creator-tv-linear-output.controller.js";
import {
  CREATOR_TV_LINEAR_PROVIDER,
  UnconfiguredLinearStreamingProvider,
} from "./creator-tv-linear.provider.js";
import { CreatorTvLinearService } from "./creator-tv-linear.service.js";
import {
  OwnedLinearStreamingProvider,
  type LinearSourceMaterializer,
} from "./owned-linear-streaming.provider.js";
import { CreatorTvService } from "./creator-tv.service.js";
import {
  CreatorPlaylistCollectionController,
  CreatorPlaylistController,
  PublicPlaylistController,
} from "./playlist.controller.js";
import { PlaylistService } from "./playlist.service.js";
import { QuickUploadController } from "./quick-upload.controller.js";
import { QuickUploadService } from "./quick-upload.service.js";
import { StudioController } from "./studio.controller.js";
import { StudioService } from "./studio.service.js";
import { VideoMetadataService } from "./video-metadata.service.js";

@Module({
  imports: [AdsModule, AuthModule, DatabaseModule, MediaModule, PlatformConfigModule, VideoPolicyModule],
  controllers: [
    QuickUploadController,
    StudioController,
    CaptionController,
    PublicChannelController,
    PublicClipsController,
    CreatorChannelController,
    PublicPlaylistController,
    CreatorPlaylistCollectionController,
    CreatorPlaylistController,
    PublicCreatorTvController,
    PublicCreatorTvLinearOutputController,
    CreatorTvController,
  ],
  providers: [
    QuickUploadService,
    StudioService,
    VideoMetadataService,
    CaptionService,
    ChannelService,
    ClipsService,
    PlaylistService,
    CreatorTvService,
    CreatorTvLinearService,
    { provide: CREATOR_TV_AD_BREAK_HOOK, useExisting: LinearSsaiService },
    UnconfiguredLinearStreamingProvider,
    {
      provide: OwnedLinearStreamingProvider,
      inject: [MediaProcessingStorageService],
      useFactory: (storage: MediaProcessingStorageService) => {
        const materialize: LinearSourceMaterializer = (objectKey, destinationPath) =>
          storage.downloadToFile(objectKey, destinationPath);
        return new OwnedLinearStreamingProvider(process.env, materialize);
      },
    },
    {
      provide: CREATOR_TV_LINEAR_PROVIDER,
      inject: [OwnedLinearStreamingProvider, UnconfiguredLinearStreamingProvider],
      useFactory: selectLinearStreamingProvider,
    },
  ],
  exports: [
    ChannelService,
    PlaylistService,
    CreatorTvService,
    CreatorTvLinearService,
    StudioService,
    VideoMetadataService,
    CaptionService,
  ],
})
export class CreatorModule {}

export function selectLinearStreamingProvider(
  owned: OwnedLinearStreamingProvider,
  fallback: UnconfiguredLinearStreamingProvider,
) {
  return owned.configured ? owned : fallback;
}
