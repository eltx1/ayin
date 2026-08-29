import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { WatchModule } from "../watch/watch.module.js";
import { ContentController } from "./content.controller.js";
import { ContentService } from "./content.service.js";

@Module({
  imports: [DatabaseModule, WatchModule],
  controllers: [ContentController],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}
