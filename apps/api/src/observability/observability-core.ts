import { HttpException } from "@nestjs/common";

const SENSITIVE_KEY = /(pass(word|phrase)?|authorization|cookie|token|session|stream.?key|api.?key|secret|client.?secret|private.?key|bank|card|iban|routing|kyc|payout|financial|account.?number)/i;
const SECRET_ASSIGNMENT = /\b(password|passphrase|authorization|token|session(?:token)?|reset(?:token)?|stream[_-]?key|api[_-]?key|secret|client[_-]?secret|private[_-]?key|bank(?:account)?|card(?:number)?|iban|routing(?:number)?|kyc|payout|financial|account[_-]?number)\b\s*[:=]\s*([^\s,;]+)/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
const PAYMENT_CARD = /\b(?:\d[ -]*?){13,19}\b/g;

export type ErrorClass =
  | "validation"
  | "authentication"
  | "authorization"
  | "not_found"
  | "conflict"
  | "rate_limit"
  | "configuration"
  | "database"
  | "storage"
  | "media"
  | "advertising"
  | "dependency"
  | "internal";

export function redactText(value: string): string {
  return value
    .replace(BEARER, "Bearer [REDACTED]")
    .replace(JWT, "[REDACTED_JWT]")
    .replace(SECRET_ASSIGNMENT, (_match, key: string) => `${key}=[REDACTED]`)
    .replace(IBAN, "[REDACTED_IBAN]")
    .replace(PAYMENT_CARD, "[REDACTED_PAYMENT_NUMBER]")
    .slice(0, 4000);
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[TRUNCATED]";
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (value instanceof Error) return { name: value.name };
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => redactValue(item, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactValue(item, depth + 1);
    }
    return output;
  }
  return String(value);
}

export function classifyError(error: unknown, path = "", statusCode?: number): ErrorClass {
  const status = statusCode ?? (error instanceof HttpException ? error.getStatus() : undefined);
  const lowerPath = path.toLowerCase();
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (status === 400 || status === 422) return "validation";
  if (status === 401) return "authentication";
  if (status === 403) return "authorization";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limit";
  if (lowerPath.includes("/ads") || message.includes("ima") || message.includes("advert")) return "advertising";
  if (lowerPath.includes("/media") || lowerPath.includes("/upload") || message.includes("ffmpeg")) return "media";
  if (message.includes("prisma") || message.includes("database") || message.includes("postgres")) return "database";
  if (message.includes("r2") || message.includes("storage") || message.includes("object")) return "storage";
  if (message.includes("config") || message.includes("environment") || message.includes("required")) return "configuration";
  if (status && status >= 500) return "dependency";
  return "internal";
}

export function statusClass(statusCode: number): "1xx" | "2xx" | "3xx" | "4xx" | "5xx" {
  const bucket = Math.max(1, Math.min(5, Math.floor(statusCode / 100)));
  return `${bucket}xx` as "1xx" | "2xx" | "3xx" | "4xx" | "5xx";
}
