import { Module } from "@nestjs/common";

import { AdminModule } from "../admin/admin.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { VideoPolicyModule } from "../video-policy/video-policy.module.js";
import { AdminSeriesCatalogController } from "./admin-series-catalog.controller.js";
import { PublicSeriesCatalogController } from "./series-catalog.controller.js";
import { SeriesCatalogService } from "./series-catalog.service.js";
import { SeriesSitemapController } from "./series-sitemap.controller.js";

@Module({
  imports: [AuthModule, AdminModule, VideoPolicyModule],
  controllers: [PublicSeriesCatalogController, SeriesSitemapController, AdminSeriesCatalogController],
  providers: [SeriesCatalogService],
  exports: [SeriesCatalogService],
})
export class SeriesCatalogModule {}
