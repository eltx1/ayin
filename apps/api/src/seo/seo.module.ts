import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { VideoPolicyModule } from "../video-policy/video-policy.module.js";
import { SeoSitemapCountsController } from "./seo-sitemap-counts.controller.js";
import { SeoController } from "./seo.controller.js";
import { SeoService } from "./seo.service.js";

@Module({
  imports: [DatabaseModule, VideoPolicyModule],
  controllers: [SeoController, SeoSitemapCountsController],
  providers: [SeoService],
})
export class SeoModule {}
