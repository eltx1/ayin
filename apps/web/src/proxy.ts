import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  defaultLocale,
  isLocale,
  localeCookieName,
  requestLocaleHeader,
  type Locale,
} from "@/lib/i18n/config";
import {
  localeFromPath,
  localizePath,
  resolveLocale,
  stripLocalePrefix,
} from "@/lib/i18n/routing";

const SAFE_TRACE_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function safeTraceId(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return SAFE_TRACE_ID.test(trimmed) ? trimmed : null;
}

function releaseSha(): string {
  const candidate = process.env.AYIN_RELEASE_SHA?.trim();
  return candidate && /^[0-9a-f]{40}$/i.test(candidate) ? candidate.toLowerCase() : "unknown";
}

function isLocaleBypassedPath(pathname: string): boolean {
  if (pathname.startsWith("/_next/") || pathname.startsWith("/api/")) return true;
  if (pathname === "/api" || pathname === "/robots.txt" || pathname === "/sitemap.xml") return true;
  if (pathname.startsWith("/sitemaps/")) return true;
  const lastSegment = pathname.split("/").at(-1) ?? "";
  return lastSegment.includes(".");
}

function requestHeaders(
  request: NextRequest,
  requestId: string,
  correlationId: string,
  locale?: Locale,
): Headers {
  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);
  headers.set("x-correlation-id", correlationId);
  if (locale) headers.set(requestLocaleHeader, locale);
  return headers;
}

function decorateResponse(
  response: NextResponse,
  requestId: string,
  correlationId: string,
): NextResponse {
  response.headers.set("x-request-id", requestId);
  response.headers.set("x-correlation-id", correlationId);
  response.headers.set("x-ayin-release", releaseSha());
  return response;
}

function persistLocale(response: NextResponse, locale: Locale): NextResponse {
  response.cookies.set(localeCookieName, locale, {
    httpOnly: false,
    maxAge: ONE_YEAR_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

function isDocumentNavigation(request: NextRequest): boolean {
  if (request.method !== "GET") return false;
  if (request.headers.get("rsc") === "1") return false;
  if (request.headers.get("next-router-prefetch") === "1") return false;
  const destination = request.headers.get("sec-fetch-dest");
  return !destination || destination === "document" || destination === "empty";
}

export function proxy(request: NextRequest) {
  const requestId = safeTraceId(request.headers.get("x-request-id")) ?? crypto.randomUUID();
  const correlationId = safeTraceId(request.headers.get("x-correlation-id")) ?? requestId;
  const { pathname } = request.nextUrl;

  if (isLocaleBypassedPath(pathname)) {
    return decorateResponse(
      NextResponse.next({ request: { headers: requestHeaders(request, requestId, correlationId) } }),
      requestId,
      correlationId,
    );
  }

  const requestedLocale = request.nextUrl.searchParams.get("lang");
  if (isLocale(requestedLocale)) {
    const target = request.nextUrl.clone();
    target.pathname = localizePath(stripLocalePrefix(pathname), requestedLocale);
    target.searchParams.delete("lang");
    return decorateResponse(
      persistLocale(NextResponse.redirect(target), requestedLocale),
      requestId,
      correlationId,
    );
  }

  const pathLocale = localeFromPath(pathname);
  if (pathLocale === defaultLocale) {
    const target = request.nextUrl.clone();
    target.pathname = stripLocalePrefix(pathname);
    return decorateResponse(
      persistLocale(NextResponse.redirect(target), defaultLocale),
      requestId,
      correlationId,
    );
  }

  if (pathLocale) {
    const rewrite = request.nextUrl.clone();
    rewrite.pathname = stripLocalePrefix(pathname);
    const response = NextResponse.rewrite(rewrite, {
      request: { headers: requestHeaders(request, requestId, correlationId, pathLocale) },
    });
    return decorateResponse(persistLocale(response, pathLocale), requestId, correlationId);
  }

  const locale = resolveLocale({
    pathname,
    cookieLocale: request.cookies.get(localeCookieName)?.value,
    acceptLanguage: request.headers.get("accept-language"),
  });

  if (locale !== defaultLocale && isDocumentNavigation(request)) {
    const target = request.nextUrl.clone();
    target.pathname = localizePath(pathname, locale);
    return decorateResponse(
      persistLocale(NextResponse.redirect(target), locale),
      requestId,
      correlationId,
    );
  }

  return decorateResponse(
    NextResponse.next({
      request: { headers: requestHeaders(request, requestId, correlationId, locale) },
    }),
    requestId,
    correlationId,
  );
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
