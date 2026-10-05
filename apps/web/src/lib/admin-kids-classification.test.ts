import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classificationCommand,
  parseKidsPolicy,
  readKidsPolicy,
  saveKidsClassification,
} from "./admin-kids-classification";
const target = "00000000-0000-4000-8000-000000000001",
  actorId = "00000000-0000-4000-8000-000000000002";
const actor = { accountId: actorId, roles: ["CONTENT_MODERATOR" as const] };
const command = {
  maturityLevel: "GENERAL" as const,
  ageRestriction: "NONE" as const,
  kidsEligible: true,
  reason: " Reviewed for Kids ",
};
const value = () => ({
  videoId: target,
  policy: { maturityLevel: null, ageRestriction: "NONE", kidsEligible: false },
});
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Kids policy actor and target boundaries", () => {
  it("keeps absent classification fail-closed and rejects malformed or cross-target facts", () => {
    expect(parseKidsPolicy(value(), target)).toEqual({
      videoId: target,
      maturityLevel: null,
      ageRestriction: "NONE",
      kidsEligible: false,
    });
    for (const input of [
      null,
      { ...value(), videoId: actorId },
      { ...value(), policy: { ...value().policy, kidsEligible: "false" } },
      { ...value(), policy: { ...value().policy, maturityLevel: "unknown" } },
      { ...value(), policy: { ...value().policy, kidsEligible: true } },
    ])
      expect(() => parseKidsPolicy(input, target)).toThrow();
  });
  it("validates the actual 5–1000 character server reason and strips unrelated policy values", () => {
    expect(
      classificationCommand({ ...command, rightsExpiresAt: "2050-01-01" } as typeof command),
    ).toEqual({ ...command, reason: command.reason.trim() });
    for (const reason of ["1234", " ", "x".repeat(1001)])
      expect(() => classificationCommand({ ...command, reason })).toThrow();
    expect(() => classificationCommand({ ...command, maturityLevel: "TEEN" })).toThrow();
    expect(() => classificationCommand({ ...command, ageRestriction: "AGE_18_PLUS" })).toThrow();
    expect(classificationCommand({ ...command, reason: "x".repeat(1000) }).reason).toHaveLength(
      1000,
    );
  });
  it("binds explicit policy reads to the same actor before and after using uncached abortable transport", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response(value()))
      .mockResolvedValueOnce(response(actor));
    vi.stubGlobal("fetch", fetch);
    await expect(
      readKidsPolicy(actor, target, new AbortController().signal),
    ).resolves.toMatchObject({ videoId: target });
    expect(fetch.mock.calls[1]![0]).toContain("/admin/video-policies/" + target);
    for (const [, options] of fetch.mock.calls)
      expect(options).toMatchObject({
        credentials: "include",
        cache: "no-store",
        signal: expect.any(AbortSignal),
        headers: { "x-ayin-expected-account": actorId },
      });
    fetch
      .mockReset()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response(value()))
      .mockResolvedValueOnce(response({ ...actor, roles: ["OPERATIONS"] }));
    await expect(readKidsPolicy(actor, target, new AbortController().signal)).rejects.toMatchObject(
      { status: 403 },
    );
  });
  it("rejects actor/role changes before any write and denies finance-only access", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const current of [
      { ...actor, accountId: target },
      { ...actor, roles: ["FINANCE_MANAGER"] },
    ]) {
      fetch.mockReset().mockResolvedValueOnce(response(current));
      await expect(
        saveKidsClassification(actor, target, command, new AbortController().signal),
      ).rejects.toMatchObject({ status: 403, writeStarted: false });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it("acknowledges only the exact policy and performs no automatic policy read or replay", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ videoId: target, policy: command }))
      .mockResolvedValueOnce(response(actor));
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveKidsClassification(actor, target, command, new AbortController().signal),
    ).resolves.toMatchObject({ kidsEligible: true });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[1]![1]).toMatchObject({
      method: "PUT",
      headers: { "x-ayin-expected-account": actorId, "content-type": "application/json" },
      body: JSON.stringify({ ...command, reason: command.reason.trim() }),
    });
  });
  it("marks rejected step-up separately and treats lost or mismatched acknowledgments as unconfirmed", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    fetch
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ error: { code: "STEP_UP_REQUIRED" } }, 403));
    await expect(
      saveKidsClassification(actor, target, command, new AbortController().signal),
    ).rejects.toMatchObject({ status: 403, writeStarted: true, verificationRequired: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch
      .mockReset()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ videoId: actorId, policy: command }));
    await expect(
      saveKidsClassification(actor, target, command, new AbortController().signal),
    ).rejects.toMatchObject({ writeStarted: true });
    fetch
      .mockReset()
      .mockResolvedValueOnce(response(actor))
      .mockRejectedValueOnce(new Error("lost response"));
    await expect(
      saveKidsClassification(actor, target, command, new AbortController().signal),
    ).rejects.toMatchObject({ writeStarted: true });
  });
  it("bounds policy reads and propagates cancellation", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            signal = options.signal;
            signal!.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      );
    vi.stubGlobal("fetch", fetch);
    const pending = expect(
      readKidsPolicy(actor, target, new AbortController().signal),
    ).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(15000);
    await pending;
    expect(signal?.aborted).toBe(true);
  });
  it("keeps exact write acknowledgment distinct from failed post-write identity verification", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const status of [503, 409]) {
      fetch
        .mockReset()
        .mockResolvedValueOnce(response(actor))
        .mockResolvedValueOnce(response({ videoId: target, policy: command }))
        .mockResolvedValueOnce(response({}, status));
      await expect(
        saveKidsClassification(actor, target, command, new AbortController().signal),
      ).rejects.toMatchObject({ status, writeStarted: true, acknowledged: true });
      expect(fetch).toHaveBeenCalledTimes(3);
    }
    fetch
      .mockReset()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({}, 409));
    await expect(
      saveKidsClassification(actor, target, command, new AbortController().signal),
    ).rejects.toMatchObject({ status: 409, writeStarted: true, acknowledged: false });
    expect(fetch.mock.calls[1]![1].headers).toEqual({
      "x-ayin-expected-account": actorId,
      "content-type": "application/json",
    });
  });
});
