import { afterEach, describe, expect, it, vi } from "vitest";
import type { AyinIdentity } from "./api";
import { readClips } from "./clips-request";

const identity = {
  account: { id: "10000000-0000-4000-8000-000000000001" },
  profile: { id: "20000000-0000-4000-8000-000000000001" },
} as AyinIdentity;
const cursor = "30000000-0000-4000-8000-000000000001";
const body = {
  enabled: true,
  viewer: { isKids: false },
  items: [],
  nextCursor: null,
  autoplayEnabled: true,
  adPolicy: { enabled: false, minimumOrganicClips: 6 },
};
const audience = { identity, isCurrent: () => true };
afterEach(() => vi.unstubAllGlobals());

describe("Clips audience-scoped source reads", () => {
  it("uses direct credentialed API reads with account/profile equality fences and a bounded page", async () => {
    const fetch = vi.fn(async () => Response.json(body));
    vi.stubGlobal("fetch", fetch);
    await expect(readClips(cursor, audience, new AbortController().signal)).resolves.toEqual(body);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/public/clips");
    expect(Object.fromEntries(new URL(url).searchParams)).toEqual({
      take: "20",
      cursor,
      expectedProfileId: identity.profile.id,
    });
    expect(init).toMatchObject({ credentials: "include", cache: "no-store", redirect: "error" });
    expect(init.headers).toEqual({ "x-ayin-expected-account": identity.account.id });
  });
  it("keeps verified anonymous reads credentialed without invented profile or territory", async () => {
    const fetch = vi.fn(async () => Response.json(body));
    vi.stubGlobal("fetch", fetch);
    await readClips(
      undefined,
      { identity: null, isCurrent: () => true },
      new AbortController().signal,
    );
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(Object.fromEntries(new URL(url).searchParams)).toEqual({ take: "20" });
    expect(init.credentials).toBe("include");
    expect(init.headers).toEqual({});
  });
  it("does not fetch while audience verification is pending or a cursor is malformed", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      readClips(undefined, { ...audience, isCurrent: () => false }, new AbortController().signal),
    ).rejects.toMatchObject({ status: 409 });
    await expect(readClips("bad", audience, new AbortController().signal)).rejects.toMatchObject({
      status: 400,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("discards a late source-bearing response even when fetch ignores cancellation", async () => {
    let current = true;
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = readClips(
      undefined,
      { ...audience, isCurrent: () => current },
      new AbortController().signal,
    );
    current = false;
    finish(Response.json(body));
    await expect(pending).rejects.toMatchObject({ status: 409 });
  });
  it("checks the audience again after a held response body", async () => {
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
    const pending = readClips(
      undefined,
      { ...audience, isCurrent: () => current },
      new AbortController().signal,
    );
    await Promise.resolve();
    current = false;
    stream.enqueue(new TextEncoder().encode(JSON.stringify(body)));
    stream.close();
    await expect(pending).rejects.toMatchObject({ status: 409 });
  });
  it.each([401, 403, 409, 500])(
    "does not turn a %s response into an anonymous feed",
    async (status) => {
      vi.stubGlobal("fetch", async () => Response.json(body, { status }));
      await expect(
        readClips(undefined, audience, new AbortController().signal),
      ).rejects.toMatchObject({ status });
    },
  );
  it.each([
    { ...body, viewer: undefined },
    { ...body, viewer: { isKids: "false" } },
    { ...body, viewer: { isKids: true }, adPolicy: { ...body.adPolicy, enabled: true } },
  ])("requires authoritative audience and forbids Kids ads: %j", async (value) => {
    vi.stubGlobal("fetch", async () => Response.json(value));
    await expect(readClips(undefined, audience, new AbortController().signal)).rejects.toThrow(
      "INVALID_CLIPS_RESPONSE",
    );
  });
  it("bounds the source-bearing body", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ ...body, extra: "x".repeat(513 * 1024) }));
    await expect(
      readClips(undefined, audience, new AbortController().signal),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });
});
