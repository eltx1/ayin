import { captionObjectKey } from "@/lib/caption-delivery";
import { mediaAssetUrl } from "@/lib/channel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Match the existing caption upload limit; video and upload bytes never use this route.
const MAX_BYTES = 2 * 1024 * 1024;
const DEADLINE_MS = 10_000;
const responseHeaders = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};

function unavailable(status: number) {
  return new Response(null, { status, headers: responseHeaders });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ videoId: string; assetId: string }> },
) {
  const { videoId, assetId } = await params;
  const key = captionObjectKey(videoId, assetId);
  if (!key || new URL(request.url).search) return unavailable(400);

  // The upstream comes only from deployment configuration, never a request URL.
  const source = mediaAssetUrl(key);
  if (!source) return unavailable(503);
  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(source);
    const localHttp =
      upstreamUrl.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(upstreamUrl.hostname);
    if (
      !(upstreamUrl.protocol === "https:" || localHttp) ||
      upstreamUrl.username ||
      upstreamUrl.password ||
      upstreamUrl.search ||
      upstreamUrl.hash
    )
      return unavailable(503);
  } catch {
    return unavailable(503);
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DEADLINE_MS);
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) controller.abort();

  try {
    // No cookies, authorization, range, or caller headers reach the media origin.
    // Redirects are rejected so the fixed origin cannot become an open proxy.
    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: { accept: "text/vtt" },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
    if (upstream.status === 404) return unavailable(404);
    if (
      upstream.status !== 200 ||
      upstream.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "text/vtt" ||
      !upstream.body
    )
      return unavailable(502);
    const length = upstream.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))
      return unavailable(502);

    const reader = upstream.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) return unavailable(502);
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
    const header = text.split(/\r?\n|\r/, 1)[0]?.trimEnd() ?? "";
    if (
      text.includes("\u0000") ||
      !(header === "WEBVTT" || /^WEBVTT[\t ].+$/.test(header)) ||
      header.includes("-->")
    )
      return unavailable(502);

    return new Response(text, {
      headers: { ...responseHeaders, "content-type": "text/vtt; charset=utf-8" },
    });
  } catch {
    return unavailable(timedOut ? 504 : 502);
  } finally {
    clearTimeout(deadline);
    request.signal.removeEventListener("abort", abort);
    controller.abort();
  }
}
