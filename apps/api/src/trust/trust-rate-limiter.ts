import { HttpException, Injectable } from "@nestjs/common";

interface Counter {
  count: number;
  resetAt: number;
}

@Injectable()
export class TrustRateLimiter {
  private readonly counters = new Map<string, Counter>();

  consume(key: string, limit = process.env.APP_ENV === "test" ? 1_000 : 10): void {
    const now = Date.now();
    const current = this.counters.get(key);
    if (!current || current.resetAt <= now) {
      this.counters.set(key, { count: 1, resetAt: now + 5 * 60_000 });
      return;
    }
    if (current.count >= limit) {
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
    current.count += 1;
  }
}
