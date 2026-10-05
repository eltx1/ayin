import "reflect-metadata";

import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AuthService } from "./auth.service.js";
import { OptionalAuthGuard } from "./optional-auth.guard.js";

function harness(headers: Record<string, string>) {
  const request = { headers };
  const authenticate = vi.fn(async () => ({ accountId: "current-account", authVersion: 1 }));
  const guard = new OptionalAuthGuard({ authenticate } as unknown as AuthService);
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { request, authenticate, guard, context };
}

describe("optional public session authentication", () => {
  it("keeps anonymous reads public without authenticating unrelated cookies", async () => {
    for (const headers of [{}, { cookie: "preferences=en; other=1" }]) {
      const h = harness(headers);
      expect(await h.guard.canActivate(h.context)).toBe(true);
      expect(h.authenticate).not.toHaveBeenCalled();
    }
  });

  it("uses the current guarded cookie session", async () => {
    const h = harness({ cookie: "preferences=en; ayin_session=actual-session" });
    expect(await h.guard.canActivate(h.context)).toBe(true);
    expect(h.authenticate).toHaveBeenCalledExactlyOnceWith("actual-session");
    expect(h.request).toHaveProperty("ayinAuth.accountId", "current-account");
  });

  it("lets explicit bearer authentication own the transport over a conflicting cookie", async () => {
    const h = harness({
      cookie: "ayin_session=cookie-session",
      authorization: "Bearer bearer-session",
    });
    expect(await h.guard.canActivate(h.context)).toBe(true);
    expect(h.authenticate).toHaveBeenCalledExactlyOnceWith("bearer-session");
  });

  it("does not treat malformed explicit credentials as an anonymous read", async () => {
    for (const headers of [
      { cookie: "ayin_session=" },
      { cookie: "ayin_session=%ZZ" },
      { cookie: "ayin_session=valid-cookie", authorization: "Basic unsupported" },
      { cookie: "ayin_session=valid-cookie", authorization: "Bearer " },
    ]) {
      const h = harness(headers);
      await expect(h.guard.canActivate(h.context)).rejects.toMatchObject({
        status: 401,
        response: { error: { code: "UNAUTHORIZED" } },
      });
      expect(h.authenticate).not.toHaveBeenCalled();
      expect(h.request).not.toHaveProperty("ayinAuth");
    }
  });

  it("retains authentication rejection and expected-account narrowing", async () => {
    const stale = harness({ cookie: "ayin_session=stale" });
    stale.authenticate.mockRejectedValueOnce(new Error("revoked"));
    await expect(stale.guard.canActivate(stale.context)).rejects.toThrow("revoked");
    const changed = harness({
      cookie: "ayin_session=current",
      "x-ayin-expected-account": "00000000-0000-0000-0000-000000000001",
    });
    await expect(changed.guard.canActivate(changed.context)).rejects.toMatchObject({
      status: 409,
      response: { error: { code: "ACCOUNT_CHANGED" } },
    });
    expect(changed.request).not.toHaveProperty("ayinAuth");
  });
});
