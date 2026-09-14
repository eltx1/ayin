import { Controller, Get, Headers, Inject, Param, Query } from "@nestjs/common";
import { z } from "zod";

import { TrustedRegionService, type HeaderBag } from "../video-policy/trusted-region.service.js";
import { MovieCatalogService } from "./movie-catalog.service.js";

const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(24).optional() }).strict();

@Controller("public/movies")
export class PublicMovieCatalogController {
  constructor(
    @Inject(MovieCatalogService) private readonly catalog: MovieCatalogService,
    @Inject(TrustedRegionService) private readonly trustedRegion: TrustedRegionService,
  ) {}

  @Get()
  async list(@Query() query: unknown, @Headers() headers: HeaderBag) {
    const parsed = listQuerySchema.safeParse(query);
    const limit = parsed.success ? parsed.data.limit ?? 24 : 24;
    const countryCode = this.trustedRegion.countryFromHeaders(headers);
    return { items: await this.catalog.listPublic(countryCode, limit) };
  }

  @Get(":slug")
  async detail(@Param("slug") slug: string, @Headers() headers: HeaderBag) {
    const countryCode = this.trustedRegion.countryFromHeaders(headers);
    const movie = await this.catalog.getPublicBySlug(slug, countryCode);
    if (!movie) return { movie: null };
    return { movie };
  }
}
