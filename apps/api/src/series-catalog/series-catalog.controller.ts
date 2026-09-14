import { Controller, Get, Headers, Inject, Param, Query } from "@nestjs/common";
import { z } from "zod";

import { TrustedRegionService, type HeaderBag } from "../video-policy/trusted-region.service.js";
import { SeriesCatalogService } from "./series-catalog.service.js";

const listQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(24).optional(),
    search: z.string().trim().min(2).max(100).optional(),
  })
  .strict();

@Controller("public/series")
export class PublicSeriesCatalogController {
  constructor(
    @Inject(SeriesCatalogService) private readonly catalog: SeriesCatalogService,
    @Inject(TrustedRegionService) private readonly trustedRegion: TrustedRegionService,
  ) {}

  @Get()
  async list(@Query() query: unknown, @Headers() headers: HeaderBag) {
    const parsed = listQuerySchema.safeParse(query);
    const countryCode = this.trustedRegion.countryFromHeaders(headers);
    const limit = parsed.success ? (parsed.data.limit ?? 24) : 24;
    const search = parsed.success ? parsed.data.search : undefined;
    return { items: await this.catalog.listPublic(limit, search, countryCode) };
  }

  @Get("video/:videoId/context")
  async videoContext(@Param("videoId") videoId: string, @Headers() headers: HeaderBag) {
    const countryCode = this.trustedRegion.countryFromHeaders(headers);
    return { context: await this.catalog.getPublicContextForVideo(videoId, countryCode) };
  }

  @Get(":slug")
  async detail(@Param("slug") slug: string, @Headers() headers: HeaderBag) {
    const countryCode = this.trustedRegion.countryFromHeaders(headers);
    return { series: await this.catalog.getPublicBySlug(slug, countryCode) };
  }
}
