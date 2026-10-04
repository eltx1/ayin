import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountScopeError, requestAccountScope } from "./account-scope";
const a = "a0000000-0000-4000-8000-000000000001",
  b = "b0000000-0000-4000-8000-000000000002";
const actor = (id = a) => new Response(JSON.stringify({ account: { id } }));
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const decode = (value: unknown) => {
  if (!value || typeof value !== "object" || (value as { changed?: unknown }).changed !== true)
    throw Error("Invalid ACK");
  return { changed: true };
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("actual account scope transport", () => {
  it("reads with fresh pre/post identity and an exact protected scope header", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(actor())
      .mockResolvedValueOnce(json({ fact: 1 }))
      .mockResolvedValueOnce(actor());
    vi.stubGlobal("fetch", fetcher);
    expect(
      await requestAccountScope("/auth/sessions", "GET", (value) => value, {
        expectedAccountId: a,
      }),
    ).toEqual({ accountId: a, value: { fact: 1 } });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { "x-ayin-expected-account": a },
    });
  });
  it("sends one exact JSON command with the verified account and no replay", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(actor())
      .mockResolvedValueOnce(json({ changed: true }))
      .mockResolvedValueOnce(actor());
    vi.stubGlobal("fetch", fetcher);
    await requestAccountScope(
      "/auth/password/change",
      "POST",
      decode,
      { expectedAccountId: a },
      { currentPassword: "exact", newPassword: "new" },
    );
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      headers: { "x-ayin-expected-account": a, "content-type": "application/json" },
      body: '{"currentPassword":"exact","newPassword":"new"}',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("account switch before the command makes zero protected requests", async () => {
    const fetcher = vi.fn().mockResolvedValue(actor(b));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      requestAccountScope("/auth/password/change", "POST", decode, { expectedAccountId: a }),
    ).rejects.toMatchObject({ code: "ACCOUNT_CHANGED", writeStarted: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("post-read account switch drops all prior private facts", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(actor())
      .mockResolvedValueOnce(json({ privateFact: "old account" }))
      .mockResolvedValueOnce(actor(b));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      requestAccountScope("/auth/sessions", "GET", (value) => value),
    ).rejects.toMatchObject({ code: "ACCOUNT_CHANGED", acknowledged: false });
  });
  it("post-command account switch retains known acknowledgment without returning old private data", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(actor())
      .mockResolvedValueOnce(json({ changed: true }))
      .mockResolvedValueOnce(actor(b));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      requestAccountScope("/auth/password/change", "POST", decode),
    ).rejects.toMatchObject({ code: "ACCOUNT_CHANGED", writeStarted: true, acknowledged: true });
  });
  for (const malformed of [true, false])
    it(
      "lost or malformed command response remains unknown without replay " + malformed,
      async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(actor());
        if (malformed) fetcher.mockResolvedValueOnce(json({ changed: false }));
        else fetcher.mockRejectedValueOnce(Error("Lost response"));
        vi.stubGlobal("fetch", fetcher);
        await expect(
          requestAccountScope("/auth/password/change", "POST", decode),
        ).rejects.toMatchObject({
          code: "RESPONSE_UNCONFIRMED",
          writeStarted: true,
          acknowledged: false,
        });
        expect(fetcher).toHaveBeenCalledTimes(2);
      },
    );
  it("does not surface raw server errors while preserving safe status and code", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          json({ error: { code: "ACCOUNT_CHANGED", message: "private server secret" } }, 409),
        ),
    );
    try {
      await requestAccountScope("/auth/sessions", "GET", (value) => value);
      expect.fail("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(AccountScopeError);
      expect(error).toMatchObject({ status: 409, code: "ACCOUNT_CHANGED" });
      expect(String(error)).not.toContain("secret");
    }
  });
  it("only a decoded actual current-session logout skips the post-actor request", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(actor())
      .mockResolvedValueOnce(json({ currentSessionRevoked: true }));
    vi.stubGlobal("fetch", fetcher);
    await requestAccountScope("/auth/sessions/" + a, "DELETE", (value) => value, {
      allowCurrentLogout: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("whole read deadline includes actor work", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener("abort", () => reject(Error("aborted")), {
              once: true,
            });
          }),
      ),
    );
    const pending = requestAccountScope("/auth/sessions", "GET", (value) => value);
    const assertion = expect(pending).rejects.toMatchObject({
      code: "RESPONSE_UNCONFIRMED",
      writeStarted: false,
    });
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
  });
  it("rejects unsafe requests and logout exceptions before any network call", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const path of ["https://evil.example", "//evil.example", "/admin/control/users"])
      await expect(requestAccountScope(path, "GET", (value) => value)).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
    await expect(
      requestAccountScope("/auth/password/change", "POST", decode, { allowCurrentLogout: true }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      requestAccountScope("/auth/sessions", "GET", (value) => value, {
        expectedAccountId: "invalid",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("whole write deadline includes response body parsing", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(actor())
      .mockImplementationOnce((_url: string, options: RequestInit) =>
        Promise.resolve({
          ok: true,
          json: () =>
            new Promise((_resolve, reject) => {
              options.signal?.addEventListener("abort", () => reject(Error("body aborted")), {
                once: true,
              });
            }),
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const pending = requestAccountScope("/auth/password/change", "POST", decode);
    const assertion = expect(pending).rejects.toMatchObject({
      code: "RESPONSE_UNCONFIRMED",
      writeStarted: true,
      acknowledged: false,
    });
    await vi.advanceTimersByTimeAsync(30000);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("bodyless DELETE stays bodyless with no JSON content type", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(actor())
      .mockResolvedValueOnce(json({ changed: true }))
      .mockResolvedValueOnce(actor());
    vi.stubGlobal("fetch", fetcher);
    await requestAccountScope("/auth/sessions/" + a, "DELETE", decode);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: "DELETE",
      headers: { "x-ayin-expected-account": a },
    });
    expect(fetcher.mock.calls[1]?.[1].body).toBeUndefined();
    expect(fetcher.mock.calls[1]?.[1].headers["content-type"]).toBeUndefined();
  });
});
