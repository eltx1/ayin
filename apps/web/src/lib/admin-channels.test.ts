import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAdminVerification } from "./admin-reauthentication";
import {
  adminChannelInput,
  getAdminChannels,
  parseAdminChannelRecord,
  saveAdminChannel,
  verifyAdminChannelAck,
  type AdminChannelDraft,
} from "./admin-channels";
const channelId = "00000000-0000-4000-8000-000000000001",
  actorId = "00000000-0000-4000-8000-000000000002",
  contractId = "00000000-0000-4000-8000-000000000003",
  stamp = "2026-10-03T00:00:00Z";
const row = () =>
  parseAdminChannelRecord({
    id: channelId,
    name: "Actual channel",
    handle: "actual-channel",
    description: null,
    status: "ACTIVE",
    isPlatformOwned: false,
    updatedAt: stamp,
    creatorContracts: [
      { id: contractId, status: "ACTIVE", revenueShareBps: null, effectiveFrom: null },
    ],
  });
const draft = (): AdminChannelDraft => ({
  name: "Actual channel",
  description: "",
  status: "ACTIVE",
  isPlatformOwned: false,
  contractStatus: "ACTIVE",
  revenueShareBps: "",
  reason: "Actual reviewed update",
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Admin channel update boundaries", () => {
  it("distinguishes the inherited share from an explicit zero and rejects fractional or excessive values", () => {
    expect(adminChannelInput(row(), draft())).not.toHaveProperty("revenueShareBps");
    expect(adminChannelInput(row(), { ...draft(), revenueShareBps: "0" })).toMatchObject({
      revenueShareBps: 0,
      expectedUpdatedAt: stamp,
    });
    for (const value of ["1.5", "1e2", "-1", "10001"])
      expect(() => adminChannelInput(row(), { ...draft(), revenueShareBps: value })).toThrow();
  });
  it("does not invent a pending contract while editing a channel with no contract", () => {
    const record = { ...row(), creatorContracts: [] };
    const input = adminChannelInput(record, { ...draft(), contractStatus: "PENDING" });
    expect(input).not.toHaveProperty("contractStatus");
    expect(input).not.toHaveProperty("revenueShareBps");
  });
  it("only acknowledges the actual channel and requested contract values", () => {
    const record = row(),
      input = adminChannelInput(record, {
        ...draft(),
        contractStatus: "SUSPENDED",
        revenueShareBps: "0",
      });
    expect(() => verifyAdminChannelAck(record, record, input)).toThrow();
    const saved = {
      ...record,
      creatorContracts: [
        { ...record.creatorContracts[0]!, status: "SUSPENDED", revenueShareBps: 0 },
      ],
    };
    expect(verifyAdminChannelAck(saved, record, input).creatorContracts[0]?.revenueShareBps).toBe(
      0,
    );
    expect(() => verifyAdminChannelAck({ ...saved, id: actorId }, record, input)).toThrow();
  });
  it("denies Finance before any directory GET is sent", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ accountId: actorId, roles: ["FINANCE_MANAGER"] }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      getAdminChannels({ query: "", status: "", page: 1 }, new AbortController().signal),
    ).rejects.toMatchObject({ status: 403 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects a different current staff identity before a PATCH", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ accountId: channelId, roles: ["OPERATIONS"] }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveAdminChannel(
        { accountId: actorId, roles: ["OPERATIONS"] },
        row(),
        draft(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 403, writeStarted: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.method).toBeUndefined();
  });
  it("bounds a stalled protected session without retrying or sending a directory request", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          ),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const observed = getAdminChannels(
      { query: "", status: "", page: 1 },
      new AbortController().signal,
    ).catch((error) => error);
    await vi.advanceTimersByTimeAsync(15000);
    expect((await observed).name).toBe("AbortError");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("preserves explicit step-up rejection and dispatches verification once without replay or financial rereads", async () => {
    const actor = { accountId: actorId, roles: ["OPERATIONS" as const] };
    const verification = vi.fn(),
      dispose = registerAdminVerification(verification);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(actor))
      .mockResolvedValueOnce(
        Response.json({ error: { code: "STEP_UP_REQUIRED" } }, { status: 403 }),
      );
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(
        saveAdminChannel(actor, row(), draft(), new AbortController().signal),
      ).rejects.toMatchObject({ status: 403, writeStarted: true, verificationRequired: true });
      expect(verification).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls[1]?.[1]?.method).toBe("PATCH");
    } finally {
      dispose();
    }
  });
});
