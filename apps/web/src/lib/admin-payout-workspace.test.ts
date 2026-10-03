import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAdminVerification } from "./admin-reauthentication";
import {
  parsePayoutDetail,
  parsePayoutProvider,
  parsePayoutReveal,
  payoutAmountMicros,
  readPayoutWorkspace,
  writePayoutWorkspace,
} from "./admin-payout-workspace";

const accountId = "00000000-0000-4000-8000-000000000001",
  payoutId = "00000000-0000-4000-8000-000000000002",
  channelId = "00000000-0000-4000-8000-000000000003";
const actor = { accountId, roles: ["FINANCE_MANAGER" as const] };
const detail = {
  payoutId,
  channel: { id: channelId, name: "Actual channel", handle: "actual-channel" },
  status: "PROCESSING",
  provider: "MANUAL",
  amount: "210.000000",
  currency: "USD",
  requestedAt: "2026-10-01T00:00:00Z",
  processedAt: null,
  paidAt: null,
  externalReference: null,
  failureReason: null,
  beneficiarySnapshotAvailable: true,
  destinationRevealAllowed: true,
  paymentProfile: null,
};
const provider = {
  payout: {
    id: payoutId,
    provider: "MANUAL",
    amount: "210",
    currency: "USD",
    status: "PROCESSING",
    externalReference: null,
  },
  capabilities: {
    provider: "NONE",
    connected: false,
    productionEnabled: false,
    idempotentSubmission: false,
    supportsCancellation: false,
    supportsDestinationTokenization: false,
    webhookVerification: "UNSUPPORTED",
    retryPolicy: {
      maxSubmissionAttempts: 0,
      baseDelaySeconds: 0,
      maxDelaySeconds: 0,
      sameIdempotencyKeyAcrossRetries: false,
    },
    paidConfirmation: "STATUS_OR_VERIFIED_WEBHOOK_ONLY",
    rawBankSecretsSentByThisAdapter: false,
  },
  transfer: null,
};
const reveal = {
  payoutId,
  channelId,
  provider: "MANUAL",
  legalName: "Immutable beneficiary",
  countryCode: null,
  destination: "controlled-test-destination",
  destinationMask: "controlled-***",
  sensitive: true,
  cacheable: false,
};
const snapshot = () => ({
  actor,
  detail: parsePayoutDetail(detail, payoutId),
  provider: parsePayoutProvider(provider, detail),
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Private payout workspace", () => {
  it("correlates equivalent exact SQL and Prisma money, with huge and negative micro amounts", () => {
    expect(parsePayoutProvider(provider, detail).payout.amount).toBe("210");
    expect(payoutAmountMicros("9007199254740993.123456")).toBe(9007199254740993123456n);
    expect(payoutAmountMicros("-0.000001")).toBe(-1n);
    expect(() =>
      parsePayoutProvider(
        { ...provider, payout: { ...provider.payout, amount: "210.000001" } },
        detail,
      ),
    ).toThrow();
    expect(() => payoutAmountMicros("1e2")).toThrow();
  });
  it("keeps absent transfers and real zero capability limits distinct and rejects foreign correlated facts", () => {
    const parsed = parsePayoutProvider(provider, detail);
    expect(parsed.transfer).toBeNull();
    expect(parsed.capabilities.retryPolicy.maxSubmissionAttempts).toBe(0);
    expect(parsed.capabilities.connected).toBe(false);
    expect(() => parsePayoutDetail({ ...detail, payoutId: channelId }, payoutId)).toThrow();
    expect(() =>
      parsePayoutProvider({ ...provider, payout: { ...provider.payout, currency: "EUR" } }, detail),
    ).toThrow();
    expect(() =>
      parsePayoutProvider({ ...provider, transfer: { payoutId: channelId } }, detail),
    ).toThrow();
    expect(() =>
      parsePayoutProvider(
        {
          ...provider,
          capabilities: { ...provider.capabilities, rawBankSecretsSentByThisAdapter: true },
        },
        detail,
      ),
    ).toThrow();
  });
  it("rejects cacheable or foreign reveals and changed immutable beneficiary facts", () => {
    const parsed = snapshot().detail;
    expect(parsePayoutReveal(reveal, parsed).destination).toBe(reveal.destination);
    for (const changed of [
      { cacheable: true },
      { sensitive: false },
      { payoutId: channelId },
      { channelId: accountId },
    ])
      expect(() => parsePayoutReveal({ ...reveal, ...changed }, parsed)).toThrow();
    const withProfile = {
      ...parsed,
      paymentProfile: {
        id: accountId,
        provider: "MANUAL",
        legalName: reveal.legalName,
        destinationMask: reveal.destinationMask,
        countryCode: null,
        hasDestination: true,
      },
    };
    expect(() =>
      parsePayoutReveal({ ...reveal, legalName: "Changed beneficiary" }, withProfile),
    ).toThrow();
  });
  it("checks Finance before any private record read and verifies the same actor after both GETs", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ...actor, roles: ["OPERATIONS"] }));
    vi.stubGlobal("fetch", fetch);
    await expect(readPayoutWorkspace(payoutId, new AbortController().signal)).rejects.toMatchObject(
      { status: 403 },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch
      .mockReset()
      .mockResolvedValueOnce(Response.json(actor))
      .mockResolvedValueOnce(Response.json(detail))
      .mockResolvedValueOnce(Response.json(provider))
      .mockResolvedValueOnce(Response.json({ ...actor, accountId: channelId }));
    await expect(readPayoutWorkspace(payoutId, new AbortController().signal)).rejects.toMatchObject(
      { status: 403 },
    );
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.every(([, init]) => !init?.method && init?.cache === "no-store")).toBe(
      true,
    );
  });
  it("retains a known reveal acknowledgment without a record reread or another mutation", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(actor))
      .mockResolvedValueOnce(Response.json(reveal))
      .mockResolvedValueOnce(Response.json(actor));
    vi.stubGlobal("fetch", fetch);
    await expect(
      writePayoutWorkspace(
        "reveal",
        snapshot(),
        "  inspect actual beneficiary  ",
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ kind: "reveal", value: { destination: reveal.destination } });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[1]?.[0]).toContain(`/payouts/${payoutId}/destination`);
    expect(JSON.parse(fetch.mock.calls[1]?.[1]?.body)).toEqual({
      reason: "inspect actual beneficiary",
    });
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("does not write after a changed actor and retains uncertainty for a lost committed response", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ...actor, accountId: channelId }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      writePayoutWorkspace(
        "reveal",
        snapshot(),
        "inspect beneficiary",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 403, writeStarted: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch
      .mockReset()
      .mockResolvedValueOnce(Response.json(actor))
      .mockRejectedValueOnce(new TypeError("Lost response"));
    await expect(
      writePayoutWorkspace(
        "reveal",
        snapshot(),
        "inspect beneficiary",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 0, writeStarted: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("opens verification exactly once for an explicit pre-handler rejection without replay", async () => {
    const verify = vi.fn(),
      unregister = registerAdminVerification(verify);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(actor))
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: "STEP_UP_REQUIRED", message: "Verify session" } },
          { status: 403 },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(
        writePayoutWorkspace(
          "reveal",
          snapshot(),
          "inspect beneficiary",
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ status: 403, verificationRequired: true, writeStarted: true });
      expect(verify).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      unregister();
    }
  });
  it("aborts the whole read at fifteen seconds and clears timers without retry", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = expect(
      readPayoutWorkspace(payoutId, new AbortController().signal),
    ).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(15000);
    await result;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
