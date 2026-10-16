import { HttpException, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { BoundedRateCounter } from "../security/bounded-rate-counter.js";

@Injectable()
export class TrustRateLimiter implements OnModuleDestroy {
  private readonly counters = new BoundedRateCounter({ windowMs: 5 * 60_000 });

  consume(key: string, limit = process.env.APP_ENV === "test" ? 1_000 : 10): void {
    if (!this.counters.consume(key, limit)) {
      throw new HttpException(
        {
          error: {
            code: "TRUST_INTAKE_RATE_LIMITED",
            message: "Too many reports or requests. Try again shortly.",
          },
        },
        429,
      );
    }
  }

  onModuleDestroy(): void {
    this.counters.destroy();
  }
}
