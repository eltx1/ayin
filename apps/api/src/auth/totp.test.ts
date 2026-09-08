import { describe, expect, it } from "vitest";

import {
  buildTotpProvisioningUri,
  decodeBase32,
  encodeBase32,
  generateTotpCode,
  verifyTotpCode,
} from "./totp.js";

describe("TOTP", () => {
  it("matches RFC 6238 SHA-1 vectors", () => {
    const secret = encodeBase32(Buffer.from("12345678901234567890", "ascii"));
    expect(generateTotpCode(secret, 1n, 8)).toBe("94287082");
    expect(generateTotpCode(secret, 37_037_036n, 8)).toBe("07081804");
  });

  it("accepts only a bounded adjacent time window", () => {
    const secret = encodeBase32(Buffer.from("a standards-compatible secret"));
    const now = 1_700_000_000_000;
    const currentCounter = BigInt(Math.floor(now / 30_000));
    expect(verifyTotpCode(secret, generateTotpCode(secret, currentCounter), now)).toBe(
      currentCounter,
    );
    expect(verifyTotpCode(secret, generateTotpCode(secret, currentCounter - 1n), now)).toBe(
      currentCounter - 1n,
    );
    expect(verifyTotpCode(secret, generateTotpCode(secret, currentCounter - 2n), now)).toBeNull();
    expect(verifyTotpCode(secret, "not-a-code", now)).toBeNull();
  });

  it("round-trips Base32 and emits a provider-neutral provisioning URI", () => {
    const raw = Buffer.from("AYIN MFA");
    const encoded = encodeBase32(raw);
    expect(decodeBase32(encoded)).toEqual(raw);
    expect(() => decodeBase32("@not-base32")).toThrow("Invalid base32 value");
    const uri = new URL(buildTotpProvisioningUri("admin+ops@example.com", encoded));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.hostname).toBe("totp");
    expect(uri.pathname).toContain("AYIN%3Aadmin%2Bops%40example.com");
    expect(uri.searchParams.get("secret")).toBe(encoded);
    expect(uri.searchParams.get("issuer")).toBe("AYIN");
    expect(uri.searchParams.get("algorithm")).toBe("SHA1");
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(uri.searchParams.get("period")).toBe("30");
  });
});
