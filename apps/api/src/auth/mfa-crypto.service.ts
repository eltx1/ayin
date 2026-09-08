import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { AuthConfig } from "./auth.config.js";

@Injectable()
export class MfaCryptoService {
  private readonly key: Buffer;

  constructor(@Inject(AuthConfig) config: AuthConfig) {
    this.key = createHash("sha256")
      .update("ayin:mfa-secret-encryption:v1\0", "utf8")
      .update(config.tokenSecret, "utf8")
      .digest();
  }

  encrypt(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${tag.toString("base64url")}`;
  }

  decrypt(encrypted: string): string {
    const [version, ivValue, ciphertextValue, tagValue] = encrypted.split(".");
    if (version !== "v1" || !ivValue || !ciphertextValue || !tagValue) {
      throw new Error("Invalid MFA secret envelope.");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  hashRecoveryCode(code: string): string {
    return createHmac("sha256", this.key)
      .update("ayin:mfa-recovery:v1\0", "utf8")
      .update(code.replaceAll("-", "").toUpperCase(), "utf8")
      .digest("base64url");
  }

  verifyRecoveryCode(code: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hashRecoveryCode(code), "base64url");
    const expected = Buffer.from(expectedHash, "base64url");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
