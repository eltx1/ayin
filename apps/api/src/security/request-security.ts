import type { FastifyReply, FastifyRequest } from "fastify";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const sessionCookiePrefix = "ayin_session=";
const cacheablePublicPrefixes = [
  "/public/discovery",
  "/public/channels",
  "/public/videos",
  "/public/playlists",
];

export function usesCookieSession(request: Pick<FastifyRequest, "headers">): boolean {
  if (request.headers.authorization?.startsWith("Bearer ")) return false;
  return (request.headers.cookie ?? "")
    .split(";")
    .some((part) => part.trim().startsWith(sessionCookiePrefix));
}

export function isUnsafeMethod(method: string): boolean {
  return unsafeMethods.has(method.toUpperCase());
}

export function isAllowedCookieMutationOrigin(
  request: Pick<FastifyRequest, "method" | "headers">,
  webOrigin: string,
): boolean {
  if (!isUnsafeMethod(request.method) || !usesCookieSession(request)) return true;
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(webOrigin).origin;
  } catch {
    return false;
  }
}

export function cacheControlForRequest(request: Pick<FastifyRequest, "method" | "url">): string {
  const cacheable = cacheablePublicPrefixes.some(
    (prefix) =>
      request.url === prefix ||
      request.url.startsWith(`${prefix}/`) ||
      request.url.startsWith(`${prefix}?`),
  );
  if (request.method.toUpperCase() === "GET" && cacheable) {
    return "public, max-age=30, s-maxage=60, stale-while-revalidate=120";
  }
  return "no-store";
}

export function applyApiSecurityHeaders(
  reply: FastifyReply,
  request?: Pick<FastifyRequest, "method" | "url">,
): void {
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("referrer-policy", "strict-origin-when-cross-origin");
  reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
  reply.header("cross-origin-resource-policy", "same-site");
  reply.header("cache-control", request ? cacheControlForRequest(request) : "no-store");
}
