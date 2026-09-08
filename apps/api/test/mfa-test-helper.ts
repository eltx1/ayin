import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { generateTotpCode, totpCounter } from "../src/auth/totp.js";

function cookiePair(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!value) throw new Error("Expected an MFA-assured session cookie.");
  return value.split(";", 1)[0] ?? value;
}

export async function enrollTestMfa(
  app: NestFastifyApplication,
  cookie: string,
  password = "strong-pass-123",
): Promise<{ cookie: string; recoveryCodes: string[]; secret: string }> {
  const start = await app.inject({
    method: "POST",
    url: "/auth/mfa/enrollment/start-authenticated",
    headers: { cookie },
    payload: { password },
  });
  if (start.statusCode !== 201) {
    throw new Error(`Unable to start test MFA enrollment: ${start.body}`);
  }
  const enrollment = start.json() as { enrollmentToken: string; secret: string };
  const verify = await app.inject({
    method: "POST",
    url: "/auth/mfa/enrollment/verify",
    payload: {
      enrollmentToken: enrollment.enrollmentToken,
      code: generateTotpCode(enrollment.secret, totpCounter()),
    },
  });
  if (verify.statusCode !== 200) {
    throw new Error(`Unable to verify test MFA enrollment: ${verify.body}`);
  }
  return {
    cookie: cookiePair(verify.headers["set-cookie"]),
    recoveryCodes: verify.json().recoveryCodes as string[],
    secret: enrollment.secret,
  };
}
