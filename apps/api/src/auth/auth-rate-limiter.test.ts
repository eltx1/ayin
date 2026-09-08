import { describe, expect, it } from "vitest";

import type { AuthConfig } from "./auth.config.js";
import { AuthRateLimiter } from "./auth-rate-limiter.js";

describe("AuthRateLimiter MFA policy", () => {
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
});
