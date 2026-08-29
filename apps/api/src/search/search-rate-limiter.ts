import { Injectable } from "@nestjs/common";

import { SearchError } from "./search.errors.js";

interface Counter {
  count: number;
  resetAt: number;
}

@Injectable()
export class SearchRateLimiter {
  private readonly counters = new Map<string, Counter>();

  consume(scope: "search" | "suggestions", key: string, limit: number, now = Date.now()): void {
    const windowMs = 60_000;
    const mapKey = `${scope}:${key}`;
    const existing = this.counters.get(mapKey);

    if (!existing || existing.resetAt <= now) {
      this.counters.set(mapKey, { count: 1, resetAt: now + windowMs });
      this.compact(now);
      return;
    }

    if (existing.count >= limit) {
      throw new SearchError(
        "SEARCH_RATE_LIMITED",
        "Too many search requests. Please try again shortly.",
        429,
      );
    }

    existing.count += 1;
  }

  private compact(now: number): void {
    if (this.counters.size < 2_000) return;
    for (const [key, counter] of this.counters) {
      if (counter.resetAt <= now) this.counters.delete(key);
    }
  }
}
