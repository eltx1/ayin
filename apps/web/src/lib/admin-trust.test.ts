import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAdminVerification } from "./admin-reauthentication";
import {
  AdminTrustError,
  adminActionInput,
  getAdminTrust,
  parseAdminTrustQueue,
  parseAdminTrustSettings,
  parseTrustRecord,
  readTrustRecord,
  saveAdminTrust,
} from "./admin-trust";
const id = "abcdefab-cdef-4abc-8abc-abcdefabcdef",
  actor = "00000000-0000-4000-8000-000000000002",
  at = "2026-10-03T05:00:00.000Z";
const report = {
  id,
  status: "OPEN",
  reason: "COPYRIGHT",
  details: "Full report text",
  videoId: null,
  commentId: null,
  channelId: null,
  createdAt: at,
};
const queue = { reports: [report], cases: [], takedowns: [], appeals: [] };
const settings = { blockedTerms: [], newCreatorsRequireReview: false };
const session = { accountId: actor, roles: ["CONTENT_MODERATOR"] };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Admin Trust bounded records and requests", () => {
  it("preserves actual nulls/false/empty settings and strips diagnostic fields", () => {
    expect(parseAdminTrustSettings(settings)).toEqual(settings);
    expect(
      parseAdminTrustQueue({ ...queue, reports: [{ ...report, internalToken: "never display" }] })
        .reports,
    ).toEqual([report]);
  });
  it("rejects malformed/terminal queue rows, duplicates and over-bound snapshots", () => {
    for (const rows of [
      [{ ...report, status: "RESOLVED" }],
      [{ ...report, videoId: "foreign" }],
      [report, report],
      Array(251).fill(report),
    ])
      expect(() => parseAdminTrustQueue({ ...queue, reports: rows })).toThrow();
    expect(() =>
      parseAdminTrustSettings({ blockedTerms: [5], newCreatorsRequireReview: false }),
    ).toThrow();
  });
  it("checks appeal-to-action identity while retaining complete reasons", () => {
    const action = {
      id,
      kind: "WARN",
      reason: "Actual original reason",
      targetAccountId: actor,
      channelId: null,
      videoId: null,
      createdAt: at,
    };
    const appeal = {
      id: actor,
      actionId: id,
      status: "OPEN",
      message: "Actual full appeal explanation",
      createdAt: at,
      action,
    };
    expect(parseAdminTrustQueue({ ...queue, appeals: [appeal] }).appeals[0]?.message).toBe(
      appeal.message,
    );
    expect(() =>
      parseAdminTrustQueue({ ...queue, appeals: [{ ...appeal, actionId: actor }] }),
    ).toThrow();
  });
  it("correlates terminal/current record and accepts real zero/false channel state", () => {
    expect(
      parseTrustRecord(
        {
          kind: "cases",
          id,
          record: { id, status: "CLOSED", resolution: "Actual reviewed evidence", updatedAt: at },
        },
        { kind: "cases", id },
      ).state,
    ).toBe("CLOSED");
    expect(() =>
      parseTrustRecord(
        {
          kind: "cases",
          id: actor,
          record: { id, status: "CLOSED", resolution: null, updatedAt: at },
        },
        { kind: "cases", id },
      ),
    ).toThrow();
    expect(
      parseTrustRecord(
        {
          kind: "channels",
          id,
          record: {
            channelId: id,
            level: "STANDARD",
            strikeCount: 0,
            reviewRequired: false,
            updatedAt: at,
          },
        },
        { kind: "channels", id },
      ).reviewRequired,
    ).toBe(false);
  });
  it("requires actual resource references and reasons and normalizes UUID case", () => {
    expect(
      adminActionInput({
        kind: "WARN",
        reason: "  Actual review reason  ",
        targetAccountId: id.toUpperCase(),
      }),
    ).toEqual({ kind: "WARN", reason: "Actual review reason", targetAccountId: id });
    for (const body of [
      { kind: "WARN", reason: "Long enough reason" },
      { kind: "SUSPEND_ACCOUNT", reason: "Long enough reason", channelId: id },
      { kind: "REMOVE_VIDEO", reason: "short", videoId: id },
      { kind: "UNKNOWN", reason: "Long enough reason", videoId: id },
    ])
      expect(() => adminActionInput(body)).toThrow();
  });
  it("resolves role first, issues no protected queue reads for unrelated staff", async () => {
    const fetch = vi.fn(async () => Response.json({ ...session, roles: ["FINANCE_MANAGER"] }));
    vi.stubGlobal("fetch", fetch);
    await expect(getAdminTrust(new AbortController().signal)).rejects.toMatchObject({
      status: 403,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rechecks the actual identity and refuses a mixed-account snapshot", async () => {
    let sessions = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/admin/session"))
          return Response.json({ ...session, accountId: ++sessions === 1 ? actor : id });
        if (url.endsWith("/queue")) return Response.json(queue);
        if (url.endsWith("/settings")) return Response.json(settings);
        return Response.json({ actions: [] });
      }),
    );
    await expect(getAdminTrust(new AbortController().signal)).rejects.toMatchObject({
      status: 401,
    });
  });
  it("bounds stalled reads and never retries a malformed write acknowledgment", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          ),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const result = getAdminTrust(new AbortController().signal);
    const check = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(15001);
    await check;
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    const writes = vi.fn(async (url: string) =>
      url.endsWith("/admin/session")
        ? Response.json(session)
        : Response.json({
            id,
            actorAccountId: id,
            kind: "WARN",
            reason: "Actual review reason",
            targetAccountId: id,
          }),
    );
    vi.stubGlobal("fetch", writes);
    await expect(
      saveAdminTrust(
        "/admin/trust/actions",
        "POST",
        { kind: "WARN", reason: "Actual review reason", targetAccountId: id },
        actor,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect(writes).toHaveBeenCalledTimes(2);
  });
  it("represents a protected404 read as absence without assuming the write was not committed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 })),
    );
    expect(
      await readTrustRecord({ kind: "cases", id }, new AbortController().signal),
    ).toMatchObject({ state: "NOT_FOUND", updatedAt: null, id });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 })),
    );
    await expect(
      readTrustRecord({ kind: "cases", id }, new AbortController().signal),
    ).rejects.toBeInstanceOf(AdminTrustError);
  });
});

it("refuses a stale actor before sending a protected mutation", async () => {
  const fetch = vi.fn(async () => Response.json({ ...session, accountId: id }));
  vi.stubGlobal("fetch", fetch);
  await expect(
    saveAdminTrust(
      "/admin/trust/actions",
      "POST",
      { kind: "WARN", reason: "Actual review reason", targetAccountId: id },
      actor,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ status: 401, writeStarted: false });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("preserves explicit step-up rejection and dispatches verification once without replay or queue reads", async () => {
  const verification = vi.fn(),
    dispose = registerAdminVerification(verification);
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(session))
    .mockResolvedValueOnce(Response.json({ error: { code: "STEP_UP_REQUIRED" } }, { status: 403 }));
  vi.stubGlobal("fetch", fetch);
  try {
    await expect(
      saveAdminTrust(
        "/admin/trust/actions",
        "POST",
        { kind: "WARN", targetAccountId: actor, reason: "Actual retained warning reason" },
        actor,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 403, writeStarted: true, verificationRequired: true });
    expect(verification).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[1]?.method).toBe("POST");
  } finally {
    dispose();
  }
});
