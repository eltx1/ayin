import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(value: Buffer): string {
  let bits = 0;
  let accumulator = 0;
  let output = "";
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(accumulator >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(accumulator << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(value: string): Buffer {
  const normalized = value.toUpperCase().replaceAll(/[-\s=]/g, "");
  if (!normalized || /[^A-Z2-7]/.test(normalized)) {
    throw new Error("Invalid base32 value.");
  }
  let bits = 0;
  let accumulator = 0;
  const output: number[] = [];
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 value.");
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function totpCounter(atMs = Date.now(), periodSeconds = 30): bigint {
  return BigInt(Math.floor(atMs / (periodSeconds * 1_000)));
}

export function generateTotpCode(secret: string, counter: bigint, digits = 6): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function verifyTotpCode(
  secret: string,
  suppliedCode: string,
  atMs = Date.now(),
  window = 1,
): bigint | null {
  if (!/^\d{6}$/.test(suppliedCode)) return null;
  const current = totpCounter(atMs);
  for (let offset = -window; offset <= window; offset += 1) {
    const counter = current + BigInt(offset);
    if (counter < 0n) continue;
    const expected = Buffer.from(generateTotpCode(secret, counter));
    const supplied = Buffer.from(suppliedCode);
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) return counter;
  }
  return null;
}

export function buildTotpProvisioningUri(email: string, secret: string): string {
  const issuer = "AYIN";
  const label = `${issuer}:${email}`;
  const url = new URL(`otpauth://totp/${encodeURIComponent(label)}`);
  url.searchParams.set("secret", secret);
  url.searchParams.set("issuer", issuer);
  url.searchParams.set("algorithm", "SHA1");
  url.searchParams.set("digits", "6");
  url.searchParams.set("period", "30");
  return url.toString();
}
