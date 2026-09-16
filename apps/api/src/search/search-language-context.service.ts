import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

import { Injectable, Logger } from "@nestjs/common";

import { languageFromLocale, type SearchLanguage } from "./search-language.js";

const slowSearchThresholdMs = 500;

type SearchRequestContext = {
  uiLocale: string | undefined;
  uiLanguage: SearchLanguage;
};

@Injectable()
export class SearchLanguageContextService {
  private readonly storage = new AsyncLocalStorage<SearchRequestContext>();
  private readonly logger = new Logger("SearchLatency");

  async run<T>(
    uiLocale: string | undefined,
    operation: "search" | "suggest" | "kids-search" | "kids-suggest" | "lens",
    callback: () => Promise<T>,
  ): Promise<T> {
    const normalizedLocale = uiLocale?.trim().replaceAll("_", "-") || undefined;
    const startedAt = performance.now();
    return this.storage.run(
      {
        uiLocale: normalizedLocale,
        uiLanguage: languageFromLocale(normalizedLocale),
      },
      async () => {
        try {
          return await callback();
        } finally {
          const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
          const message = JSON.stringify({
            event: "search.latency",
            operation,
            uiLanguage: this.currentUiLanguage(),
            durationMs,
            slow: durationMs >= slowSearchThresholdMs,
          });
          if (durationMs >= slowSearchThresholdMs) this.logger.warn(message);
          else this.logger.debug(message);
        }
      },
    );
  }

  currentUiLocale(): string | undefined {
    return this.storage.getStore()?.uiLocale;
  }

  currentUiLanguage(): SearchLanguage {
    return this.storage.getStore()?.uiLanguage ?? "und";
  }
}

export { slowSearchThresholdMs as SEARCH_SLOW_QUERY_THRESHOLD_MS };
