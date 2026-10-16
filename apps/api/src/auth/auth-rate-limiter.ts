import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";

import { BoundedRateCounter } from "../security/bounded-rate-counter.js";
import { AuthConfig } from "./auth.config.js";
import { tooManyRequests } from "./auth.errors.js";

@Injectable()
export class AuthRateLimiter implements OnModuleDestroy {
  private readonly counters = new BoundedRateCounter({ windowMs: 5 * 60 * 1_000 });

  constructor(@Inject(AuthConfig) private readonly config: AuthConfig) {}

  consume(scope: string, key: string): void {
    this.consumeWithLimit(scope, key, this.config.appEnvironment === "test" ? 100 : 12);
  }

  consumeMfa(scope: string, key: string): void {
    this.consumeWithLimit(scope, key, this.config.appEnvironment === "test" ? 100 : 5);
  }

  onModuleDestroy(): void {
    this.counters.destroy();
  }

  private consumeWithLimit(scope: string, key: string, limit: number): void {
    if (!this.counters.consume(`${scope}:${key}`, limit)) throw tooManyRequests();
  }
}
