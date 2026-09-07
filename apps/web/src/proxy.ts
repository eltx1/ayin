import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const SAFE_TRACE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

function safeTraceId(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return SAFE_TRACE_ID.test(trimmed) ? trimmed : null;
}

function releaseSha(): string {
  const candidate = process.env.AYIN_RELEASE_SHA?.trim();
  return candidate && /^[0-9a-f]{40}$/i.test(candidate) ? candidate.toLowerCase() : "unknown";
}

export function proxy(request: NextRequest) {
  const requestId = safeTraceId(request.headers.get("x-request-id")) ?? crypto.randomUUID();
  const correlationId = safeTraceId(request.headers.get("x-correlation-id")) ?? requestId;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-correlation-id", correlationId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  response.headers.set("x-correlation-id", correlationId);
  response.headers.set("x-ayin-release", releaseSha());
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
