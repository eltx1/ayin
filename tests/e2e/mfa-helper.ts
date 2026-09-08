import { expect, type APIRequestContext } from "@playwright/test";

import { generateTotpCode, totpCounter } from "../../apps/api/src/auth/totp.js";

const API = "http://127.0.0.1:3001";
const WEB = "http://127.0.0.1:3000";

export async function enrollMfa(api: APIRequestContext) {
  const start = await api.post(`${API}/auth/mfa/enrollment/start-authenticated`, {
    data: { password: "strong-pass-123" },
    headers: { origin: WEB },
  });
  expect(start.ok()).toBeTruthy();
  const enrollment = (await start.json()) as { enrollmentToken: string; secret: string };
  const verify = await api.post(`${API}/auth/mfa/enrollment/verify`, {
    data: {
      enrollmentToken: enrollment.enrollmentToken,
      code: generateTotpCode(enrollment.secret, totpCounter()),
    },
    headers: { origin: WEB },
  });
  expect(verify.ok()).toBeTruthy();
  return {
    recoveryCodes: ((await verify.json()) as { recoveryCodes: string[] }).recoveryCodes,
    secret: enrollment.secret,
  };
}
