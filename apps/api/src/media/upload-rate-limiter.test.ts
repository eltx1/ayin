import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UploadRateLimiter } from "./upload-rate-limiter.js";

describe("UploadRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
    vi.stubEnv("APP_ENV", "production");
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("accepts the production twelve requests and rejects the thirteenth as HTTP 429", () => {
    const limiter = new UploadRateLimiter();
    for (let request = 0; request < 12; request += 1) limiter.consume("account-a");
    expect(() => limiter.consume("account-a")).toThrowError(
      expect.objectContaining({ code: "UPLOAD_RATE_LIMITED", statusCode: 429 }),
    );
  });

  it("isolates accounts and reopens only at the exact minute boundary", () => {
    const limiter = new UploadRateLimiter();
    limiter.consume("account-a", 1);
    expect(() => limiter.consume("account-b", 1)).not.toThrow();
    vi.advanceTimersByTime(59_999);
    expect(() => limiter.consume("account-a", 1)).toThrowError("Too many upload requests");
    vi.advanceTimersByTime(1);
    expect(() => limiter.consume("account-a", 1)).not.toThrow();
  });

  it("bounds retained account keys and prevents rotation from evicting a live limit", () => {
    const limiter = new UploadRateLimiter();
    limiter.consume("limited-account", 1);
    for (let index = 1; index < 50_000; index += 1) limiter.consume(`account-${index}`, 1);
    for (let index = 50_000; index < 50_100; index += 1) {
      expect(() => limiter.consume(`account-${index}`, 1)).toThrowError("Too many upload requests");
    }
    expect(() => limiter.consume("limited-account", 1)).toThrowError("Too many upload requests");
    vi.advanceTimersByTime(60_000);
    expect(() => limiter.consume("new-account", 1)).not.toThrow();
  });
  it("releases timer resources on Nest module shutdown", () => {
    const limiter = new UploadRateLimiter();
    limiter.consume("account-a");
    expect(vi.getTimerCount()).toBe(1);
    limiter.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
