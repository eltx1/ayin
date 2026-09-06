import { BadRequestException, Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { z } from "zod";

import { SeoService, type SeoSitemapKind } from "./seo.service.js";

const sitemapQuerySchema = z
  .object({
    offset: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
    limit: z.coerce.number().int().min(1).max(5_000).default(1_000),
  })
  .strict();

const sitemapKinds = new Set<SeoSitemapKind>(["videos", "channels", "playlists"]);

@Controller("public/seo")
export class SeoController {
  constructor(@Inject(SeoService) private readonly seo: SeoService) {}

  @Get("videos/:slug")
  getVideo(@Param("slug") slug: string) {
    return this.seo.getVideo(slug);
  }

  @Get("channels/:handle")
  getChannel(@Param("handle") handle: string) {
    return this.seo.getChannel(handle);
  }

  @Get("playlists/:handle/:slug")
  getPlaylist(@Param("handle") handle: string, @Param("slug") slug: string) {
    return this.seo.getPlaylist(handle, slug);
  }

  @Get("sitemap/:kind")
  listSitemap(@Param("kind") kindRaw: string, @Query() query: unknown) {
    if (!sitemapKinds.has(kindRaw as SeoSitemapKind)) {
      throw new BadRequestException("Unsupported SEO sitemap kind.");
    }
    const parsed = sitemapQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException("Invalid SEO sitemap pagination.");
    }
    return this.seo.listSitemap(
      kindRaw as SeoSitemapKind,
      parsed.data.offset,
      parsed.data.limit,
    );
  }
}
