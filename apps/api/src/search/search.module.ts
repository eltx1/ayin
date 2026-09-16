import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { MovieCatalogModule } from "../movie-catalog/movie-catalog.module.js";
import { PlatformConfigModule } from "../platform-config/platform-config.module.js";
import { SeriesCatalogModule } from "../series-catalog/series-catalog.module.js";
import { VideoPolicyModule } from "../video-policy/video-policy.module.js";
import { LanguageAwarePostgresSearchService } from "./language-aware-postgres-search.service.js";
import { LensEmbeddingIndexService } from "./lens-embedding-index.service.js";
import { LensSemanticHydratorService } from "./lens-semantic-hydrator.service.js";
import {
  AYIN_LENS_EMBEDDING_PROVIDER,
  UnconfiguredAyinLensEmbeddingProvider,
} from "./lens-search.provider.js";
import { LensSearchService } from "./lens-search.service.js";
import { LensSemanticRuntimeConfig } from "./lens-semantic-config.js";
import { PostgresSearchService } from "./search-postgres.service.js";
import { SearchController } from "./search.controller.js";
import { SearchLanguageContextService } from "./search-language-context.service.js";
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
    SearchLanguageContextService,
    LanguageAwarePostgresSearchService,
    {
      provide: PostgresSearchService,
      useExisting: LanguageAwarePostgresSearchService,
    },
    LensSearchService,
    LensSemanticRuntimeConfig,
    LensEmbeddingIndexService,
    LensSemanticHydratorService,
    SearchRateLimiter,
    UnconfiguredAyinLensEmbeddingProvider,
    {
      provide: AYIN_LENS_EMBEDDING_PROVIDER,
      useExisting: UnconfiguredAyinLensEmbeddingProvider,
    },
  ],
})
export class SearchModule {}
