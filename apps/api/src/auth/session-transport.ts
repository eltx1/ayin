import type { FastifyRequest } from "fastify";

import type { AuthConfig } from "./auth.config.js";

export const sessionCookieName = "ayin_session";

export function readSessionToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (authorization !== undefined) {
    // Explicit authorization owns transport selection. A malformed/empty
    // bearer or unsupported scheme must never fall back to a cookie identity.
    const match = /^Bearer[ \t]+(.+)$/i.exec(authorization);
    return match?.[1]?.trim() || null;
  }

  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  for (const pair of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = pair.trim().split("=");
    if (rawName === sessionCookieName) {
      const value = rawValue.join("=");
      try {
        return value ? decodeURIComponent(value) : null;
      } catch {
        return null;
      }
    }
  }

  return null;
}

export function buildSessionCookie(token: string, config: AuthConfig): string {
  const attributes = [
    `${sessionCookieName}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    `Max-Age=${config.sessionTtlSeconds}`,
    "SameSite=Lax",
  ];
  if (config.secureCookies) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function buildClearedSessionCookie(config: AuthConfig): string {
  const attributes = [
    `${sessionCookieName}=`,
    "HttpOnly",
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "SameSite=Lax",
  ];
  if (config.secureCookies) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function wantsBearerToken(request: FastifyRequest): boolean {
  return request.headers["x-ayin-auth-transport"] === "bearer";
}
