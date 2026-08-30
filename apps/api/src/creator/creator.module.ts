import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { MediaModule } from "../media/media.module.js";
import { PlatformConfigModule } from "../platform-config/platform-config.module.js";
import { CreatorChannelController, PublicChannelController } from "./channel.controller.js";
import { ChannelService } from "./channel.service.js";
import { PublicClipsController } from "./clips.controller.js";
import { ClipsService } from "./clips.service.js";
import { CREATOR_TV_AD_BREAK_HOOK, NoopCreatorTvAdBreakHook } from "./creator-tv-ad-break.hook.js";
import { CreatorTvController, PublicCreatorTvController } from "./creator-tv.controller.js";
import {
  CREATOR_TV_LINEAR_PROVIDER,
  UnconfiguredLinearStreamingProvider,
} from "./creator-tv-linear.provider.js";
import { CreatorTvLinearService } from "./creator-tv-linear.service.js";
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

@Module({
  imports: [AuthModule, DatabaseModule, MediaModule, PlatformConfigModule],
  controllers: [
    QuickUploadController,
    StudioController,
    PublicChannelController,
    PublicClipsController,
    CreatorChannelController,
    PublicPlaylistController,
    CreatorPlaylistCollectionController,
    CreatorPlaylistController,
    PublicCreatorTvController,
    CreatorTvController,
  ],
  providers: [
    QuickUploadService,
    StudioService,
    ChannelService,
    ClipsService,
    PlaylistService,
    CreatorTvService,
    CreatorTvLinearService,
    { provide: CREATOR_TV_AD_BREAK_HOOK, useClass: NoopCreatorTvAdBreakHook },
    { provide: CREATOR_TV_LINEAR_PROVIDER, useClass: UnconfiguredLinearStreamingProvider },
  ],
  exports: [
    ChannelService,
    PlaylistService,
    CreatorTvService,
    CreatorTvLinearService,
    StudioService,
  ],
})
export class CreatorModule {}
