import { expect, type APIRequestContext } from "@playwright/test";

import { generateTotpCode, totpCounter } from "../../apps/api/src/auth/totp.js";

export async function enrollMfa(api: APIRequestContext) {
  const start = await api.post("/auth/mfa/enrollment/start-authenticated", {
    data: { password: "strong-pass-123" },
  });
  expect(start.ok()).toBeTruthy();
  const enrollment = (await start.json()) as { enrollmentToken: string; secret: string };
  const verify = await api.post("/auth/mfa/enrollment/verify", {
    data: {
      enrollmentToken: enrollment.enrollmentToken,
      code: generateTotpCode(enrollment.secret, totpCounter()),
    },
  });
  expect(verify.ok()).toBeTruthy();
  return {
    recoveryCodes: ((await verify.json()) as { recoveryCodes: string[] }).recoveryCodes,
    secret: enrollment.secret,
  };
}
