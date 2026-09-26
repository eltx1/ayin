import { createHmac } from "node:crypto";

export function analyticsPseudonym(value: string): string {
  const salt =
    process.env.ANALYTICS_HASH_SALT ?? process.env.AUTH_TOKEN_SECRET ?? "ayin-local-analytics-v1";
  return createHmac("sha256", salt).update(value).digest("hex");
}
