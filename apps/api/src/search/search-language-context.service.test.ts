import { describe, expect, it } from "vitest";

import {
  SEARCH_SLOW_QUERY_THRESHOLD_MS,
  SearchLanguageContextService,
} from "./search-language-context.service.js";

describe("Task 65 search language context", () => {
  it("keeps the current UI locale request-local across async work", async () => {
    const context = new SearchLanguageContextService();
    expect(context.currentUiLanguage()).toBe("und");
    await context.run("ar-EG", "search", async () => {
      await Promise.resolve();
      expect(context.currentUiLocale()).toBe("ar-EG");
      expect(context.currentUiLanguage()).toBe("ar");
    });
    expect(context.currentUiLanguage()).toBe("und");
  });

  it("defines an explicit slow-search latency threshold", () => {
    expect(SEARCH_SLOW_QUERY_THRESHOLD_MS).toBeGreaterThanOrEqual(100);
    expect(SEARCH_SLOW_QUERY_THRESHOLD_MS).toBeLessThanOrEqual(2_000);
  });
});
