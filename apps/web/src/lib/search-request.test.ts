import { afterEach, describe, expect, it, vi } from "vitest";

import type { AyinIdentity } from "./api";
import { readSearch, SearchReadError } from "./search-request";

const accountId = "10000000-0000-4000-8000-000000000001";
const profileId = "20000000-0000-4000-8000-000000000001";
const identity = { account: { id: accountId }, profile: { id: profileId } } as AyinIdentity;
const params = { query: "رحلة", locale: "ar" as const };
const controller = () => new AbortController();
afterEach(() => vi.unstubAllGlobals());

describe("viewer-scoped Search reads", () => {
  it("uses the API cookie and verified account/profile fences without browser territory assertions", async () => {
    const fetch = vi.fn(async () => Response.json({ suggestions: [] }));
    vi.stubGlobal("fetch", fetch);
    await readSearch(
      "suggestions",
      params,
      { identity, isCurrent: () => true },
      controller().signal,
    );
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/public/search/suggestions");
    expect(new URL(url).searchParams.get("q")).toBe("رحلة");
    expect(new URL(url).searchParams.get("expectedProfileId")).toBe(profileId);
    expect(init).toMatchObject({
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      headers: { "x-ayin-locale": "ar", "x-ayin-expected-account": accountId },
    });
    expect(Object.keys(init.headers!)).toEqual(["x-ayin-locale", "x-ayin-expected-account"]);
  });

  it("preserves anonymous search and the canonical cursor without inventing a profile", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ query: params.query, items: [], nextCursor: null, emptyMessage: null }),
    );
    vi.stubGlobal("fetch", fetch);
    await readSearch(
      "results",
      { ...params, cursor: "stable:window" },
      { identity: null, isCurrent: () => true },
      controller().signal,
    );
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/public/search");
    expect(new URL(url).searchParams.get("cursor")).toBe("stable:window");
    expect(new URL(url).searchParams.has("expectedProfileId")).toBe(false);
    expect(init.headers).toEqual({ "x-ayin-locale": "ar" });
  });

  it("does not start a read before the audience is verified", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      readSearch(
        "results",
        params,
        { identity: null, isCurrent: () => false },
        controller().signal,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("drops an obsolete account response even when fetch ignores cancellation", async () => {
    let current = true;
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => (finish = resolve)));
    const read = readSearch(
      "results",
      params,
      { identity, isCurrent: () => current },
      controller().signal,
    );
    current = false;
    finish(Response.json({ items: [{ title: "Adult old audience" }] }));
    await expect(read).rejects.toMatchObject({ status: 409 });
  });

  it("rechecks the profile lease after an asynchronous response body", async () => {
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
    const read = readSearch(
      "suggestions",
      params,
      { identity, isCurrent: () => current },
      controller().signal,
    );
    await Promise.resolve();
    current = false;
    stream.enqueue(new TextEncoder().encode('{"suggestions":[{"label":"Old adult profile"}]}'));
    stream.close();
    await expect(read).rejects.toBeInstanceOf(SearchReadError);
  });

  it("drops a dismissed request when its uncancellable fetch resolves late", async () => {
    const abort = controller();
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => (finish = resolve)));
    const read = readSearch(
      "suggestions",
      params,
      { identity, isCurrent: () => true },
      abort.signal,
    );
    abort.abort();
    finish(Response.json({ suggestions: [{ label: "Dismissed" }] }));
    await expect(read).rejects.toMatchObject({ name: "AbortError" });
  });

  it.each([401, 409, 500])("never exposes a rejected %s audience response", async (status) => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ suggestions: [{ label: "Rejected" }] }, { status }),
    );
    await expect(
      readSearch("suggestions", params, { identity, isCurrent: () => true }, controller().signal),
    ).rejects.toMatchObject({ status });
  });

  it("bounds autocomplete responses before rendering", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ suggestions: ["x".repeat(33000)] }));
    await expect(
      readSearch("suggestions", params, { identity, isCurrent: () => true }, controller().signal),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });
});

describe("Search response presentation contract", () => {
  const item = {
    id: "movie-1",
    type: "MOVIE",
    title: "A film",
    href: "/movies/a-film",
    kicker: "Movie",
    meta: null,
    artworkObjectKey: null,
  };
  const valid = { query: params.query, items: [item], nextCursor: null, emptyMessage: null };
  it.each([
    {},
    { ...valid, items: null },
    { ...valid, items: Array(25).fill(item) },
    { ...valid, query: "old query" },
    { ...valid, nextCursor: 42 },
    { ...valid, items: [{ ...item, title: null }] },
    { ...valid, items: [{ ...item, href: "https://untrusted.example/film" }] },
    { ...valid, items: [{ ...item, href: "/movies/../account" }] },
    { ...valid, items: [{ ...item, href: "/movies/%2e%2e" }] },
    { ...valid, items: [{ ...item, type: "UNKNOWN" }] },
  ])("rejects a malformed result body before rendering: %j", async (body) => {
    vi.stubGlobal("fetch", async () => Response.json(body));
    await expect(
      readSearch("results", params, { identity, isCurrent: () => true }, controller().signal),
    ).rejects.toMatchObject({ status: 0 });
  });
  it("preserves valid result and Kids suggestion DTOs", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(valid))
        .mockResolvedValueOnce(
          Response.json({
            suggestions: [
              { id: "safe", type: "VIDEO", label: "حكاية", href: "/watch/safe?kids=1" },
            ],
          }),
        ),
    );
    await expect(
      readSearch("results", params, { identity, isCurrent: () => true }, controller().signal),
    ).resolves.toEqual(valid);
    await expect(
      readSearch("suggestions", params, { identity, isCurrent: () => true }, controller().signal),
    ).resolves.toEqual({
      suggestions: [{ id: "safe", type: "VIDEO", label: "حكاية", href: "/watch/safe?kids=1" }],
    });
  });
  it.each([
    {},
    { suggestions: Array(9).fill({ id: "a", type: "VIDEO", label: "A", href: "/watch/a" }) },
    { suggestions: [{ id: "a", type: "VIDEO", label: "A", href: "//untrusted.example/a" }] },
  ])("rejects malformed autocomplete: %j", async (body) => {
    vi.stubGlobal("fetch", async () => Response.json(body));
    await expect(
      readSearch("suggestions", params, { identity, isCurrent: () => true }, controller().signal),
    ).rejects.toMatchObject({ status: 0 });
  });
});
