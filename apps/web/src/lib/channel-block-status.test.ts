import { afterEach, describe, expect, it, vi } from "vitest";
import { requestAccountScope } from "./account-scope";
import { readChannelBlockStatus } from "./channel-block-status";

const accountId = "a0000000-0000-4000-8000-000000000001";
const channelId = "b0000000-0000-4000-8000-000000000002";
const otherAccountId = "c0000000-0000-4000-8000-000000000003";
const identity = (id = accountId, isKids = true) =>
  Response.json({ account: { id }, profile: { isKids } });
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());

describe("channel safety without social reads", () => {
  it.each([
    { isKids: true, blocked: true },
    { isKids: true, blocked: false },
    { isKids: false, blocked: true },
    { isKids: false, blocked: false },
  ])("preserves account-wide block=$blocked for Kids=$isKids", async ({ isKids, blocked }) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(identity(accountId, isKids))
      .mockResolvedValueOnce(Response.json({ accountId, channelId, blocked }))
      .mockResolvedValueOnce(identity(accountId, isKids));
    vi.stubGlobal("fetch", fetcher);
    expect(await readChannelBlockStatus(channelId, signal())).toBe(blocked);
    expect(fetcher.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      "/auth/me",
      "/user-blocks/channels/" + channelId,
      "/auth/me",
    ]);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { "x-ayin-expected-account": accountId },
    });
  });
  it("leaves anonymous public Kids content available without reading social or block data", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({}, { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(readChannelBlockStatus(channelId, signal())).rejects.toMatchObject({
      status: 401,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(new URL(fetcher.mock.calls[0]![0]).pathname).toBe("/auth/me");
  });
  it("rejects a late response after an account switch", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(identity())
        .mockResolvedValueOnce(Response.json({ accountId, channelId, blocked: true }))
        .mockResolvedValueOnce(identity(otherAccountId)),
    );
    await expect(readChannelBlockStatus(channelId, signal())).rejects.toMatchObject({
      code: "ACCOUNT_CHANGED",
    });
  });
  it.each([
    { accountId: otherAccountId, channelId, blocked: true },
    { accountId, channelId: otherAccountId, blocked: true },
    { accountId, channelId, blocked: "false" },
  ])("rejects mismatched or malformed safety responses", async (body) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(identity())
        .mockResolvedValueOnce(Response.json(body))
        .mockResolvedValueOnce(identity()),
    );
    await expect(readChannelBlockStatus(channelId, signal())).rejects.toThrow();
  });
  it.each([
    { path: "/user-blocks/channels/" + channelId, method: "POST" as const },
    { path: "/user-blocks/channels/" + channelId, method: "DELETE" as const },
    { path: "/user-blocks/channels/not-a-channel", method: "GET" as const },
  ])("keeps the additional transport path read-only and UUID-scoped", async ({ path, method }) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(requestAccountScope(path, method, (value) => value)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
