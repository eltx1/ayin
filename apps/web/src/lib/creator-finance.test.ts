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
      )
      .mockResolvedValueOnce(Response.json(identity));
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveCreatorFinance(snapshot, { kind: "payout" }, new AbortController().signal),
    ).rejects.toMatchObject({ writeStarted: true });
    expect(fetch).toHaveBeenCalledTimes(3);
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
    expect(await observed).toMatchObject({ status: 0, writeStarted: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("allow-lists a valid owned profile without encrypted destination or provider token metadata", () => {
    const profile = parseFinanceProfile(
      {
        id: foreignId,
        channelId,
        legalName: "Actual Owner",
        preferredCurrency: "USD",
        provider: "MANUAL",
        destinationMask: "****1234",
        countryCode: null,
        identityStatus: "NOT_STARTED",
        taxStatus: "NOT_STARTED",
        payoutDestinationStatus: "PENDING",
        complianceProvider: null,
        complianceLastCheckedAt: null,
        hasDestination: true,
        createdAt: "2026-10-03T00:00:00Z",
        updatedAt: "2026-10-03T00:00:00Z",
        destinationEncrypted: "private",
        providerDestinationTokenEncrypted: "private-token",
      },
      channelId,
    );
    expect(profile.destinationMask).toBe("****1234");
    expect(profile).not.toHaveProperty("destinationEncrypted");
    expect(profile).not.toHaveProperty("providerDestinationTokenEncrypted");
    expect(() => parseFinanceCompliance({ channelId: foreignId }, channelId)).toThrow();
  });
  const payoutAck = {
    requestSource: "CREATOR",
    payout: { id: foreignId, channelId, currency: "USD", amount: "12.000000", status: "PENDING" },
  };
  it("binds the protected command and post-actor read to the actual captured account", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(identity))
      .mockResolvedValueOnce(Response.json(payoutAck))
      .mockResolvedValueOnce(Response.json(identity));
    vi.stubGlobal("fetch", fetch);
    expect(
      await saveCreatorFinance(snapshot, { kind: "payout" }, new AbortController().signal),
    ).toMatchObject({ kind: "payout", amount: "12.000000" });
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const call of fetch.mock.calls)
      expect(new Headers(call[1]?.headers).get("x-ayin-expected-account")).toBe(accountId);
    expect(fetch.mock.calls[1]?.[1]?.body).toBe('{"currency":"USD"}');
  });
  it("identifies protected server scope rejection after pre-read without replay", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(identity))
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: "ACCOUNT_CHANGED", message: "private untrusted detail" } },
          { status: 409 },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveCreatorFinance(snapshot, { kind: "payout" }, new AbortController().signal),
    ).rejects.toMatchObject({
      status: 409,
      scopeChanged: true,
      writeStarted: true,
      acknowledged: false,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("retains known write acknowledgment when post-actor scope changes without returning old private facts", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(identity))
      .mockResolvedValueOnce(Response.json(payoutAck))
      .mockResolvedValueOnce(Response.json({ ...identity, account: { id: foreignId } }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveCreatorFinance(snapshot, { kind: "payout" }, new AbortController().signal),
    ).rejects.toMatchObject({
      status: 403,
      scopeChanged: true,
      writeStarted: true,
      acknowledged: true,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("does not relabel a decoded write as uncertain when a separate post-actor read is unavailable", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(identity))
      .mockResolvedValueOnce(Response.json(payoutAck))
      .mockResolvedValueOnce(Response.json({}, { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveCreatorFinance(snapshot, { kind: "payout" }, new AbortController().signal),
    ).rejects.toMatchObject({
      status: 503,
      scopeChanged: false,
      writeStarted: true,
      acknowledged: true,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("a lost actual command response remains unacknowledged and never replays", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(identity))
      .mockRejectedValueOnce(new TypeError("controlled lost response"));
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveCreatorFinance(snapshot, { kind: "payout" }, new AbortController().signal),
    ).rejects.toMatchObject({ status: 0, writeStarted: true, acknowledged: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("binds statement read/post-actor requests and drops data after cookie scope changes", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(identity))
      .mockResolvedValueOnce(
        Response.json({
          format: "CSV",
          channel: { id: channelId, name: "Actual", handle: "actual" },
          filename: "actual.csv",
          generatedAt: "2026-10-03T00:00:00Z",
          content: "private",
        }),
      )
      .mockResolvedValueOnce(Response.json({ ...identity, account: { id: foreignId } }));
    vi.stubGlobal("fetch", fetch);
    await expect(getFinanceStatement(snapshot, new AbortController().signal)).rejects.toMatchObject(
      { scopeChanged: true },
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const call of fetch.mock.calls)
      expect(new Headers(call[1]?.headers).get("x-ayin-expected-account")).toBe(accountId);
  });
});
