import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthConfig } from "./auth.config.js";
import { AuthRateLimiter } from "./auth-rate-limiter.js";

describe("AuthRateLimiter MFA policy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  it("blocks the sixth production challenge attempt in five minutes", () => {
    const limiter = new AuthRateLimiter({
      appEnvironment: "production",
    } as AuthConfig);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(() => limiter.consumeMfa("challenge", "account")).not.toThrow();
    }
    try {
      limiter.consumeMfa("challenge", "account");
      throw new Error("Expected the MFA rate limiter to reject the attempt.");
    } catch (error) {
      expect(error).toMatchObject({
        response: { error: { code: "RATE_LIMITED" } },
        status: 429,
      });
    }
  });

  it("keeps accounts and challenge scopes isolated", () => {
    const limiter = new AuthRateLimiter({
      appEnvironment: "production",
    } as AuthConfig);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.consumeMfa("challenge", "account-a");
    }
    expect(() => limiter.consumeMfa("challenge", "account-b")).not.toThrow();
    expect(() => limiter.consumeMfa("enrollment", "account-a")).not.toThrow();
  });

  it("bounds production authentication keys without evicting active protection", () => {
    const limiter = new AuthRateLimiter({ appEnvironment: "production" } as AuthConfig);
    for (let attempt = 0; attempt < 12; attempt += 1) limiter.consume("login", "protected");
    for (let key = 0; key < 49_999; key += 1) limiter.consume("login", `ip-${key}`);
    expect(() => limiter.consume("login", "overflow")).toThrow();
    expect(() => limiter.consume("login", "protected")).toThrow();
    vi.advanceTimersByTime(300_000);
    expect(() => limiter.consume("login", "overflow")).not.toThrow();
    expect(() => limiter.consume("login", "protected")).not.toThrow();
  });

  it("resets the production MFA quota exactly at the five-minute boundary", () => {
    const limiter = new AuthRateLimiter({ appEnvironment: "production" } as AuthConfig);
    for (let attempt = 0; attempt < 5; attempt += 1) limiter.consumeMfa("challenge", "account");
    vi.advanceTimersByTime(299_999);
    expect(() => limiter.consumeMfa("challenge", "account")).toThrow();
    vi.advanceTimersByTime(1);
    expect(() => limiter.consumeMfa("challenge", "account")).not.toThrow();
  });

  it("releases cleanup resources when the Nest module shuts down", () => {
    const limiter = new AuthRateLimiter({ appEnvironment: "production" } as AuthConfig);
    limiter.consume("login", "account");
    expect(vi.getTimerCount()).toBe(1);
    limiter.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
