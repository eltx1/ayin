import { Injectable, type OnModuleDestroy } from "@nestjs/common";

import { BoundedRateCounter } from "../security/bounded-rate-counter.js";
import { SearchError } from "./search.service.js";

@Injectable()
export class SearchRateLimiter implements OnModuleDestroy {
  private readonly counters = new BoundedRateCounter({ windowMs: 60_000 });

  consume(key: string): void {
    const limit = process.env.APP_ENV === "test" ? 500 : 60;
    if (!this.counters.consume(key, limit)) {
      throw new SearchError(
        "SEARCH_RATE_LIMITED",
        "Too many searches. Please wait a moment and try again.",
        429,
      );
    }
  }

  onModuleDestroy(): void {
    this.counters.destroy();
  }
}
