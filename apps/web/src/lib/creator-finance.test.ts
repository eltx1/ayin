import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CreatorFinanceError,
  exactFinanceMoney,
  financeAmount,
  financeProfileInput,
  getCreatorFinance,
  getFinanceStatement,
  parseFinanceCompliance,
  parseFinanceProfile,
  saveCreatorFinance,
  type FinanceSnapshot,
} from "./creator-finance";
const accountId = "00000000-0000-4000-8000-000000000001",
  channelId = "00000000-0000-4000-8000-000000000002",
  foreignId = "00000000-0000-4000-8000-000000000003";
const identity = { account: { id: accountId }, channel: { id: channelId } };
const snapshot = {
  accountId,
  overview: { channel: { id: channelId }, currency: "USD", canRequestPayout: true },
} as FinanceSnapshot;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Creator finance boundaries", () => {
  it("preserves six-decimal amounts, exact large values, actual zero and negative adjustments", () => {
    expect(exactFinanceMoney("USD", "9007199254740993.123456")).toBe("USD 9007199254740993.123456");
    expect(exactFinanceMoney("USD", "0.000000")).toBe("USD 0.00");
    expect(exactFinanceMoney("EUR", "-0.000001")).toBe("EUR -0.000001");
    for (const value of ["1e6", "NaN", "1.0000001", "", 2])
      expect(() => financeAmount(value)).toThrow();
  });
  it("validates native profile input without turning blank fields into money or changing its provider", () => {
    expect(
      financeProfileInput({
        legalName: " Actual Owner ",
        preferredCurrency: "eur",
        provider: "EXTERNAL_PROVIDER",
        countryCode: "de",
      }),
    ).toEqual({
      legalName: "Actual Owner",
      preferredCurrency: "EUR",
      provider: "EXTERNAL_PROVIDER",
      countryCode: "DE",
    });
    expect(() =>
      financeProfileInput({
        legalName: "x",
        preferredCurrency: "USD",
        provider: "MANUAL",
        destination: "",
        countryCode: null,
      }),
    ).toThrow();
  });
  it("rejects a changed actual identity before a payout write is sent", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ ...identity, account: { id: foreignId } }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveCreatorFinance(snapshot, { kind: "payout" }, new AbortController().signal),
    ).rejects.toMatchObject({ status: 403, writeStarted: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.method).toBeUndefined();
  });
  it("treats a foreign payout acknowledgment after POST as uncertain and never replays", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(identity))
      .mockResolvedValueOnce(
        Response.json({
          requestSource: "CREATOR",
          payout: {
            id: foreignId,
            channelId: foreignId,
            currency: "USD",
            amount: "12.000000",
            status: "PENDING",
          },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveCreatorFinance(snapshot, { kind: "payout" }, new AbortController().signal),
    ).rejects.toMatchObject({ writeStarted: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[1]?.body).toBe('{"currency":"USD"}');
  });
  it("rejects an unowned statement before creating any downloadable content", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(identity))
      .mockResolvedValueOnce(
        Response.json({
          format: "CSV",
          channel: { id: foreignId, name: "Foreign", handle: "foreign" },
          filename: "actual.csv",
          generatedAt: "2026-10-03T00:00:00Z",
          content: "private",
        }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      getFinanceStatement(snapshot, new AbortController().signal),
    ).rejects.toBeInstanceOf(CreatorFinanceError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("bounds an actual stalled finance read without retries", async () => {
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
    const observed = getCreatorFinance(new AbortController().signal).catch((error) => error);
    await vi.advanceTimersByTimeAsync(15000);
    expect((await observed).name).toBe("AbortError");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not accept raw encrypted profile data as a substitute for a validated profile or compliance", () => {
    expect(() =>
      parseFinanceProfile({ channelId, destinationEncrypted: "private" }, channelId),
    ).toThrow();
    expect(() => parseFinanceCompliance({ channelId: foreignId }, channelId)).toThrow();
  });
});
