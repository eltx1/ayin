import { describe, expect, it } from "vitest";

import { UploadRateLimiter } from "./upload-rate-limiter.js";

describe("UploadRateLimiter", () => {
  it("rejects requests after the configured per-window limit", () => {
    const limiter = new UploadRateLimiter();
    limiter.consume("account-a", 2);
    limiter.consume("account-a", 2);

    expect(() => limiter.consume("account-a", 2)).toThrowError("Too many upload requests");
  });

  it("isolates counters by account key", () => {
    const limiter = new UploadRateLimiter();
    limiter.consume("account-a", 1);

    expect(() => limiter.consume("account-b", 1)).not.toThrow();
  });
});
