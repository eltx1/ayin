import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appealInput,
  getCreatorTrust,
  parseCreatorTrust,
  submitCreatorAppeal,
} from "./creator-trust";
const accountId = "11111111-1111-4111-8111-111111111111",
  channelId = "22222222-2222-4222-8222-222222222222",
  actionId = "33333333-3333-4333-8333-333333333333",
  appealId = "44444444-4444-4444-8444-444444444444",
  at = "2026-10-03T00:00:00.000Z";
const identity = { account: { id: accountId }, channel: { id: channelId, name: "Owned channel" } };
const action = {
  id: actionId,
  kind: "WARN",
  reason: "Actual moderation reason",
  createdAt: at,
  actorAccountId: "do not expose",
};
const snapshot = () => ({
  actions: [action],
  appeals: [
    {
      id: appealId,
      accountId,
      actionId,
      status: "OPEN",
      message: "Actual appeal explanation",
      resolution: null,
      createdAt: at,
      updatedAt: at,
      action,
    },
  ],
  notices: [
    {
      id: appealId,
      accountId,
      type: "MODERATION",
      title: "Notice",
      body: "Actual body",
      createdAt: at,
      readAt: null,
      data: { private: "do not expose" },
    },
  ],
  trust: [{ channelId, level: "NEW", strikeCount: 0, reviewRequired: false, updatedAt: at }],
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Creator trust history and appeal safety", () => {
  it("preserves actual zero/null fields and strips operator/notice payload fields", () => {
    const result = parseCreatorTrust(snapshot(), identity);
    expect(result.trust[0]?.strikeCount).toBe(0);
    expect(result.appeals[0]?.resolution).toBeNull();
    expect(result.notices[0]).not.toHaveProperty("data");
    expect(result.actions[0]).not.toHaveProperty("actorAccountId");
  });
  it("rejects a foreign account or mismatched appeal/action correlation", () => {
    const data = snapshot();
    expect(() =>
      parseCreatorTrust(
        { ...data, appeals: [{ ...data.appeals[0], accountId: channelId }] },
        identity,
      ),
    ).toThrow();
    expect(() =>
      parseCreatorTrust(
        { ...data, appeals: [{ ...data.appeals[0], actionId: channelId }] },
        identity,
      ),
    ).toThrow();
    expect(() =>
      parseCreatorTrust(
        { ...data, notices: [{ ...data.notices[0], accountId: channelId }] },
        identity,
      ),
    ).toThrow();
  });
  it("rejects unknown states, duplicates, unbounded snapshots and missing dates", () => {
    const data = snapshot();
    expect(() => parseCreatorTrust({ ...data, actions: [action, action] }, identity)).toThrow();
    expect(() =>
      parseCreatorTrust({ ...data, actions: Array(101).fill(action) }, identity),
    ).toThrow();
    expect(() =>
      parseCreatorTrust({ ...data, trust: [{ ...data.trust[0], level: "CERTIFIED" }] }, identity),
    ).toThrow();
    expect(() =>
      parseCreatorTrust({ ...data, actions: [{ ...action, createdAt: "invalid" }] }, identity),
    ).toThrow();
  });
  it("validates appeal target and minimum/maximum explanation without making a request", () => {
    expect(appealInput(actionId, "  A reason with sufficient detail.  ")).toEqual({
      actionId,
      message: "A reason with sufficient detail.",
    });
    for (const message of ["short", "x".repeat(5001)])
      expect(() => appealInput(actionId, message)).toThrow();
    expect(() => appealInput("foreign", "A reason with sufficient detail.")).toThrow();
  });
  it("checks the same account before and after the actual history read", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(identity))
      .mockResolvedValueOnce(Response.json(snapshot()))
      .mockResolvedValueOnce(Response.json({ account: { id: channelId } }));
    vi.stubGlobal("fetch", fetch);
    await expect(getCreatorTrust(new AbortController().signal)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ cache: "no-store", credentials: "include" });
  });
  it("accepts a correlated actual appeal acknowledgment and never reads/replays after a lost one", async () => {
    const input = appealInput(actionId, "A reason with sufficient detail."),
      row = {
        id: appealId,
        accountId,
        actionId,
        status: "OPEN",
        message: input.message,
        resolution: null,
        createdAt: at,
      };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(row))
      .mockResolvedValueOnce(Response.json({ ...row, actionId: channelId }));
    vi.stubGlobal("fetch", fetch);
    expect((await submitCreatorAppeal(accountId, input, new AbortController().signal)).id).toBe(
      appealId,
    );
    await expect(
      submitCreatorAppeal(accountId, input, new AbortController().signal),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: JSON.stringify(input) });
  });
  it("expires a stalled read after15s and aborts without replay", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener("abort", () => reject(Error("aborted"))),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const pending = getCreatorTrust(new AbortController().signal),
      failure = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(15000);
    await failure;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
