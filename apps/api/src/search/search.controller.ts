import { Controller, Get, HttpException, Inject, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

import { SearchError } from "./search.errors.js";
import { SearchRateLimiter } from "./search-rate-limiter.js";
import {
  normalizeSearchQuery,
  searchResultTypes,
  SearchService,
  type SearchResultType,
} from "./search.service.js";

const searchQuerySchema = z
  .object({
    q: z.string().max(160),
    types: z.string().max(100).optional(),
    cursor: z.string().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(24).optional(),
  })
  .strict();

const suggestionsQuerySchema = z
  .object({
    q: z.string().max(160),
    limit: z.coerce.number().int().min(1).max(10).optional(),
  })
  .strict();

const searchRequestsPerMinute = 60;
const suggestionRequestsPerMinute = 120;

@Controller("public/search")
export class SearchController {
  constructor(
    @Inject(SearchService) private readonly searchService: SearchService,
    @Inject(SearchRateLimiter) private readonly rateLimiter: SearchRateLimiter,
  ) {}

  @Get()
  async search(@Req() request: FastifyRequest, @Query() query: unknown) {
    const parsed = searchQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw searchHttpError(
        new SearchError("INVALID_SEARCH_QUERY", "The search request is invalid."),
      );
    }
    this.rateLimiter.consume("search", request.ip, searchRequestsPerMinute);
    return runSearch(() =>
      this.searchService.search({
        query: parsed.data.q,
        ...(parsed.data.types ? { types: parseTypes(parsed.data.types) } : {}),
        ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
        ...(parsed.data.limit ? { limit: parsed.data.limit } : {}),
      }),
    );
  }

  @Get("suggestions")
  async suggestions(@Req() request: FastifyRequest, @Query() query: unknown) {
    const parsed = suggestionsQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw searchHttpError(
        new SearchError("INVALID_SEARCH_QUERY", "The search request is invalid."),
      );
    }
    this.rateLimiter.consume("suggestions", request.ip, suggestionRequestsPerMinute);
    const normalizedQuery = normalizeSearchQuery(parsed.data.q);
    const suggestions = await runSearch(() =>
      this.searchService.suggestions(parsed.data.q, parsed.data.limit),
    );
    return { query: normalizedQuery, suggestions };
  }
}

function parseTypes(raw: string): SearchResultType[] {
  const values = [
    ...new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  if (
    values.length === 0 ||
    values.some((value) => !searchResultTypes.includes(value as SearchResultType))
  ) {
    throw searchHttpError(
      new SearchError("INVALID_SEARCH_TYPES", "The selected search types are invalid."),
    );
  }
  return values as SearchResultType[];
}

async function runSearch<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw searchHttpError(error);
  }
}

function searchHttpError(error: unknown): Error {
  if (error instanceof SearchError) {
    return new HttpException(
      { error: { code: error.code, message: error.message } },
      error.statusCode,
    );
  }
  return error instanceof Error ? error : new Error("Unexpected search error.");
}
