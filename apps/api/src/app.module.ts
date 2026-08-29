import { Module } from "@nestjs/common";

import { AdminModule } from "./admin/admin.module.js";
import { AdsModule } from "./ads/ads.module.js";
import { AppController } from "./app.controller.js";
import { AuthModule } from "./auth/auth.module.js";
import { CommentsModule } from "./comments/comments.module.js";
import { CreatorModule } from "./creator/creator.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { DiscoveryModule } from "./discovery/discovery.module.js";
import { MediaModule } from "./media/media.module.js";
import { PlatformConfigModule } from "./platform-config/platform-config.module.js";
import { SearchModule } from "./search/search.module.js";
import { SocialModule } from "./social/social.module.js";
import { WatchModule } from "./watch/watch.module.js";

@Module({
  imports: [
    DatabaseModule,
    PlatformConfigModule,
    AuthModule,
    AdminModule,
    AdsModule,
    MediaModule,
    CreatorModule,
    WatchModule,
    DiscoveryModule,
    SearchModule,
    SocialModule,
    CommentsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
