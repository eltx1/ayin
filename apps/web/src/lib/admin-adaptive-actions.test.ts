import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adaptiveFeedback,
  readAdaptiveOutcome,
  submitAdaptiveAction,
  type AdaptiveAction,
} from "./admin-adaptive-actions";
import { registerAdminVerification } from "./admin-reauthentication";

afterEach(() => vi.unstubAllGlobals());
const orphan: AdaptiveAction = { kind: "recovery", mode: "VERIFIED_HLS_MISSING_DB", batchSize: 2 };
const cursor = "00000000-0000-4000-8000-000000000001";

describe("advanced media action contracts", () => {
  it.each([
    [{ kind: "pause" }, "backfill/pause", undefined, { backfillPaused: true }],
    [{ kind: "resume" }, "backfill/resume", undefined, { backfillPaused: false }],
    [
      { kind: "backfill", batchSize: 2 },
      "backfill/run",
      { batchSize: 2 },
      { enqueued: 1, reason: "ENQUEUED" },
    ],
    [
      orphan,
      "recovery",
      { mode: "VERIFIED_HLS_MISSING_DB", batchSize: 2 },
      {
        mode: "VERIFIED_HLS_MISSING_DB",
        detected: 2,
        requeued: 1,
        scanned: 2,
        hasMore: true,
        nextCursor: null,
      },
    ],
    [
      { ...orphan, cursor },
      "recovery",
      { mode: "VERIFIED_HLS_MISSING_DB", batchSize: 2, cursor },
      {
        mode: "VERIFIED_HLS_MISSING_DB",
        detected: 0,
        requeued: 0,
        scanned: 0,
        hasMore: false,
        nextCursor: null,
      },
    ],
  ])("sends one bounded authenticated request: %j", async (action, path, body, response) => {
    const fetch = vi.fn().mockResolvedValue(Response.json(response));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    await submitAdaptiveAction(action as AdaptiveAction, signal);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining(`/adaptive-rollout/${path}`),
      {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        signal,
        ...(body
          ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
          : {}),
      },
    );
  });
  it("accepts bounded incomplete recovery without inventing a scan cursor", async () => {
    const action: AdaptiveAction = { kind: "recovery", mode: "INCOMPLETE_HLS", batchSize: 2 };
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ mode: "INCOMPLETE_HLS", detected: 2, requeued: 1 }));
    vi.stubGlobal("fetch", fetch);
    expect(await submitAdaptiveAction(action, new AbortController().signal)).toEqual({
      audited: true,
      detected: 2,
      queued: 1,
    });
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({
      mode: "INCOMPLETE_HLS",
      batchSize: 2,
    });
    expect(() =>
      readAdaptiveOutcome(action, { mode: "INCOMPLETE_HLS", detected: 1, requeued: 2 }),
    ).toThrow();
    expect(() =>
      readAdaptiveOutcome(action, { mode: "INCOMPLETE_HLS", detected: 3, requeued: 1 }),
    ).toThrow();
  });
  it.each([0, 21, 1.5, NaN])("rejects invalid batch %s before sending", async (batchSize) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      submitAdaptiveAction({ kind: "backfill", batchSize }, new AbortController().signal),
    ).rejects.toThrow("1 to 20");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps a null initial cursor resumable when capacity is limited", () => {
    const result = readAdaptiveOutcome(orphan, {
      mode: "VERIFIED_HLS_MISSING_DB",
      detected: 2,
      requeued: 1,
      scanned: 2,
      hasMore: true,
      nextCursor: null,
    });
    expect(result.continuation).toEqual({ cursor: null, hasMore: true });
    expect(adaptiveFeedback(result, false)).toContain("Continue manually");
  });
  it("distinguishes terminal failures from requeued stale jobs", () => {
    const result = readAdaptiveOutcome(
      { kind: "recovery", mode: "STALE_PROCESSING", batchSize: 3 },
      { mode: "STALE_PROCESSING", recovered: 3, requeued: 1, failed: 2 },
    );
    expect(result).toMatchObject({ recovered: 3, queued: 1, failed: 2, audited: true });
    expect(adaptiveFeedback(result, false)).toContain("Marked 2 jobs failed");
  });
  it("does not claim an audit for disabled fast exits", () => {
    const result = readAdaptiveOutcome(
      { kind: "backfill", batchSize: 2 },
      { enqueued: 0, reason: "BACKFILL_DISABLED_OR_PAUSED", jobs: [] },
    );
    expect(result.audited).toBe(false);
    expect(adaptiveFeedback(result, false)).toContain("No action or audit");
    expect(adaptiveFeedback(result, true)).not.toContain("سُجّل الإجراء");
  });
  it.each([
    {},
    { mode: "VERIFIED_HLS_MISSING_DB", detected: 1, requeued: 1, scanned: 1, nextCursor: null },
    {
      mode: "VERIFIED_HLS_MISSING_DB",
      detected: -1,
      requeued: 1,
      scanned: 1,
      nextCursor: null,
      hasMore: false,
    },
  ])("rejects unverifiable success bodies", (body) => {
    expect(() => readAdaptiveOutcome(orphan, body)).toThrow("Unable to verify");
  });
  it("requests step-up once without replay", async () => {
    const verify = vi.fn();
    const unregister = registerAdminVerification(verify);
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { code: "STEP_UP_REQUIRED", message: "Verify again" } },
          { status: 403 },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(
        submitAdaptiveAction({ kind: "pause" }, new AbortController().signal),
      ).rejects.toThrow("Verify again");
      expect(verify).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      unregister();
    }
  });
  it("does not replay ambiguous network errors", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Network unavailable"));
    vi.stubGlobal("fetch", fetch);
    await expect(submitAdaptiveAction(orphan, new AbortController().signal)).rejects.toThrow(
      "Network unavailable",
    );
    expect(fetch).toHaveBeenCalledOnce();
  });
});
