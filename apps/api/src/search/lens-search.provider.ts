import { Injectable } from "@nestjs/common";

import type { SearchResult } from "./search.service.js";

export const AYIN_LENS_SEARCH_PROVIDER = Symbol("AYIN_LENS_SEARCH_PROVIDER");

export interface AyinLensSearchProvider {
  isConfigured(): boolean;
  search(query: string, limit: number): Promise<SearchResult[]>;
}

@Injectable()
export class UnconfiguredAyinLensSearchProvider implements AyinLensSearchProvider {
  isConfigured() {
    return false;
  }

  async search(_query: string, _limit: number): Promise<SearchResult[]> {
    return [];
  }
}
