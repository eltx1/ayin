import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAdminVerification } from "./admin-reauthentication";
import {
  AdminUsersError,
  getAdminUsers,
  parseAdminUser,
  parseAdminUserAck,
  parseAdminUsers,
  reviewAdminUser,
  saveAdminUser,
  userCommand,
} from "./admin-users-workspace";
const userId = "00000000-0000-4000-8000-000000000001",
  actorId = "00000000-0000-4000-8000-000000000002",
  stamp = "2026-10-03T00:00:00Z";
const actor = { accountId: actorId, roles: ["OPERATIONS" as const] };
const row = () => ({
  id: userId,
  email: "actual@example.test",
  displayName: "Actual",
  status: "ACTIVE",
  createdAt: stamp,
  updatedAt: stamp,
  emailVerifiedAt: null,
  channelMemberships: [],
});
const filters = { page: 1, query: "", status: "" };
const directory = () => ({ items: [row()], pagination: { page: 1, take: 25, pages: 1, total: 1 } });
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Native account administration boundaries", () => {
  it("retains actual null/zero and only bounded explicit safe account fields", () => {
    const parsed = parseAdminUser({ ...row(), passwordHash: "never-ui", authVersion: 25 });
    expect(parsed.emailVerifiedAt).toBeNull();
    expect(parsed.channelMemberships).toEqual([]);
    expect(parsed).not.toHaveProperty("passwordHash");
    expect(parsed).not.toHaveProperty("authVersion");
    for (const bad of [
      { ...row(), id: "invalid" },
      { ...row(), emailVerifiedAt: "yesterday" },
      { ...row(), status: "REMOVED" },
      { ...row(), channelMemberships: Array(4).fill({}) },
    ])
      expect(() => parseAdminUser(bad)).toThrow();
  });
  it("rejects false count/filter/page rows, duplicates and foreign direct targets", () => {
    for (const value of [
      { ...directory(), items: [row(), row()] },
      { ...directory(), pagination: { page: 2, take: 25, pages: 1, total: 1 } },
      { ...directory(), items: [] },
    ])
      expect(() => parseAdminUsers(value, filters)).toThrow();
    expect(() => parseAdminUsers(directory(), { ...filters, status: "SUSPENDED" })).toThrow();
    expect(() => parseAdminUser(row(), actorId)).toThrow();
    expect(
      parseAdminUsers({ items: [], pagination: { page: 1, take: 25, pages: 1, total: 0 } }, filters)
        .pagination.total,
    ).toBe(0);
  });
  it("validates separate explicit name/status/session commands without inventing empty or closed-state writes", () => {
    const record = parseAdminUser(row());
    expect(userCommand(record, { kind: "name", displayName: " New name " })).toEqual({
      displayName: "New name",
      expectedUpdatedAt: stamp,
    });
    expect(
      userCommand(record, { kind: "status", status: "SUSPENDED", reason: " Reviewed suspension " }),
    ).toEqual({ status: "SUSPENDED", reason: "Reviewed suspension", expectedUpdatedAt: stamp });
    for (const command of [
      { kind: "name", displayName: " " } as const,
      { kind: "sessions", reason: "short" } as const,
      { kind: "status", status: "ACTIVE", reason: "Already active" } as const,
    ])
      expect(() => userCommand(record, command)).toThrow();
    expect(() =>
      userCommand(
        { ...record, status: "CLOSED" },
        { kind: "status", status: "ACTIVE", reason: "Reviewed closed account" },
      ),
    ).toThrow();
  });
  it("checks actual smaller mutation acknowledgments and does not invent update dates for session revocation", () => {
    const record = parseAdminUser(row());
    const ack = parseAdminUserAck(
      {
        id: userId,
        email: record.email,
        displayName: "New name",
        status: "ACTIVE",
        authVersion: 0,
        updatedAt: stamp,
      },
      record,
      { kind: "name", displayName: "New name" },
    );
    expect(ack.authVersion).toBe(0);
    const revoked = parseAdminUserAck(
      {
        id: userId,
        email: record.email,
        displayName: "Actual",
        authVersion: 1,
        sessionsRevoked: true,
      },
      record,
      { kind: "sessions", reason: "Actual revocation" },
    );
    expect(revoked).toMatchObject({ status: null, updatedAt: null, sessionsRevoked: true });
    expect(() =>
      parseAdminUserAck({ ...revoked, id: actorId }, record, {
        kind: "sessions",
        reason: "Actual revocation",
      }),
    ).toThrow();
  });
  it("resolves Operations authority before private GETs and rejects an actor change after directory read", async () => {
    const denied = vi
      .fn()
      .mockResolvedValue(response({ accountId: actorId, roles: ["FINANCE_MANAGER"] }));
    vi.stubGlobal("fetch", denied);
    await expect(getAdminUsers(filters, new AbortController().signal)).rejects.toMatchObject({
      status: 403,
    });
    expect(denied).toHaveBeenCalledTimes(1);
    const changed = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response(directory()))
      .mockResolvedValueOnce(response({ ...actor, accountId: userId }));
    vi.stubGlobal("fetch", changed);
    await expect(getAdminUsers(filters, new AbortController().signal)).rejects.toMatchObject({
      status: 403,
    });
    expect(changed.mock.calls[1]?.[1]).toMatchObject({ credentials: "include", cache: "no-store" });
  });
  it("keeps a known save to one PATCH without any automatic account reread", async () => {
    const record = parseAdminUser(row());
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(
        response({
          id: userId,
          email: record.email,
          displayName: "New name",
          status: "ACTIVE",
          authVersion: 0,
          updatedAt: stamp,
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    expect(
      await saveAdminUser(
        actor,
        record,
        { kind: "name", displayName: "New name" },
        new AbortController().signal,
      ),
    ).toMatchObject({ kind: "name", displayName: "New name" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ displayName: "New name", expectedUpdatedAt: stamp }),
    });
    const changed = vi.fn().mockResolvedValue(response({ ...actor, roles: ["FINANCE_MANAGER"] }));
    vi.stubGlobal("fetch", changed);
    await expect(
      saveAdminUser(
        actor,
        record,
        { kind: "name", displayName: "New name" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 403, writeStarted: false });
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it("never replays lost writes or exact step-up denials; explicit original-target recovery remains GET-only", async () => {
    const record = parseAdminUser(row());
    const lost = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockRejectedValueOnce(new TypeError("Lost response"));
    vi.stubGlobal("fetch", lost);
    await expect(
      saveAdminUser(
        actor,
        record,
        { kind: "sessions", reason: "Actual revocation" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ writeStarted: true });
    expect(lost).toHaveBeenCalledTimes(2);
    const verify = vi.fn(),
      unregister = registerAdminVerification(verify);
    try {
      const stepUp = vi
        .fn()
        .mockResolvedValueOnce(response(actor))
        .mockResolvedValueOnce(response({ error: { code: "STEP_UP_REQUIRED" } }, 403));
      vi.stubGlobal("fetch", stepUp);
      await expect(
        saveAdminUser(
          actor,
          record,
          { kind: "sessions", reason: "Actual revocation" },
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ verificationRequired: true, writeStarted: true });
      expect(stepUp).toHaveBeenCalledTimes(2);
      expect(verify).toHaveBeenCalledTimes(1);
    } finally {
      unregister();
    }
    const review = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ message: "Missing" }, 404))
      .mockResolvedValueOnce(response(actor));
    vi.stubGlobal("fetch", review);
    expect(await reviewAdminUser(actor, userId, new AbortController().signal)).toBeNull();
    expect(review).toHaveBeenCalledTimes(3);
    expect(review.mock.calls[1]?.[0]).toContain("/admin/control/users/" + userId);
  });
  it("bounds the whole read and clears its timer without retry", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init.signal?.addEventListener("abort", () => reject(new AdminUsersError()), {
            once: true,
          }),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const pending = getAdminUsers(filters, new AbortController().signal);
    const rejected = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
