import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthConfig } from "./auth.config.js";
import { AuthTokenService } from "./auth-token.service.js";

describe("AuthTokenService MFA tokens", () => {
  const accountId = "11111111-1111-4111-8111-111111111111";

  function tokens() {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "mfa-token-test-secret-with-more-than-32-characters";
    return new AuthTokenService(new AuthConfig());
  }

  afterEach(() => vi.useRealTimers());

  it("keeps challenges purpose-bound and rejects tampering", () => {
    const service = tokens();
    const challenge = service.issueMfaChallenge(accountId, 4, 2, "verify");
    expect(service.verifySession(challenge)).toBeNull();
    expect(service.verifyMfaChallenge(challenge)).toMatchObject({
      av: 4,
      intent: "verify",
      mv: 2,
      sub: accountId,
    });
    expect(service.verifyMfaChallenge(`${challenge.slice(0, -1)}x`)).toBeNull();
  });

  it("expires MFA challenges after five minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
    const service = tokens();
    const challenge = service.issueMfaChallenge(accountId, 0, 0, "enroll");
    vi.setSystemTime(new Date("2026-09-08T12:05:01Z"));
    expect(service.verifyMfaChallenge(challenge)).toBeNull();
  });

  it("carries MFA and recent re-authentication assurance only in sessions", () => {
    const service = tokens();
    const session = service.issueSession(accountId, 3, {
      mfaAt: 1_788_868_800,
      mfaVersion: 7,
      reauthAt: 1_788_868_800,
    });
    expect(service.verifySession(session)).toMatchObject({
      av: 3,
      mfaAt: 1_788_868_800,
      mv: 7,
      reauthAt: 1_788_868_800,
    });
  });
});
