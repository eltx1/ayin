import { describe, expect, it } from "vitest";

import { recoveryErrorKey } from "./auth-recovery";
import { authRecoveryAr, authRecoveryEn } from "./i18n/resources/auth-recovery";
import { localizeInternalHref } from "./i18n/routing";
import { hasTranslation, translate } from "./i18n/translator";

describe("password recovery presentation", () => {
  it("maps known failures without exposing provider or account-specific server messages", () => {
    expect(recoveryErrorKey(400, "forgot")).toBe("authRecovery.emailInvalid");
    expect(recoveryErrorKey(400, "reset")).toBe("authRecovery.resetInvalid");
    expect(recoveryErrorKey(401, "reset")).toBe("authRecovery.expiredLink");
    for (const mode of ["forgot", "reset"] as const) {
      expect(recoveryErrorKey(429, mode)).toBe("authRecovery.rateLimited");
      for (const status of [403, 404, 422, 500, 502, 503]) {
        expect(recoveryErrorKey(status, mode)).toBe("authRecovery.failed");
      }
    }
    expect(recoveryErrorKey(401, "forgot")).toBe("authRecovery.failed");
  });

  it("provides complete English and Arabic recovery copy through the shared translator", () => {
    for (const key of Object.keys(authRecoveryEn) as (keyof typeof authRecoveryEn)[]) {
      expect(hasTranslation("en", key)).toBe(true);
      expect(hasTranslation("ar", key)).toBe(true);
      expect(translate("en", key)).toBe(authRecoveryEn[key]);
      expect(translate("ar", key)).toBe(authRecoveryAr[key]);
      expect(translate("ar", key)).toMatch(/[\u0600-\u06ff]/);
    }
  });

  it("keeps canonical recovery routes and opaque query values through localization", () => {
    const path = "/reset-password?token=synthetic%2Bopaque%2Fvalue%3D";
    expect(localizeInternalHref(path, "ar")).toBe(`/ar${path}`);
    expect(localizeInternalHref(`/ar${path}`, "en")).toBe(path);
    for (const target of ["/", "/login", "/forgot-password"]) {
      expect(localizeInternalHref(target, "en")).toBe(target);
      expect(localizeInternalHref(target, "ar")).toBe(target === "/" ? "/ar" : `/ar${target}`);
    }
  });
});
