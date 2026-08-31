import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

function encryptionKey(): Buffer {
  const encoded = process.env.PAYOUT_DATA_ENCRYPTION_KEY?.trim();
  if (!encoded) {
    throw new Error("PAYOUT_DATA_ENCRYPTION_KEY_NOT_CONFIGURED");
  }

  let key: Buffer;
  try {
    key = Buffer.from(encoded, "base64");
  } catch {
    throw new Error("PAYOUT_DATA_ENCRYPTION_KEY_INVALID");
  }
  if (key.length !== 32) {
    throw new Error("PAYOUT_DATA_ENCRYPTION_KEY_INVALID");
  }
  return key;
}

export function encryptPayoutDestination(value: string): string {
  const plaintext = value.trim();
  if (!plaintext) throw new Error("PAYOUT_DESTINATION_REQUIRED");

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptPayoutDestination(payload: string): string {
  const [version, ivRaw, tagRaw, ciphertextRaw] = payload.split(".");
  if (version !== VERSION || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error("PAYOUT_DESTINATION_PAYLOAD_INVALID");
  }
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskPayoutDestination(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return "Not configured";
  if (normalized.includes("@")) {
    const [local = "", domain = ""] = normalized.split("@", 2);
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
  }
  const compact = normalized.replace(/\s+/g, "");
  const suffix = compact.slice(-4);
  return suffix ? `•••• ${suffix}` : "Configured";
}
