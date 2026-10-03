import { afterEach, describe, expect, it, vi } from "vitest";
import { parseUploadHistory, readUploadHistory } from "./upload-history";
const accountId = "00000000-0000-4000-8000-000000000001",
  channelId = "00000000-0000-4000-8000-000000000002",
  otherId = "00000000-0000-4000-8000-000000000003";
const actor = { accountId, channelId };
const row = {
  id: otherId,
  channelId,
  title: "Actual source",
  status: "UPLOADING",
  visibility: "PRIVATE",
  videoForm: "LONG_FORM",
  createdAt: "2026-10-03T12:00:00Z",
  updatedAt: "2026-10-03T12:00:00Z",
  processing: { generation: 2, status: "FAILED", progressPercent: 0, errorCode: "SOURCE_REJECTED" },
};
const history = {
  actorAccountId: accountId,
  channelId,
  pagination: { page: 1, take: 25, total: 1, pages: 1 },
  items: [row],
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Owned upload history", () => {
  it("preserves actual zero progress and rejects foreign rows, actor, invalid counts and filter mismatches", () => {
    expect(parseUploadHistory(history, actor, 1, "").items[0]?.processing?.progressPercent).toBe(0);
    for (const v of [
      { ...history, actorAccountId: otherId },
      { ...history, items: [{ ...row, channelId: otherId }] },
      { ...history, items: [row, row] },
      { ...history, pagination: { ...history.pagination, total: 2 } },
      { ...history, items: [{ ...row, processing: { ...row.processing, progressPercent: 101 } }] },
    ])
      expect(() => parseUploadHistory(v, actor, 1, "")).toThrow();
    expect(() => parseUploadHistory(history, actor, 1, "DRAFT")).toThrow();
  });
  it("checks actual identity before and after a scoped private GET and never issues writes", async () => {
    const me = { account: { id: accountId }, channel: { id: channelId } };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(me))
      .mockResolvedValueOnce(Response.json(history))
      .mockResolvedValueOnce(Response.json(me));
    vi.stubGlobal("fetch", fetch);
    await expect(readUploadHistory(1, "", new AbortController().signal)).resolves.toMatchObject(
      actor,
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[1]?.[0]).toContain(`channelId=${channelId}&page=1`);
    for (const [, init] of fetch.mock.calls) {
      expect(init.method).toBeUndefined();
      expect(init.cache).toBe("no-store");
    }
  });
  it("rejects an account change after a read without returning earlier private records", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ account: { id: accountId }, channel: { id: channelId } }),
      )
      .mockResolvedValueOnce(Response.json(history))
      .mockResolvedValueOnce(
        Response.json({ account: { id: otherId }, channel: { id: channelId } }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(readUploadHistory(1, "", new AbortController().signal)).rejects.toMatchObject({
      status: 403,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("aborts the complete read at15 seconds and cleans up the timer without retry", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal!.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          ),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const result = expect(readUploadHistory(1, "", new AbortController().signal)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(15000);
    await result;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
