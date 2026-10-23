import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const videoId = "11111111-1111-4111-8111-111111111111";
const assetId = "22222222-2222-4222-8222-222222222222";
const path = `/api/captions/${videoId}/${assetId}`;
const key = `captions/videos/${videoId}/${assetId}/track.vtt`;
const vtt = "WEBVTT\n\n00:01.000 --> 00:04.000\nهذه ترجمة عربية.\n";
const maxBytes = 2 * 1024 * 1024;
let GET: typeof import("./route").GET;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_MEDIA_BASE_URL", "https://media.ayin.example");
  ({ GET } = await import("./route"));
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const context = () => ({ params: Promise.resolve({ videoId, assetId }) });
const request = (init?: RequestInit) => new Request(`https://ayin.example${path}`, init);
const upstream = (body: BodyInit = vtt, headers: HeadersInit = { "content-type": "text/vtt" }) =>
  new Response(body, { headers });

describe("same-origin caption delivery", () => {
  it("returns the owned UTF-8 VTT without forwarding credentials or upstream response headers", async () => {
    fetchMock.mockResolvedValue(
      upstream(vtt, {
        "content-type": "text/vtt; charset=utf-8",
        "set-cookie": "upstream=not-forwarded",
        "cache-control": "public, max-age=99999",
      }),
    );
    const response = await GET(
      request({
        headers: { cookie: "session=private", authorization: "Bearer private", range: "bytes=0-1" },
      }),
      context(),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(vtt);
    expect(response.headers.get("content-type")).toBe("text/vtt; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      new URL(`https://media.ayin.example/${key}`),
      {
        method: "GET",
        headers: { accept: "text/vtt" },
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      },
    );
  });

  it.each(["..", "%2f", "https://elsewhere.example", `${videoId}/extra`, "invalid"])(
    "rejects invalid IDs before fetching: %s",
    async (invalid) => {
      const response = await GET(request(), {
        params: Promise.resolve({ videoId: invalid, assetId }),
      });
      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects query target overrides", async () => {
    const response = await GET(
      new Request(`https://ayin.example${path}?url=https://elsewhere.example`),
      context(),
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "file:///etc",
    "http://untrusted.example",
    "https://user:password@media.example",
    "https://media.example?target=",
  ])("fails closed on invalid media configuration: %s", async (base) => {
    vi.stubEnv("NEXT_PUBLIC_MEDIA_BASE_URL", base);
    vi.resetModules();
    const route = await import("./route");
    expect((await route.GET(request(), context())).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([301, 302, 206, 403, 404, 500])(
    "does not return partial/error/redirect responses: %s",
    async (status) => {
      fetchMock.mockResolvedValue(
        new Response(null, { status, headers: { location: "https://elsewhere.example" } }),
      );
      const response = await GET(request(), context());
      expect(response.status).toBe(status === 404 ? 404 : 502);
      expect(response.headers.get("location")).toBeNull();
      expect(await response.text()).toBe("");
    },
  );

  it.each([
    ["<html>not a caption</html>", "text/html"],
    ["not WEBVTT", "text/vtt"],
    ["WEBVTT --> invalid header\n", "text/vtt"],
    ["WEBVTT\n\u0000", "text/vtt"],
    [new Uint8Array([0xff, 0xfe]), "text/vtt"],
  ] as const)("rejects wrong MIME or invalid UTF-8/WebVTT", async (body, mime) => {
    fetchMock.mockResolvedValue(upstream(body, { "content-type": mime }));
    expect((await GET(request(), context())).status).toBe(502);
  });

  it("bounds an oversized declared response before consuming its body", async () => {
    fetchMock.mockResolvedValue(
      upstream(vtt, { "content-type": "text/vtt", "content-length": String(maxBytes + 1) }),
    );
    expect((await GET(request(), context())).status).toBe(502);
  });

  it("bounds actual streamed bytes even without a trustworthy Content-Length", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(maxBytes));
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    fetchMock.mockResolvedValue(
      upstream(body, { "content-type": "text/vtt", "content-length": "10" }),
    );
    expect((await GET(request(), context())).status).toBe(502);
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });

  it("aborts an upstream that does not respond within ten seconds", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    const response = GET(request(), context());
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await response).status).toBe(504);
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });

  it("cancels upstream work when the viewer disconnects", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    const response = GET(request({ signal: controller.signal }), context());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    controller.abort();
    expect((await response).status).toBe(502);
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });
});
