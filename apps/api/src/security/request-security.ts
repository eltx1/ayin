import type { FastifyReply, FastifyRequest } from "fastify";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const sessionCookiePrefix = "ayin_session=";

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

export function applyApiSecurityHeaders(reply: FastifyReply): void {
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("referrer-policy", "strict-origin-when-cross-origin");
  reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
  reply.header("cross-origin-resource-policy", "same-site");
  reply.header("cache-control", "no-store");
}
