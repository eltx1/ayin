import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommentRateLimiter } from "../comments/comment-rate-limiter.js";
import { SearchRateLimiter } from "../search/search-rate-limiter.js";
import { TrustRateLimiter } from "../trust/trust-rate-limiter.js";

interface Limiter {
  consume(key: string, limit?: number): void;
  onModuleDestroy?(): void;
}

const policies = [
  {
    name: "comments",
    create: () => new CommentRateLimiter(),
    limit: 30,
    testLimit: 1_000,
    windowMs: 60_000,
    error: {
      code: "COMMENT_RATE_LIMITED",
      message: "Too many comment actions. Try again shortly.",
      statusCode: 429,
    },
  },
  {
    name: "search",
    create: () => new SearchRateLimiter(),
    limit: 60,
    testLimit: 500,
    windowMs: 60_000,
    error: {
      code: "SEARCH_RATE_LIMITED",
      message: "Too many searches. Please wait a moment and try again.",
      statusCode: 429,
    },
  },
  {
    name: "trust",
    create: () => new TrustRateLimiter(),
    limit: 10,
    testLimit: 1_000,
    windowMs: 5 * 60_000,
    error: {
      response: {
        error: {
          code: "TRUST_INTAKE_RATE_LIMITED",
          message: "Too many reports or requests. Try again shortly.",
        },
      },
      status: 429,
    },
  },
];

// Observe retained state without adding diagnostic methods to production APIs.
function retainedKeys(limiter: Limiter) {
  return (limiter as unknown as { counters: { readonly size: number } }).counters.size;
}

for (const policy of policies)
  describe(`${policy.name} real rate limiter`, () => {
    let limiter: Limiter;
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
      vi.stubEnv("APP_ENV", "production");
      limiter = policy.create();
    });
    afterEach(() => {
      limiter.onModuleDestroy?.();
      vi.restoreAllMocks();
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.unstubAllEnvs();
    });

    function expectLimited(key: string) {
      expect(() => limiter.consume(key)).toThrowError(expect.objectContaining(policy.error));
    }

    it("preserves the production allowance, HTTP error, key isolation and exact window", () => {
      for (let index = 0; index < policy.limit; index += 1) limiter.consume("protected");
      expectLimited("protected");
      expect(() => limiter.consume("other")).not.toThrow();
      vi.advanceTimersByTime(policy.windowMs - 1);
      expectLimited("protected");
      vi.advanceTimersByTime(1);
      expect(() => limiter.consume("protected")).not.toThrow();
    });

    it("preserves the separate test-environment allowance", () => {
      vi.stubEnv("APP_ENV", "test");
      for (let index = 0; index < policy.testLimit; index += 1) limiter.consume("test-key");
      expectLimited("test-key");
    });

    it("reclaims expired identities while idle and releases its sweep timer", () => {
      for (let index = 0; index < 1_001; index += 1) limiter.consume(`expired-${index}`);
      expect(retainedKeys(limiter)).toBe(1_001);
      vi.advanceTimersByTime(policy.windowMs + 1_000);
      expect(retainedKeys(limiter)).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("caps fifty thousand identities without evicting a live exhausted key", () => {
      for (let index = 0; index < policy.limit; index += 1) limiter.consume("protected");
      for (let index = 1; index < 50_000; index += 1) limiter.consume(`identity-${index}`);
      expect(retainedKeys(limiter)).toBe(50_000);
      for (let index = 0; index < 3; index += 1) expectLimited(`overflow-${index}`);
      expectLimited("protected");
      expect(retainedKeys(limiter)).toBe(50_000);
      // Full capacity must still allow an admitted, non-exhausted identity.
      expect(() => limiter.consume("identity-1")).not.toThrow();
      vi.advanceTimersByTime(policy.windowMs);
      expect(() => limiter.consume("new-identity")).not.toThrow();
    });

    it("unrefs its timer and clears all state on Nest module shutdown", () => {
      const schedule = vi.spyOn(globalThis, "setInterval");
      expect(vi.getTimerCount()).toBe(0);
      limiter.consume("active");
      expect(vi.getTimerCount()).toBe(1);
      expect(schedule.mock.results[0]?.value.hasRef()).toBe(false);
      expect(limiter.onModuleDestroy).toBeTypeOf("function");
      limiter.onModuleDestroy?.();
      expect(retainedKeys(limiter)).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      limiter.onModuleDestroy?.();
      expect(vi.getTimerCount()).toBe(0);
    });

    if (policy.name !== "search")
      it("preserves explicit action-specific limits", () => {
        limiter.consume("action", 2);
        limiter.consume("action", 2);
        expect(() => limiter.consume("action", 2)).toThrowError(
          expect.objectContaining(policy.error),
        );
      });
  });
