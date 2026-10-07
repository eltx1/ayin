import { NextRequest, NextResponse } from "next/server";

import { isClipCursor } from "@/lib/clips";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cursor = request.nextUrl.searchParams.get("cursor");
  if (cursor !== null && !isClipCursor(cursor)) {
    return NextResponse.json(
      { error: { code: "INVALID_CLIPS_CURSOR", message: "This Clips page is invalid." } },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }
  // The browser must read the API with its own scoped credentials. Forwarding
  // an anonymous server fetch here can expose adult sources to a Kids session.
  return NextResponse.json(
    { error: { code: "CLIPS_DIRECT_READ_REQUIRED", message: "Reload Clips to continue." } },
    { status: 410, headers: { "cache-control": "private, no-store" } },
  );
}
