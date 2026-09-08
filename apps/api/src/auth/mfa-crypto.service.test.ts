import { describe, expect, it } from "vitest";

import { AuthConfig } from "./auth.config.js";
import { MfaCryptoService } from "./mfa-crypto.service.js";

describe("MfaCryptoService", () => {
  function service() {
    process.env.APP_ENV = "test";
    process.env.AUTH_TOKEN_SECRET = "mfa-crypto-test-secret-with-more-than-32-characters";
    return new MfaCryptoService(new AuthConfig());
  }

  it("encrypts TOTP secrets with authenticated encryption", () => {
    const crypto = service();
    const secret = "JBSWY3DPEHPK3PXP";
    const encrypted = crypto.encrypt(secret);
    expect(encrypted).not.toContain(secret);
    expect(crypto.decrypt(encrypted)).toBe(secret);

    const parts = encrypted.split(".");
    const tag = Buffer.from(parts[3]!, "base64url");
    tag[0] = tag[0]! ^ 1;
    parts[3] = tag.toString("base64url");
    expect(() => crypto.decrypt(parts.join("."))).toThrow();
  });

  it("stores deterministic keyed recovery-code hashes and compares safely", () => {
    const crypto = service();
    const code = "ABCD-EFGH-IJKL-MNOP";
    const hash = crypto.hashRecoveryCode(code);
    expect(hash).not.toContain("ABCD");
    expect(crypto.verifyRecoveryCode("abcd-efgh-ijkl-mnop", hash)).toBe(true);
    expect(crypto.verifyRecoveryCode("ABCD-EFGH-IJKL-ZZZZ", hash)).toBe(false);
  });
});
