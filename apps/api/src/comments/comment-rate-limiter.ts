import { Injectable, type OnModuleDestroy } from "@nestjs/common";

import { BoundedRateCounter } from "../security/bounded-rate-counter.js";
import { CommentsError } from "./comments.errors.js";

@Injectable()
export class CommentRateLimiter implements OnModuleDestroy {
  private readonly counters = new BoundedRateCounter({ windowMs: 60_000 });

  consume(key: string, limit = process.env.APP_ENV === "test" ? 1_000 : 30): void {
    if (!this.counters.consume(key, limit)) {
      throw new CommentsError(
        "COMMENT_RATE_LIMITED",
        "Too many comment actions. Try again shortly.",
        429,
      );
    }
  }

  onModuleDestroy(): void {
    this.counters.destroy();
  }
}
