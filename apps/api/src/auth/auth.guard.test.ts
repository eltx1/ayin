import "reflect-metadata";
import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AuthGuard } from "./auth.guard.js";
import type { AuthService } from "./auth.service.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const replacement = "33333333-3333-4333-8333-333333333333";
const auth = { accountId, sessionId, authVersion: 4 };
function setup(extra: Record<string, string> = {}) {
  const request = { headers: { cookie: "ayin_session=authenticated-cookie", ...extra } };
  const authenticate = vi.fn().mockResolvedValue(auth);
  const guard = new AuthGuard({ authenticate } as unknown as AuthService);
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { request, authenticate, guard, context };
}
describe("authenticated expected-session binding", () => {
  it("keeps legacy callers and matching scoped callers working", async () => {
    for (const headers of [
      {},
      { "x-ayin-expected-account": accountId, "x-ayin-expected-session": sessionId },
    ]) {
      const h = setup(headers);
      await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
      expect(h.authenticate).toHaveBeenCalledWith("authenticated-cookie");
      expect(h.request).toHaveProperty("ayinAuth", auth);
    }
  });
  it("rejects a same-account replacement cookie before publishing controller authority", async () => {
    const h = setup({ "x-ayin-expected-account": accountId, "x-ayin-expected-session": sessionId });
    h.authenticate.mockResolvedValueOnce({ ...auth, sessionId: replacement });
    await expect(h.guard.canActivate(h.context)).rejects.toMatchObject({
      status: 409,
      response: { error: { code: "SESSION_CHANGED" } },
    });
    expect(h.request).not.toHaveProperty("ayinAuth");
  });
  it("never treats session metadata as authentication", async () => {
    const h = setup({ cookie: "", "x-ayin-expected-session": sessionId });
    await expect(h.guard.canActivate(h.context)).rejects.toMatchObject({ status: 401 });
    expect(h.authenticate).not.toHaveBeenCalled();
    expect(h.request).not.toHaveProperty("ayinAuth");
  });
});
