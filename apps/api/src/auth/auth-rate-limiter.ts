import { Inject, Injectable } from "@nestjs/common";

import { AuthConfig } from "./auth.config.js";
import { tooManyRequests } from "./auth.errors.js";

interface Counter {
  count: number;
  resetAt: number;
}

@Injectable()
export class AuthRateLimiter {
  private readonly counters = new Map<string, Counter>();

  constructor(@Inject(AuthConfig) private readonly config: AuthConfig) {}

  consume(scope: string, key: string): void {
    this.consumeWithLimit(scope, key, this.config.appEnvironment === "test" ? 100 : 12);
  }

  consumeMfa(scope: string, key: string): void {
    this.consumeWithLimit(scope, key, this.config.appEnvironment === "test" ? 100 : 5);
  }

  private consumeWithLimit(scope: string, key: string, limit: number): void {
    const now = Date.now();
    const windowMs = 5 * 60 * 1_000;
    const mapKey = `${scope}:${key}`;
    const existing = this.counters.get(mapKey);

    if (!existing || existing.resetAt <= now) {
      this.counters.set(mapKey, { count: 1, resetAt: now + windowMs });
      return;
    }

    if (existing.count >= limit) {
      throw tooManyRequests();
    }

    existing.count += 1;
  }
}
