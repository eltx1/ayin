import { afterEach, describe, expect, it, vi } from "vitest";
import type { AyinIdentity } from "./api";
import { readPlayback } from "./playback-request";

const identity = {
  account: { id: "10000000-0000-4000-8000-000000000001" },
  profile: { id: "20000000-0000-4000-8000-000000000001" },
} as AyinIdentity;
const params = { slug: "ordinary", locale: "ar" as const, explicitKids: false };
const body = {
  viewer: { isKids: false },
  video: {
    id: "video",
    slug: "ordinary",
    title: "Title",
    source: { objectKey: "source.mp4" },
    channel: { name: "Channel", handle: "channel" },
    adaptiveSource: null,
    captions: [],
    chapters: [],
  },
  detail: { contentType: "CREATOR_VIDEO", commentsSlot: { enabled: true }, related: [] },
  playerPolicy: { progressSaveIntervalMs: 15000, completionThresholdPercent: 90 },
};
const audience = { identity, isCurrent: () => true };
afterEach(() => vi.unstubAllGlobals());

describe("Watch audience-scoped playback", () => {
  it("sends browser credentials and exact viewer fences without asserting territory", async () => {
    const fetch = vi.fn(async () => Response.json(body));
    vi.stubGlobal("fetch", fetch);
    await expect(readPlayback(params, audience, new AbortController().signal)).resolves.toEqual(
      body,
    );
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).searchParams.get("expectedProfileId")).toBe(identity.profile.id);
    expect(new URL(url).searchParams.get("locale")).toBe("ar");
    expect(init).toMatchObject({
      credentials: "include",
      redirect: "error",
      cache: "no-store",
      headers: { "x-ayin-expected-account": identity.account.id },
    });
    expect(Object.keys(init.headers!)).toEqual(["x-ayin-expected-account"]);
  });
  it.each([false, true])(
    "preserves anonymous playback with explicit Kids=%s",
    async (explicitKids) => {
      const fetch = vi.fn(async () => Response.json({ ...body, viewer: { isKids: explicitKids } }));
      vi.stubGlobal("fetch", fetch);
      await readPlayback(
        { ...params, explicitKids },
        { identity: null, isCurrent: () => true },
        new AbortController().signal,
      );
      const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(new URL(url).searchParams.get("kids")).toBe(explicitKids ? "1" : null);
      expect(new URL(url).searchParams.has("expectedProfileId")).toBe(false);
      expect(init.headers).toEqual({});
    },
  );
  it("never reads before audience verification", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      readPlayback(params, { ...audience, isCurrent: () => false }, new AbortController().signal),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("discards a held general response after viewer invalidation even if fetch ignores abort", async () => {
    let current = true;
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const read = readPlayback(
      params,
      { ...audience, isCurrent: () => current },
      new AbortController().signal,
    );
    current = false;
    finish(Response.json(body));
    await expect(read).rejects.toMatchObject({ status: 409 });
  });
  it("rechecks after a delayed body and never installs an obsolete source", async () => {
    let current = true;
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          new ReadableStream({
            start(value) {
              stream = value;
            },
          }),
        ),
    );
    const read = readPlayback(
      params,
      { ...audience, isCurrent: () => current },
      new AbortController().signal,
    );
    await Promise.resolve();
    current = false;
    stream.enqueue(new TextEncoder().encode(JSON.stringify(body)));
    stream.close();
    await expect(read).rejects.toMatchObject({ status: 409 });
  });
  it("rejects a cancelled response without exposing media", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const read = readPlayback(params, audience, controller.signal);
    controller.abort();
    finish(Response.json(body));
    await expect(read).rejects.toMatchObject({ name: "AbortError" });
  });
  it.each([401, 403, 404, 409, 500])("rejects failed %s responses", async (status) => {
    vi.stubGlobal("fetch", async () => Response.json(body, { status }));
    await expect(
      readPlayback(params, audience, new AbortController().signal),
    ).rejects.toMatchObject({ status });
  });
  it.each([
    {},
    { ...body, viewer: {} },
    { ...body, video: { ...body.video, slug: "old-video" } },
    {
      ...body,
      viewer: { isKids: true },
      detail: { ...body.detail, related: [{ id: "adult", title: "Adult", href: "/watch/adult" }] },
    },
    {
      ...body,
      detail: {
        ...body.detail,
        related: [{ id: "remote", title: "Remote", href: "https://unsafe.example" }],
      },
    },
  ])("rejects malformed policy/presentation before rendering: %j", async (value) => {
    vi.stubGlobal("fetch", async () => Response.json(value));
    await expect(
      readPlayback(params, audience, new AbortController().signal),
    ).rejects.toMatchObject({ status: 0 });
  });
  it("does not allow a response to weaken explicit Kids mode", async () => {
    vi.stubGlobal("fetch", async () => Response.json(body));
    await expect(
      readPlayback({ ...params, explicitKids: true }, audience, new AbortController().signal),
    ).rejects.toMatchObject({ status: 0 });
  });
  it("bounds playback bodies", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ ...body, extra: "x".repeat(513 * 1024) }));
    await expect(
      readPlayback(params, audience, new AbortController().signal),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });
});
