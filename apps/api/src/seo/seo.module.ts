import { Module } from "@nestjs/common";

import { SeoSitemapCountsController } from "./seo-sitemap-counts.controller.js";
import { SeoController } from "./seo.controller.js";
import { SeoService } from "./seo.service.js";

@Module({
  controllers: [SeoController, SeoSitemapCountsController],
  providers: [SeoService],
})
export class SeoModule {}
