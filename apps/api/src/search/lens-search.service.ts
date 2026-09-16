import { Inject, Injectable, Logger } from "@nestjs/common";

import { PlatformSettingsService } from "../platform-config/platform-settings.service.js";
import type { VideoPolicyContext } from "../video-policy/video-policy.service.js";
import { LensEmbeddingIndexService } from "./lens-embedding-index.service.js";
import { rankLensHybrid, LENS_HYBRID_RANKING_VERSION } from "./lens-hybrid-ranker.js";
import { LensSemanticHydratorService } from "./lens-semantic-hydrator.service.js";
import { LensSemanticRuntimeConfig } from "./lens-semantic-config.js";
import { SearchService } from "./search.service.js";

@Injectable()
export class LensSearchService {
  private readonly logger = new Logger(LensSearchService.name);

  constructor(
    @Inject(SearchService) private readonly search: SearchService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
    @Inject(LensEmbeddingIndexService) private readonly embeddings: LensEmbeddingIndexService,
    @Inject(LensSemanticHydratorService)
    private readonly semanticHydrator: LensSemanticHydratorService,
    @Inject(LensSemanticRuntimeConfig) private readonly runtimeConfig: LensSemanticRuntimeConfig,
  ) {}

  async searchLens(query: string, limit = 12, context: VideoPolicyContext = {}) {
    const startedAt = Date.now();
    const boundedLimit = Math.min(Math.max(limit, 1), 24);

    // Lexical Search V2 remains the mandatory base path. Semantic retrieval only augments this
    // already policy-safe result set and any semantic failure falls back to this value.
    const lexical = await this.search.search(query, undefined, boundedLimit, context);
    const featureEnabled = (await this.settings.get("lensSemanticSearchEnabled")) as boolean;
    const runtime = this.runtimeConfig.snapshot();
    const providerConfigured = this.embeddings.providerConfigured();

    if (!featureEnabled || runtime.killSwitch || !providerConfigured) {
      return this.lexicalFallback(lexical, {
        featureEnabled,
        killSwitch: runtime.killSwitch,
        providerConfigured,
        startedAt,
        reason: !featureEnabled
          ? "feature-disabled"
          : runtime.killSwitch
            ? "kill-switch"
            : "provider-unconfigured",
      });
    }

    try {
      const semanticCandidates = await this.embeddings.semanticCandidates(lexical.query);
      const semanticHits = await this.semanticHydrator.hydrate(semanticCandidates, context);
      if (!semanticHits.length) {
        return this.lexicalFallback(lexical, {
          featureEnabled,
          killSwitch: false,
          providerConfigured: true,
          startedAt,
          reason: "no-policy-eligible-semantic-hits",
        });
      }

      const ranked = rankLensHybrid(lexical.items, semanticHits, boundedLimit);
      const info = this.embeddings.providerInfo();
      this.logLatency(startedAt, "HYBRID", semanticHits.length);
      return {
        query: lexical.query,
        mode: "HYBRID" as const,
        semanticEnabled: true,
        providerConfigured: true,
        rankingVersion: LENS_HYBRID_RANKING_VERSION,
        embeddingProvider: info.providerKey,
        embeddingModel: info.model,
        embeddingModelVersion: info.modelVersion,
        items: ranked.map((entry) => entry.item),
        nextCursor: null,
        emptyMessage: ranked.length === 0 ? lexical.emptyMessage : null,
      };
    } catch {
      return this.lexicalFallback(lexical, {
        featureEnabled,
        killSwitch: false,
        providerConfigured: true,
        startedAt,
        reason: "semantic-unavailable",
      });
    }
  }

  private lexicalFallback(
    lexical: Awaited<ReturnType<SearchService["search"]>>,
    input: {
      featureEnabled: boolean;
      killSwitch: boolean;
      providerConfigured: boolean;
      startedAt: number;
      reason: string;
    },
  ) {
    this.logLatency(input.startedAt, "LEXICAL_FALLBACK", 0);
    return {
      ...lexical,
      mode: "LEXICAL_FALLBACK" as const,
      semanticEnabled: input.featureEnabled && !input.killSwitch && input.providerConfigured,
      providerConfigured: input.providerConfigured,
      semanticKillSwitch: input.killSwitch,
      fallbackReason: input.reason,
    };
  }

  private logLatency(startedAt: number, mode: "HYBRID" | "LEXICAL_FALLBACK", semanticHits: number) {
    this.logger.log(
      JSON.stringify({
        event: "ayin_lens_search",
        mode,
        semanticHits,
        durationMs: Date.now() - startedAt,
      }),
    );
  }
}
