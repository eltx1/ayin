import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { SeriesCatalogModule } from "../series-catalog/series-catalog.module.js";
import { VideoPolicyModule } from "../video-policy/video-policy.module.js";
import { DiscoveryController, PublicDiscoveryController } from "./discovery.controller.js";
import { DiscoveryService, HomeRowConfigService } from "./discovery.service.js";
import { RegionalDiscoveryService } from "./regional-discovery.service.js";

@Module({
  imports: [AuthModule, DatabaseModule, SeriesCatalogModule, VideoPolicyModule],
  controllers: [PublicDiscoveryController, DiscoveryController],
  providers: [HomeRowConfigService, RegionalDiscoveryService, DiscoveryService],
  exports: [HomeRowConfigService, RegionalDiscoveryService, DiscoveryService],
})
export class DiscoveryModule {}
