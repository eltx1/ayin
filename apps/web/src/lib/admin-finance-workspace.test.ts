import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAdminVerification } from "./admin-reauthentication";
import {
  financeBps,
  financeManualPayoutChoices,
  financeInputAmount,
  financeMicros,
  getFinanceActions,
  parseFinanceActions,
  parseFinanceContract,
  saveAdminFinance,
  financeReportInput,
} from "./admin-finance-workspace";
const accountId = "00000000-0000-4000-8000-000000000001",
  channelId = "00000000-0000-4000-8000-000000000002",
  foreignId = "00000000-0000-4000-8000-000000000003";
const actor = { accountId, roles: ["FINANCE_MANAGER" as const] };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Protected financial administration", () => {
  it("offers only server-supported manual transitions and never reopens a terminal payout", () => {
    expect(financeManualPayoutChoices("PENDING")).toEqual(["PENDING", "PROCESSING", "CANCELLED"]);
    expect(financeManualPayoutChoices("PROCESSING")).toEqual([
      "PROCESSING",
      "PAID",
      "FAILED",
      "CANCELLED",
    ]);
    for (const terminal of ["PAID", "FAILED", "CANCELLED"] as const)
      expect(financeManualPayoutChoices(terminal)).toEqual([terminal]);
  });

  it("distinguishes explicit zero from blank share and preserves large six-decimal signed amounts without Number", () => {
    expect(financeBps("0")).toBe(0);
    for (const value of ["", " ", "NaN", "1e2", "-1", "10001"])
      expect(() => financeBps(value)).toThrow();
    expect(financeMicros("9007199254740993.123456")).toBe(9007199254740993123456n);
    expect(financeMicros("-0.000001")).toBe(-1n);
    expect(financeInputAmount("99999999999999.123456")).toBe("99999999999999.123456");
    for (const value of ["", "1e9", "9007199254740993", "1.0000001", "-1"])
      expect(() => financeInputAmount(value)).toThrow();
  });
  it("retains inherited null contract share separately from an explicit zero and rejects a foreign channel", () => {
    const contract = {
      id: foreignId,
      channelId,
      status: "ACTIVE",
      revenueShareBps: null,
      effectiveFrom: null,
      effectiveTo: null,
      termsVersion: null,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
    };
    expect(parseFinanceContract(contract, channelId).revenueShareBps).toBeNull();
    expect(
      parseFinanceContract({ ...contract, revenueShareBps: 0 }, channelId).revenueShareBps,
    ).toBe(0);
    expect(() => parseFinanceContract(contract, foreignId)).toThrow();
  });
  it("checks the actual role/actor before writes and sends no mutation after an identity change", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ...actor, accountId: foreignId }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveAdminFinance(
        { kind: "payout", channelId, currency: "USD" },
        actor,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 403, writeStarted: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.method).toBeUndefined();
  });
  it("retains an uncertain foreign payout acknowledgment and sends no automatic reread or replay", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(actor))
      .mockResolvedValueOnce(
        Response.json({
          id: foreignId,
          channelId: foreignId,
          status: "PENDING",
          amount: "1.123456",
          currency: "USD",
          provider: "MANUAL",
          requestedAt: "2026-10-01T00:00:00Z",
          processedAt: null,
          paidAt: null,
          externalReference: null,
          failureReason: null,
          requestSource: "ADMIN",
        }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveAdminFinance(
        { kind: "payout", channelId, currency: "USD" },
        actor,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ writeStarted: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[1]?.method).toBe("POST");
  });
  it("verifies import count acknowledgment while preserving the original stable idempotency key", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(actor))
      .mockResolvedValueOnce(Response.json({ created: 0, duplicates: 1, requested: 1 }))
      .mockResolvedValueOnce(Response.json(actor));
    vi.stubGlobal("fetch", fetch);
    const input = {
      source: "ACTUAL_REPORT",
      entries: [
        {
          channelId,
          idempotencyKey: "stable-retained-key",
          grossAmount: "0.000000",
          currency: "USD",
          state: "FINAL" as const,
          periodStart: "2026-10-01T00:00:00Z",
          periodEnd: "2026-10-02T00:00:00Z",
        },
      ] as [
        {
          channelId: string;
          idempotencyKey: string;
          grossAmount: string;
          currency: string;
          state: "FINAL";
          periodStart: string;
          periodEnd: string;
        },
      ],
    };
    await expect(
      saveAdminFinance({ kind: "import", input }, actor, new AbortController().signal),
    ).resolves.toEqual({ kind: "import", record: { created: 0, duplicates: 1, requested: 1 } });
    expect(JSON.parse(fetch.mock.calls[1]?.[1]?.body).entries[0].idempotencyKey).toBe(
      "stable-retained-key",
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("rejects foreign actor ledgers and role changes after explicit recovery reads", async () => {
    expect(() =>
      parseFinanceActions({ actorAccountId: foreignId, limit: 100, items: [] }, accountId),
    ).toThrow();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(actor))
      .mockResolvedValueOnce(Response.json({ actorAccountId: accountId, limit: 100, items: [] }))
      .mockResolvedValueOnce(Response.json({ accountId, roles: ["OPERATIONS"] }));
    vi.stubGlobal("fetch", fetch);
    await expect(getFinanceActions(actor, new AbortController().signal)).rejects.toMatchObject({
      status: 403,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("keeps step-up rejection distinct from revoked authority, invokes verification once and never replays", async () => {
    const verify = vi.fn(),
      unregister = registerAdminVerification(verify);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(actor))
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: "STEP_UP_REQUIRED", message: "Verification required" } },
          { status: 403 },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(
        saveAdminFinance(
          {
            kind: "adjustment",
            input: {
              channelId,
              amount: "-0.000001",
              currency: "USD",
              reason: "Actual retained decision reason",
            },
          },
          actor,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ status: 403, writeStarted: true, verificationRequired: true });
      expect(verify).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      unregister();
    }
  });
  it("aborts a sent write after30 seconds and keeps its outcome uncertain without replay or timers", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(actor))
      .mockImplementationOnce(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            ),
          ),
      );
    vi.stubGlobal("fetch", fetch);
    const result = expect(
      saveAdminFinance(
        {
          kind: "settings",
          input: { defaultCreatorRevenueShareBps: 0, payoutThresholdMicros: "0" },
        },
        actor,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 0, writeStarted: true });
    await vi.advanceTimersByTimeAsync(30001);
    await result;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("validates structured source report rows and rejects arbitrary metadata before sending an import", () => {
    const input = {
      source: "Actual source",
      sourceReportId: "retained-reference",
      periodStart: "2026-10-01T00:00:00Z",
      periodEnd: "2026-10-02T00:00:00Z",
      currency: "USD",
      state: "FINAL" as const,
      format: "STRUCTURED" as const,
      rows: [{ externalRowId: "actual-row", grossAmount: "0.000000", channelId }],
    };
    expect(financeReportInput(input)).toEqual(input);
    const untrusted = { ...input, rows: [{ ...input.rows[0]!, providerSecret: "must not pass" }] };
    expect(() => financeReportInput(untrusted)).toThrow();
    expect(() =>
      financeReportInput({ ...input, rows: [{ ...input.rows[0]!, grossAmount: "1e6" }] }),
    ).toThrow();
  });
});
