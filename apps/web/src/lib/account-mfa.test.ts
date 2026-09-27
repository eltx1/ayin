import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MfaRequestError,
  parseMfaCodes,
  parseMfaEnrollment,
  parseMfaStatus,
  requestMfa,
} from "./account-mfa";
const accountId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const codes = Array.from(
  { length: 10 },
  (_, index) => `AAAA-BBBB-CCCC-DDD${String.fromCharCode(65 + index)}`,
);
afterEach(() => vi.unstubAllGlobals());
describe("account MFA transport and data boundaries", () => {
  it("requires truthful status fields instead of inventing empty state", () => {
    const status = {
      accountId,
      enabled: true,
      required: false,
      enabledAt: null,
      recoveryCodesRemaining: 0,
    };
    expect(parseMfaStatus(status)).toEqual(status);
    for (const invalid of [
      undefined,
      { ...status, enabled: "true" },
      { ...status, recoveryCodesRemaining: -1 },
      { ...status, recoveryCodesRemaining: 11 },
      { ...status, accountId: "" },
    ])
      expect(() => parseMfaStatus(invalid)).toThrow();
  });
  it("binds setup secrets to the viewed account and permits only an inline PNG", () => {
    const enrollment = {
      accountId,
      enrollmentToken: "x".repeat(40),
      secret: "A".repeat(32),
      qrCodeDataUrl: "data:image/png;base64,aGVsbG8=",
      expiresAt: "2026-09-28T12:00:00.000Z",
    };
    expect(parseMfaEnrollment(enrollment, accountId)).toEqual(enrollment);
    expect(() => parseMfaEnrollment(enrollment, otherId)).toThrow(MfaRequestError);
    expect(() =>
      parseMfaEnrollment({ ...enrollment, qrCodeDataUrl: "https://example.com/key" }, accountId),
    ).toThrow();
  });
  it("validates one-time codes from confirmation and regeneration without accepting a different account", () => {
    expect(parseMfaCodes({ accountId, recoveryCodes: codes }, accountId)).toEqual(codes);
    expect(
      parseMfaCodes({ user: { account: { id: accountId } }, recoveryCodes: codes }, accountId),
    ).toEqual(codes);
    expect(() => parseMfaCodes({ accountId: otherId, recoveryCodes: codes }, accountId)).toThrow(
      MfaRequestError,
    );
    expect(() =>
      parseMfaCodes({ accountId, recoveryCodes: Array(10).fill(codes[0]) }, accountId),
    ).toThrow();
  });
  it("reads status without caching and forwards cancellation and credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: false })));
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    await requestMfa("status", controller.signal);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\/auth\/mfa\/status$/), {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
  });
  it("keeps scoped mutations explicit and never replays rejected authorization", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: "ACCOUNT_CHANGED", message: "Account changed" } }),
          { status: 409 },
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const body = { expectedAccountId: accountId, password: "fixture", code: "123456" };
    await expect(requestMfa("disable", new AbortController().signal, body)).rejects.toMatchObject({
      status: 409,
      code: "ACCOUNT_CHANGED",
      message: "Account changed",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify(body),
    });
  });
});
