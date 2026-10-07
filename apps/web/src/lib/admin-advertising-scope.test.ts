import { afterEach, describe, expect, it, vi } from "vitest";
import { AdvertisingRequestError, createAdvertisingClient } from "./admin-advertising";
import { createAdminSessionScope } from "./admin-session-scope";
import { registerAdminVerification } from "./admin-reauthentication";
const actor = {
  accountId: "00000000-0000-4000-8000-000000000001",
  sessionId: "00000000-0000-4000-8000-000000000002",
  authVersion: 1,
  roles: ["AD_MANAGER" as const],
};
const target = "00000000-0000-4000-8000-000000000003";
function setup() {
  const scope = createAdminSessionScope();
  const lease = scope.completeRead(scope.beginRead(), actor)!;
  const controller = new AbortController();
  return {
    scope,
    controller,
    client: createAdvertisingClient({
      lease,
      isCurrent: () => scope.getScopeLease() === lease,
      signal: controller.signal,
    }),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const response = (value: unknown) => new Response(JSON.stringify(value));
afterEach(() => vi.unstubAllGlobals());
describe("Advertising editor lease and result fences", () => {
  it("does not dispatch after an old held actor check resumes into a new lease", async () => {
    const h = setup(),
      held = deferred<Response>();
    const fetcher = vi.fn().mockReturnValue(held.promise);
    vi.stubGlobal("fetch", fetcher);
    const pending = h.client.deleteCreative(target);
    h.scope.completeRead(h.scope.beginRead(), { ...actor, sessionId: target });
    held.resolve(response(actor));
    await expect(pending).rejects.toMatchObject({ uncertain: false, identityUnverified: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...actor, accountId: target },
    { ...actor, sessionId: target },
    { ...actor, authVersion: 2 },
    { ...actor, roles: ["FINANCE_MANAGER"] },
  ])("rejects a cookie/session/role change before any write: %j", async (next) => {
    const h = setup(),
      fetcher = vi.fn(async () => response(next));
    vi.stubGlobal("fetch", fetcher);
    await expect(h.client.deleteCreative(target)).rejects.toMatchObject({
      uncertain: false,
      identityUnverified: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("holds an acknowledged response until the original actor is verified again", async () => {
    const h = setup(),
      held = deferred<Response>();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(response({ deleted: true }))
      .mockReturnValueOnce(held.promise);
    vi.stubGlobal("fetch", fetcher);
    let settled = false;
    const pending = h.client.deleteCreative(target).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(settled).toBe(false);
    held.resolve(response({ ...actor, sessionId: target }));
    await expect(pending).rejects.toMatchObject({ uncertain: true, identityUnverified: true });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method)).toHaveLength(1);
  });
  it("never calls a malformed/wrong-target response success or replays it", async () => {
    const h = setup();
    const fetcher = vi.fn(async (url: string) =>
      response(
        url.endsWith("/admin/session") ? actor : { id: actor.accountId, status: "ARCHIVED" },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(h.client.deleteCreative(target)).rejects.toMatchObject({
      uncertain: true,
      identityUnverified: false,
    });
    expect(fetcher.mock.calls).toHaveLength(3);
  });
  it("retains the original target and never replays an MFA rejection", async () => {
    const h = setup(),
      verification = vi.fn(),
      unregister = registerAdminVerification(verification);
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith("/admin/session")
        ? response(actor)
        : new Response(JSON.stringify({ error: { code: "STEP_UP_REQUIRED" } }), { status: 403 }),
    );
    vi.stubGlobal("fetch", fetcher);
    try {
      await expect(h.client.deleteCreative(target)).rejects.toMatchObject({
        verificationRequired: true,
        uncertain: false,
      });
      expect(verification).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls).toHaveLength(2);
      expect(fetcher.mock.calls[1]![0]).toContain(target);
    } finally {
      unregister();
    }
  });
  it("fences reads and sends expected identity on the data request as well", async () => {
    const h = setup();
    const fetcher = vi.fn(async (url: string) =>
      response(
        url.endsWith("/admin/session")
          ? actor
          : {
              masterEnabled: false,
              googleGptEnabled: false,
              house: { imageUrl: null, clickUrl: null, altText: null },
            },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    await h.client.getPageAdSettings();
    for (const [, init] of fetcher.mock.calls as unknown as [string, RequestInit][]) {
      expect(init.headers).toMatchObject({
        "x-ayin-expected-account": actor.accountId,
        "x-ayin-expected-session": actor.sessionId,
      });
      expect(init).not.toHaveProperty("body");
    }
  });
  it("does not mistake a legacy seller post-commit snapshot failure for a rejected publication", async () => {
    const h = setup();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "INVALID_AUTHORIZED_SELLER_SYNTAX" } }), {
          status: 400,
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(h.client.saveSellerFile("ads", "# Synthetic comment")).rejects.toMatchObject({
      uncertain: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(["INVALID_ADVERTISING_MUTATION", "INVALID_PAGE_AD_SETTINGS"])(
    "retains uncertainty for legacy callback failure %s",
    async (code) => {
      const h = setup();
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(response(actor))
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code } }), { status: 400 }));
      vi.stubGlobal("fetch", fetcher);
      await expect(h.client.deleteCreative(target)).rejects.toMatchObject({ uncertain: true });
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it("returns an interrupted post-write transport as uncertain", async () => {
    const h = setup();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(actor))
      .mockRejectedValueOnce(new TypeError("lost"));
    vi.stubGlobal("fetch", fetcher);
    const result = await h.client.deleteCreative(target).catch((e: unknown) => e);
    expect(result).toBeInstanceOf(AdvertisingRequestError);
    expect(result).toMatchObject({ uncertain: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
