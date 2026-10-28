import { describe, expect, it } from "vitest";
import { MfaRequestError } from "./account-mfa";
import { mustRestartMfa, normalizeLoginMfaCode } from "./login-mfa";

describe("login MFA recovery", () => {
  it("restarts completed, replaced and expired requests without treating bad codes as expiry", () => {
    for (const code of ["MFA_REQUEST_INVALID", "MFA_ENROLLMENT_CHANGED", "MFA_ALREADY_ENABLED"])
      expect(mustRestartMfa(new MfaRequestError("Request ended", 401, code))).toBe(true);
    expect(
      mustRestartMfa(
        new MfaRequestError("The MFA request is invalid or expired.", 401, "UNAUTHORIZED"),
      ),
    ).toBe(true);
    for (const cause of [
      new MfaRequestError("The authentication code is invalid.", 401, "UNAUTHORIZED"),
      new MfaRequestError("The recovery code is invalid or was already used.", 401),
      new MfaRequestError("Too many attempts", 429, "RATE_LIMITED"),
      new TypeError("Failed to fetch"),
    ])
      expect(mustRestartMfa(cause)).toBe(false);
  });

  it("accepts copied authenticator digits and Arabic keyboards while preserving recovery codes", () => {
    for (const value of ["123456", "123 456", "١٢٣ ٤٥٦", "۱۲۳۴۵۶", " 123\u00a0456 "])
      expect(normalizeLoginMfaCode(value)).toBe("123456");
    expect(normalizeLoginMfaCode(" ABCD-EFGH-IJKL-MNOP ")).toBe("ABCD-EFGH-IJKL-MNOP");
    expect(normalizeLoginMfaCode("12345")).toBe("12345");
  });
});
