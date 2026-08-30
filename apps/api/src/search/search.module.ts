import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { PlatformConfigModule } from "../platform-config/platform-config.module.js";
import {
  AYIN_LENS_SEARCH_PROVIDER,
  UnconfiguredAyinLensSearchProvider,
} from "./lens-search.provider.js";
import { LensSearchService } from "./lens-search.service.js";
import { SearchController } from "./search.controller.js";
import { SearchRateLimiter } from "./search-rate-limiter.js";
import { SearchService } from "./search.service.js";

@Module({
  imports: [DatabaseModule, PlatformConfigModule],
  controllers: [SearchController],
  providers: [
    SearchService,
    LensSearchService,
    SearchRateLimiter,
    UnconfiguredAyinLensSearchProvider,
    { provide: AYIN_LENS_SEARCH_PROVIDER, useExisting: UnconfiguredAyinLensSearchProvider },
  ],
})
export class SearchModule {}
