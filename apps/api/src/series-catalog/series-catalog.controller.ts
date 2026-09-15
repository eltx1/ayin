import { Controller, Get, Headers, Inject, Param, Query } from "@nestjs/common";
import { z } from "zod";

import { CatalogLocalizationService } from "../catalog-localization/catalog-localization.service.js";
import { TrustedRegionService, type HeaderBag } from "../video-policy/trusted-region.service.js";
import { SeriesCatalogService } from "./series-catalog.service.js";

const listQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(24).optional(),
    search: z.string().trim().min(2).max(100).optional(),
    locale: z.string().trim().min(2).max(35).optional(),
  })
  .strict();

@Controller("public/series")
export class PublicSeriesCatalogController {
  constructor(
    @Inject(SeriesCatalogService) private readonly catalog: SeriesCatalogService,
    @Inject(CatalogLocalizationService)
    private readonly localization: CatalogLocalizationService,
    @Inject(TrustedRegionService) private readonly trustedRegion: TrustedRegionService,
  ) {}

  @Get()
  async list(@Query() query: unknown, @Headers() headers: HeaderBag) {
    const parsed = listQuerySchema.safeParse(query);
    const countryCode = this.trustedRegion.countryFromHeaders(headers);
    const limit = parsed.success ? (parsed.data.limit ?? 24) : 24;
    const search = parsed.success ? parsed.data.search : undefined;
    const locale = parsed.success ? parsed.data.locale : undefined;
    const items = await this.catalog.listPublic(limit, search, countryCode);
    return { items: await this.localization.localizeSeriesList(items, locale) };
  }

  @Get("video/:videoId/context")
  async videoContext(
    @Param("videoId") videoId: string,
    @Query("locale") locale: string | undefined,
    @Headers() headers: HeaderBag,
  ) {
    const countryCode = this.trustedRegion.countryFromHeaders(headers);
    const context = await this.catalog.getPublicContextForVideo(videoId, countryCode);
    return {
      context: context ? await this.localization.localizeSeriesContext(context, locale) : null,
    };
  }

  @Get(":slug")
  async detail(
    @Param("slug") slug: string,
    @Query("locale") locale: string | undefined,
    @Headers() headers: HeaderBag,
  ) {
    const countryCode = this.trustedRegion.countryFromHeaders(headers);
    const series = await this.catalog.getPublicBySlug(slug, countryCode);
    return { series: await this.localization.localizeSeries(series, locale) };
  }
}
