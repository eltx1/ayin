import { NextRequest, NextResponse } from "next/server";

import { isClipCursor } from "@/lib/clips";
import { fetchClipsPage } from "@/lib/clips-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const cursor = request.nextUrl.searchParams.get("cursor");
  if (cursor !== null && !isClipCursor(cursor)) {
    return NextResponse.json(
      { error: { code: "INVALID_CLIPS_CURSOR", message: "This Clips page is invalid." } },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }
  try {
    const page = await fetchClipsPage(cursor ?? undefined);
    return NextResponse.json(page, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: { code: "CLIPS_UNAVAILABLE", message: "Clips are unavailable." } },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}
