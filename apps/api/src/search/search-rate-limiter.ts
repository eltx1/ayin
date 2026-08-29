import { Injectable } from "@nestjs/common";

import { SearchError } from "./search.service.js";

interface Counter {
  count: number;
  resetAt: number;
}

@Injectable()
export class SearchRateLimiter {
  private readonly counters = new Map<string, Counter>();

  consume(key: string): void {
    const now = Date.now();
    const windowMs = 60_000;
    const limit = process.env.APP_ENV === "test" ? 500 : 60;
    const existing = this.counters.get(key);
    if (!existing || existing.resetAt <= now) {
      this.counters.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    if (existing.count >= limit) {
      throw new SearchError(
        "SEARCH_RATE_LIMITED",
        "Too many searches. Please wait a moment and try again.",
        429,
      );
    }
    existing.count += 1;
  }
}
