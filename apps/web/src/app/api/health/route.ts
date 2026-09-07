import { NextRequest, NextResponse } from "next/server";

const SAFE_TRACE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function GET(request: NextRequest) {
  const incoming = request.headers.get("x-request-id")?.trim() ?? "";
  const requestId = SAFE_TRACE_ID.test(incoming) ? incoming : crypto.randomUUID();
  const release = process.env.AYIN_RELEASE_SHA?.trim() ?? "unknown";
  const response = NextResponse.json({
    service: "ayin-web",
    status: "alive",
    releaseSha: /^[0-9a-f]{40}$/i.test(release) ? release.toLowerCase() : "unknown",
    requestId,
  });
  response.headers.set("x-request-id", requestId);
  response.headers.set("cache-control", "no-store");
  return response;
}
