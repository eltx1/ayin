import type { FastifyReply, FastifyRequest } from "fastify";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const sessionCookiePrefix = "ayin_session=";
const cacheablePublicPrefixes = ["/public/playlists"];
const contextualPublicPrefixes = [
  "/product-controls",
  "/public/discovery",
  "/public/videos",
  "/public/channels",
  "/public/seo",
];

function withinPrefix(url: string, prefix: string) {
  return url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`);
}

export function usesCookieSession(request: Pick<FastifyRequest, "headers">): boolean {
  // Match readSessionToken: any explicit Authorization header selects that
  // transport; invalid schemes/tokens are rejected, never cookie fallback.
  if (request.headers.authorization !== undefined) return false;
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
  // These public responses vary with trusted territory and regional permission.
  // A URL-only shared cache cannot preserve their rights/availability decision.
  if (contextualPublicPrefixes.some((prefix) => withinPrefix(request.url, prefix)))
    return "private, no-store";
  const cacheable = cacheablePublicPrefixes.some((prefix) => withinPrefix(request.url, prefix));
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
  const cacheControl = request ? cacheControlForRequest(request) : "no-store";
  reply.header("cache-control", cacheControl);
  if (cacheControl === "private, no-store") reply.header("pragma", "no-cache");
}
