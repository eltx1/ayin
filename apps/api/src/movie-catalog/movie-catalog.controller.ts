import { Controller, Get, Header, Headers, Inject, Param, Query } from "@nestjs/common";
import { z } from "zod";

import { CatalogLocalizationService } from "../catalog-localization/catalog-localization.service.js";
import { TrustedRegionService, type HeaderBag } from "../video-policy/trusted-region.service.js";
import { parseDirectoryQuery } from "../video-policy/catalog-directory-query.js";
import { MovieCatalogService } from "./movie-catalog.service.js";

const listQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(24).optional(),
    locale: z.string().trim().min(2).max(35).optional(),
  })
  .strict();

@Controller("public/movies")
export class PublicMovieCatalogController {
  constructor(
    @Inject(MovieCatalogService) private readonly catalog: MovieCatalogService,
    @Inject(CatalogLocalizationService)
    private readonly localization: CatalogLocalizationService,
    @Inject(TrustedRegionService) private readonly trustedRegion: TrustedRegionService,
  ) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  async list(@Query() query: unknown, @Headers() headers: HeaderBag) {
    const parsed = listQuerySchema.safeParse(query);
    const limit = parsed.success ? (parsed.data.limit ?? 24) : 24;
    const locale = parsed.success ? parsed.data.locale : undefined;
    const countryCode = this.trustedRegion.countryFromHeaders(headers);
    const items = await this.catalog.listPublic(countryCode, limit);
    return { items: await this.localization.localizeMovies(items, locale) };
  }

  @Get("directory")
  @Header("Cache-Control", "private, no-store")
  async directory(@Query() query: unknown, @Headers() headers: HeaderBag) {
    const { limit, cursor, locale } = parseDirectoryQuery(query);
    const page = await this.catalog.listPublicDirectory(
      limit,
      cursor,
      this.trustedRegion.countryFromHeaders(headers),
    );
    return { ...page, items: await this.localization.localizeMovies(page.items, locale) };
  }

  @Get(":slug")
  @Header("Cache-Control", "private, no-store")
  async detail(
    @Param("slug") slug: string,
    @Query("locale") locale: string | undefined,
    @Headers() headers: HeaderBag,
  ) {
    const countryCode = this.trustedRegion.countryFromHeaders(headers);
    const movie = await this.catalog.getPublicBySlug(slug, countryCode);
    if (!movie) return { movie: null };
    return { movie: await this.localization.localizeMovie(movie, locale) };
  }
}
