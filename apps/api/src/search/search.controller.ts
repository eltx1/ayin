import { Controller, Get, HttpException, Inject, Query, Req } from "@nestjs/common";
import { z } from "zod";

import { LensSearchService } from "./lens-search.service.js";
import { SearchRateLimiter } from "./search-rate-limiter.js";
import { SearchError, SearchService } from "./search.service.js";

const searchSchema = z
  .object({
    q: z.string(),
    cursor: z.string().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(24).optional(),
  })
  .strict();
const suggestSchema = z
  .object({ q: z.string(), limit: z.coerce.number().int().min(1).max(8).optional() })
  .strict();

@Controller("public/search")
export class SearchController {
  constructor(
    @Inject(SearchService) private readonly searchService: SearchService,
    @Inject(LensSearchService) private readonly lensSearch: LensSearchService,
    @Inject(SearchRateLimiter) private readonly rateLimiter: SearchRateLimiter,
  ) {}

  @Get()
  async search(@Req() request: { ip?: string }, @Query() query: unknown) {
    return runSearch(() => {
      this.rateLimiter.consume(`search:${request.ip ?? "unknown"}`);
      const parsed = searchSchema.safeParse(query);
      if (!parsed.success)
        throw new SearchError("INVALID_SEARCH_QUERY", "The search request is invalid.");
      return this.searchService.search(parsed.data.q, parsed.data.cursor, parsed.data.limit);
    });
  }

  @Get("lens")
  async lens(@Req() request: { ip?: string }, @Query() query: unknown) {
    return runSearch(() => {
      this.rateLimiter.consume(`lens:${request.ip ?? "unknown"}`);
      const parsed = searchSchema.safeParse(query);
      if (!parsed.success)
        throw new SearchError("INVALID_SEARCH_QUERY", "The Lens search request is invalid.");
      return this.lensSearch.searchLens(parsed.data.q, parsed.data.limit);
    });
  }

  @Get("suggestions")
  async suggestions(@Req() request: { ip?: string }, @Query() query: unknown) {
    return runSearch(() => {
      this.rateLimiter.consume(`suggest:${request.ip ?? "unknown"}`);
      const parsed = suggestSchema.safeParse(query);
      if (!parsed.success)
        throw new SearchError("INVALID_SEARCH_QUERY", "The suggestion request is invalid.");
      return this.searchService.suggest(parsed.data.q, parsed.data.limit);
    });
  }
}

async function runSearch<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof SearchError) {
      throw new HttpException(
        { error: { code: error.code, message: error.message } },
        error.statusCode,
      );
    }
    throw error instanceof Error ? error : new Error("Unexpected search error.");
  }
}
