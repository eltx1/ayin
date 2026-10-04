import { Controller, Get, Header, Inject } from "@nestjs/common";
import { SeoService } from "./seo.service.js";
@Controller("public/seo")
export class SeoSitemapCountsController {
  constructor(@Inject(SeoService) private readonly seo: SeoService) {}
  @Get("sitemap-counts")
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  counts() {
    return this.seo.sitemapCounts();
  }
}
