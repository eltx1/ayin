import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAdminVerification } from "./admin-reauthentication";
import {
  AdminTvError,
  getAdminTv,
  parseAdminTv,
  parseAdminTvAck,
  parseAdminTvDirectory,
  reviewAdminTv,
  saveAdminTv,
  tvCommand,
} from "./admin-tv-workspace";
const tvId = "00000000-0000-4000-8000-000000000001",
  actorId = "00000000-0000-4000-8000-000000000002",
  stamp = "2026-10-03T00:00:00Z";
const actor = { accountId: actorId, roles: ["OPERATIONS" as const] },
  filters = { page: 1, query: "", status: "" };
const row = () => ({
  id: tvId,
  slug: "actual-tv",
  name: "Actual TV",
  status: "ACTIVE",
  disabledAt: null,
  updatedAt: stamp,
  channel: { id: actorId, name: "Owner channel", handle: "actual-owner", status: "ACTIVE" },
  scheduleItems: [],
});
const directory = () => ({ items: [row()], pagination: { page: 1, take: 25, pages: 1, total: 1 } });
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Native TV verified command and read boundaries", () => {
  it("keeps actual nullable facts and rejects unbounded/malformed schedule or foreign target projections", () => {
    const result = parseAdminTv({ ...row(), internalProviderSecret: "never-ui" });
    expect(result.disabledAt).toBeNull();
    expect(result.scheduleItems).toEqual([]);
    expect(result).not.toHaveProperty("internalProviderSecret");
    expect(parseAdminTv({ ...row(), status: "DISABLED" }).disabledAt).toBeNull();
    for (const value of [
      { ...row(), status: "HIDDEN" },
      { ...row(), updatedAt: "yesterday" },
      { ...row(), scheduleItems: Array(3).fill({}) },
    ])
      expect(() => parseAdminTv(value)).toThrow();
    expect(() => parseAdminTv(row(), actorId)).toThrow();
  });
  it("rejects false pagination/duplicates/filter context and preserves actual zero", () => {
    for (const value of [
      { ...directory(), items: [row(), row()] },
      { ...directory(), items: [] },
      { ...directory(), pagination: { page: 2, take: 25, pages: 1, total: 1 } },
    ])
      expect(() => parseAdminTvDirectory(value, filters)).toThrow();
    expect(() => parseAdminTvDirectory(directory(), { ...filters, status: "DISABLED" })).toThrow();
    expect(
      parseAdminTvDirectory(
        { items: [], pagination: { page: 1, take: 25, pages: 1, total: 0 } },
        filters,
      ).pagination.total,
    ).toBe(0);
  });
  it("sends the original version and explicit bounded reason without accepting same-status commands or invented record ACKs", () => {
    const record = parseAdminTv(row()),
      command = { status: "DISABLED" as const, reason: " Actual reviewed TV decision " };
    expect(tvCommand(record, command)).toEqual({
      status: "DISABLED",
      reason: command.reason.trim(),
      expectedUpdatedAt: stamp,
    });
    expect(() => tvCommand(record, { status: "ACTIVE", reason: command.reason })).toThrow();
    expect(() => tvCommand(record, { ...command, reason: "short" })).toThrow();
    const ack = {
      id: tvId,
      name: "Actual TV",
      status: "DISABLED",
      disabledAt: "2026-10-03T00:00:01Z",
      updatedAt: "2026-10-03T00:00:01Z",
    };
    expect(parseAdminTvAck(ack, record, command)).not.toHaveProperty("channel");
    for (const value of [
      { ...ack, id: actorId },
      { ...ack, status: "ACTIVE" },
      { ...ack, disabledAt: null },
      { ...ack, updatedAt: stamp },
    ])
      expect(() => parseAdminTvAck(value, record, command)).toThrow();
  });
  it("resolves Operations authority before any TV read and rejects identity change after facts", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ ...actor, roles: ["FINANCE_MANAGER"] }));
    vi.stubGlobal("fetch", fetch);
    await expect(getAdminTv(filters, new AbortController().signal)).rejects.toBeInstanceOf(
      AdminTvError,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch
      .mockReset()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response(directory()))
      .mockResolvedValueOnce(response({ ...actor, accountId: tvId }));
    await expect(getAdminTv(filters, new AbortController().signal)).rejects.toMatchObject({
      status: 403,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("bounds the entire role/data/recheck read and aborts pending work", async () => {
    vi.useFakeTimers();
    let pendingSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(actor))
        .mockImplementationOnce(
          (_url, init) =>
            new Promise((_resolve, reject) => {
              pendingSignal = init.signal;
              init.signal.addEventListener("abort", () => reject(new Error("aborted")));
            }),
        ),
    );
    const pending = getAdminTv(filters, new AbortController().signal),
      rejected = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(15001);
    await rejected;
    expect(pendingSignal?.aborted).toBe(true);
  });
  it("accepts only the actual smaller ACK without automatic reread or replay after uncertain response", async () => {
    const record = parseAdminTv(row()),
      command = { status: "OFF_AIR" as const, reason: "Actual explicit off-air decision" };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(
        response({
          id: tvId,
          name: "Actual TV",
          status: "OFF_AIR",
          disabledAt: null,
          updatedAt: "2026-10-03T00:00:01Z",
        }),
      );
    vi.stubGlobal("fetch", fetch);
    expect((await saveAdminTv(actor, record, command, new AbortController().signal)).status).toBe(
      "OFF_AIR",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toMatchObject({ expectedUpdatedAt: stamp });
    fetch
      .mockReset()
      .mockResolvedValueOnce(response(actor))
      .mockRejectedValueOnce(new Error("lost actual response"));
    await expect(
      saveAdminTv(actor, record, command, new AbortController().signal),
    ).rejects.toMatchObject({ status: 0, writeStarted: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("offers exact step-up once without replay and preserves ordinary403 as denial", async () => {
    const verify = vi.fn(async () => false),
      unregister = registerAdminVerification(verify);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ error: { code: "STEP_UP_REQUIRED" } }, 403));
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(
        saveAdminTv(
          actor,
          parseAdminTv(row()),
          { status: "DISABLED", reason: "Actual reviewed decision" },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ verificationRequired: true, writeStarted: true });
      expect(verify).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(2);
      fetch
        .mockReset()
        .mockResolvedValueOnce(response(actor))
        .mockResolvedValueOnce(response({ error: { code: "FORBIDDEN" } }, 403));
      await expect(
        saveAdminTv(
          actor,
          parseAdminTv(row()),
          { status: "DISABLED", reason: "Actual reviewed decision" },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ status: 403, verificationRequired: false });
      expect(verify).toHaveBeenCalledTimes(1);
    } finally {
      unregister();
    }
  });
  it("reviews only the original target, handles missing records and rechecks identity without writes", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ message: "missing" }, 404))
      .mockResolvedValueOnce(response(actor));
    vi.stubGlobal("fetch", fetch);
    expect(await reviewAdminTv(actor, tvId, new AbortController().signal)).toBeNull();
    expect(fetch.mock.calls[1]![0]).toContain("/admin/control/tv/" + tvId);
    expect(fetch.mock.calls.every((call) => !call[1].method)).toBe(true);
    fetch
      .mockReset()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ ...row(), id: actorId }));
    await expect(reviewAdminTv(actor, tvId, new AbortController().signal)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
