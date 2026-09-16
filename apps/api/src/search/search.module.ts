import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { MovieCatalogModule } from "../movie-catalog/movie-catalog.module.js";
import { PlatformConfigModule } from "../platform-config/platform-config.module.js";
import { SeriesCatalogModule } from "../series-catalog/series-catalog.module.js";
import { VideoPolicyModule } from "../video-policy/video-policy.module.js";
import {
  AYIN_LENS_SEARCH_PROVIDER,
  UnconfiguredAyinLensSearchProvider,
} from "./lens-search.provider.js";
import { LensSearchService } from "./lens-search.service.js";
import { PostgresSearchService } from "./search-postgres.service.js";
import { SearchController } from "./search.controller.js";
import { SearchRateLimiter } from "./search-rate-limiter.js";
import { SearchService } from "./search.service.js";

@Module({
  imports: [
    DatabaseModule,
    MovieCatalogModule,
    PlatformConfigModule,
    SeriesCatalogModule,
    VideoPolicyModule,
  ],
  controllers: [SearchController],
  providers: [
    SearchService,
    PostgresSearchService,
    LensSearchService,
    SearchRateLimiter,
    UnconfiguredAyinLensSearchProvider,
    { provide: AYIN_LENS_SEARCH_PROVIDER, useExisting: UnconfiguredAyinLensSearchProvider },
  ],
})
export class SearchModule {}
