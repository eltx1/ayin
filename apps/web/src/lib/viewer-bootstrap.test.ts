import { afterEach, describe, expect, it, vi } from "vitest";

import type { AyinIdentity } from "./api";
import { fetchDiscoveryHome, fetchKidsDiscoveryHome, getIdentity } from "./discovery";
import {
  readViewerIdentity,
  sameViewerIdentity,
  viewerBootstrapTimeoutMs,
  ViewerReadTimeoutError,
  withViewerReadDeadline,
} from "./viewer-bootstrap";

const id = "a0000000-0000-4000-8000-000000000001";
const identity: AyinIdentity = {
  account: { id, displayName: "Viewer", email: "viewer@example.test" },
  channel: { id, name: "Viewer channel", handle: "viewer" },
  profile: { id, name: "Viewer profile", slug: "viewer" },
  creatorTv: { id, name: "Viewer TV", slug: "viewer-tv" },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function heldBody(status = 200) {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  return {
    response: new Response(
      new ReadableStream({
        start(controller) {
          stream = controller;
        },
      }),
      { status, headers: { "content-type": "application/json" } },
    ),
    finish(value: unknown) {
      stream.enqueue(new TextEncoder().encode(JSON.stringify(value)));
      stream.close();
    },
  };
}

describe("bounded Viewer bootstrap reads", () => {
  it("times out held response headers without retiring the outer lifecycle", async () => {
    vi.useFakeTimers();
    const owner = new AbortController();
    let child!: AbortSignal;
    const read = withViewerReadDeadline((signal) => {
      child = signal;
      return new Promise<never>(() => undefined);
    }, owner.signal);
    const rejected = expect(read).rejects.toBeInstanceOf(ViewerReadTimeoutError);
    await vi.advanceTimersByTimeAsync(viewerBootstrapTimeoutMs);
    await rejected;
    expect(child.aborted).toBe(true);
    expect(owner.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds an identity body even after successful response headers", async () => {
    vi.useFakeTimers();
    const body = heldBody();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => body.response),
    );
    const rejected = expect(readViewerIdentity()).rejects.toBeInstanceOf(ViewerReadTimeoutError);
    await vi.advanceTimersByTimeAsync(viewerBootstrapTimeoutMs);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([200, 503])("bounds held discovery %s bodies, including API errors", async (status) => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => heldBody(status).response),
    );
    const rejected = expect(fetchDiscoveryHome(true)).rejects.toBeInstanceOf(
      ViewerReadTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(viewerBootstrapTimeoutMs);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects cancellation promptly even if an underlying body ignores abort", async () => {
    vi.useFakeTimers();
    const owner = new AbortController();
    const body = heldBody();
    let started!: () => void;
    const reading = new Promise<void>((resolve) => (started = resolve));
    const read = withViewerReadDeadline(async () => {
      started();
      return body.response.json();
    }, owner.signal);
    const rejected = expect(read).rejects.toMatchObject({ name: "AbortError" });
    await reading;
    owner.abort();
    await rejected;
    body.finish({ stale: true });
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores late old work while a new retry succeeds", async () => {
    vi.useFakeTimers();
    let finish!: (value: string) => void;
    const stale = withViewerReadDeadline(
      () => new Promise<string>((resolve) => (finish = resolve)),
    );
    const rejected = expect(stale).rejects.toBeInstanceOf(ViewerReadTimeoutError);
    await vi.advanceTimersByTimeAsync(viewerBootstrapTimeoutMs);
    await rejected;
    await expect(withViewerReadDeadline(async () => "new owner")).resolves.toBe("new owner");
    finish("old owner");
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never starts work for an already-retired lifecycle", async () => {
    const owner = new AbortController();
    owner.abort();
    const read = vi.fn();
    await expect(withViewerReadDeadline(read, owner.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("cleans the timer and parent listener after success or immediate failure", async () => {
    vi.useFakeTimers();
    const owner = new AbortController();
    const remove = vi.spyOn(owner.signal, "removeEventListener");
    await expect(withViewerReadDeadline(async () => "ready", owner.signal)).resolves.toBe("ready");
    await expect(
      withViewerReadDeadline(async () => {
        throw new Error("Unavailable");
      }, owner.signal),
    ).rejects.toThrow("Unavailable");
    expect(remove).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Viewer bootstrap audience", () => {
  it.each(["phase5d.creator", "صانع.المحتوى"])(
    "keeps a real signed-in audience with server-valid handle %s",
    async (handle) => {
      const viewer = { ...identity, channel: { ...identity.channel, handle } };
      vi.stubGlobal("fetch", async () => Response.json(viewer));
      await expect(readViewerIdentity()).resolves.toEqual(viewer);
      await expect(getIdentity()).resolves.toEqual(viewer);
    },
  );
  it("uses current no-store cookie credentials and validates signed-in identity", async () => {
    const fetch = vi.fn(async () => Response.json(identity));
    vi.stubGlobal("fetch", fetch);
    await expect(readViewerIdentity()).resolves.toEqual(identity);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/auth/me");
    expect(init).toMatchObject({ cache: "no-store", credentials: "include" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses only a real 401 as anonymous identity", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 401 }));
    await expect(readViewerIdentity()).resolves.toBeNull();
    await expect(getIdentity()).resolves.toBeNull();
  });

  it.each([403, 409, 429, 500, 503])(
    "keeps auth %s unavailable instead of anonymous",
    async (status) => {
      vi.stubGlobal("fetch", async () => new Response(null, { status }));
      await expect(readViewerIdentity()).rejects.toThrow();
      await expect(getIdentity()).rejects.toThrow();
    },
  );

  it.each([null, {}, { ...identity, profile: null }])(
    "never turns malformed successful identity into an anonymous audience: %j",
    async (value) => {
      vi.stubGlobal("fetch", async () => Response.json(value));
      await expect(readViewerIdentity()).rejects.toThrow();
    },
  );

  it("preserves network failures as unavailable identity", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(readViewerIdentity()).rejects.toThrow("Failed to fetch");
  });

  it("distinguishes anonymous, account and profile changes", () => {
    expect(sameViewerIdentity(null, null)).toBe(true);
    expect(sameViewerIdentity(identity, identity)).toBe(true);
    expect(sameViewerIdentity(identity, null)).toBe(false);
    expect(
      sameViewerIdentity(identity, { ...identity, account: { ...identity.account, id: "other" } }),
    ).toBe(false);
    expect(
      sameViewerIdentity(identity, { ...identity, profile: { ...identity.profile, id: "kids" } }),
    ).toBe(false);
  });

  it("keeps anonymous, authenticated and explicit Kids discovery endpoints separate", async () => {
    const fetch = vi.fn(async () => Response.json({ rows: [] }));
    vi.stubGlobal("fetch", fetch);
    await fetchDiscoveryHome(false);
    await fetchDiscoveryHome(true);
    await fetchKidsDiscoveryHome();
    expect(
      fetch.mock.calls.map((call) => new URL((call as unknown as [string])[0]).pathname),
    ).toEqual(["/public/discovery/home", "/discovery/home", "/public/discovery/kids"]);
    for (const call of fetch.mock.calls)
      expect((call as unknown as [string, RequestInit])[1]).toMatchObject({
        cache: "no-store",
        credentials: "include",
      });
  });
});
