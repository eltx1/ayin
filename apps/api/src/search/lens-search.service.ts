import { Inject, Injectable } from "@nestjs/common";

import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";
import {
  AYIN_LENS_SEARCH_PROVIDER,
  type AyinLensSearchProvider,
} from "./lens-search.provider.js";
import { SearchService } from "./search.service.js";

@Injectable()
export class LensSearchService {
  constructor(
    @Inject(SearchService) private readonly search: SearchService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
    @Inject(AYIN_LENS_SEARCH_PROVIDER) private readonly provider: AyinLensSearchProvider,
  ) {}

  async searchLens(query: string, limit = 12) {
    const semanticEnabled = (await this.settings.get("lensSemanticSearchEnabled")) as boolean;
    if (semanticEnabled && this.provider.isConfigured()) {
      const items = await this.provider.search(query, Math.min(Math.max(limit, 1), 24));
      return {
        query,
        mode: "SEMANTIC_PROVIDER" as const,
        semanticEnabled: true,
        providerConfigured: true,
        items,
      };
    }

    const fallback = await this.search.search(query, undefined, limit);
    return {
      ...fallback,
      mode: "LEXICAL_FALLBACK" as const,
      semanticEnabled,
      providerConfigured: false,
      explanation: semanticEnabled
        ? "Semantic AYIN Lens is enabled but no configured embedding/search provider is available, so AYIN used its private lexical index instead."
        : "AYIN Lens semantic search is disabled; results use the local lexical search path.",
    };
  }
}
