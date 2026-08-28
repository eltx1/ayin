import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { AuthConfig } from "./auth.config.js";

const tokenPayloadSchema = z.object({
  av: z.number().int().min(0),
  exp: z.number().int().positive(),
  iat: z.number().int().positive(),
  nonce: z.string().min(16).max(64),
  purpose: z.enum(["session", "password-reset"]),
  sub: z.uuid(),
  v: z.literal(1),
});

export type AuthTokenPayload = z.infer<typeof tokenPayloadSchema>;

@Injectable()
export class AuthTokenService {
  constructor(private readonly config: AuthConfig) {}

  issueSession(accountId: string, authVersion: number): string {
    return this.issue("session", accountId, authVersion, this.config.sessionTtlSeconds);
  }

  issuePasswordReset(accountId: string, authVersion: number): string {
    return this.issue(
      "password-reset",
      accountId,
      authVersion,
      this.config.passwordResetTtlSeconds,
    );
  }

  verifySession(token: string): AuthTokenPayload | null {
    return this.verify(token, "session");
  }

  verifyPasswordReset(token: string): AuthTokenPayload | null {
    return this.verify(token, "password-reset");
  }

  private issue(
    purpose: AuthTokenPayload["purpose"],
    accountId: string,
    authVersion: number,
    ttlSeconds: number,
  ): string {
    const issuedAt = Math.floor(Date.now() / 1_000);
    const payload: AuthTokenPayload = {
      av: authVersion,
      exp: issuedAt + ttlSeconds,
      iat: issuedAt,
      nonce: randomBytes(18).toString("base64url"),
      purpose,
      sub: accountId,
      v: 1,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = this.sign(encodedPayload);
    return `v1.${encodedPayload}.${signature}`;
  }

  private verify(token: string, expectedPurpose: AuthTokenPayload["purpose"]): AuthTokenPayload | null {
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "v1") {
      return null;
    }

    const encodedPayload = parts[1];
    const suppliedSignature = parts[2];
    if (!encodedPayload || !suppliedSignature) {
      return null;
    }

    const expectedSignature = this.sign(encodedPayload);
    const suppliedBuffer = Buffer.from(suppliedSignature, "base64url");
    const expectedBuffer = Buffer.from(expectedSignature, "base64url");
    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
      const payload = tokenPayloadSchema.parse(parsed);
      const now = Math.floor(Date.now() / 1_000);
      if (payload.purpose !== expectedPurpose || payload.exp <= now || payload.iat > now + 60) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  private sign(encodedPayload: string): string {
    return createHmac("sha256", this.config.tokenSecret).update(encodedPayload).digest("base64url");
  }
}
