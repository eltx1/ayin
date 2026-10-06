import { describe, expect, it, vi } from "vitest";
import { AdminController } from "./admin.controller.js";
import { AuthHttpError } from "../auth/auth.errors.js";

const actor = {
  accountId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  authVersion: 7,
};
const current = {
  id: actor.sessionId,
  authVersion: 7,
  account: { status: "ACTIVE", authVersion: 7 },
};
function setup(value: unknown = current, roles: string[] = ["AD_MANAGER"]) {
  const findFirst = vi.fn().mockResolvedValue(value);
  const authorization = { getRoles: vi.fn().mockResolvedValue(roles) };
  const database = { client: { accountSession: { findFirst } } };
  const controller = new AdminController(
    authorization as never,
    {} as never,
    {} as never,
    database as never,
    {} as never,
  );
  const read = () =>
    controller.session({ ayinAuth: actor, ayinAdmin: { roles: ["ADMIN"] } } as never);
  return { findFirst, authorization, read };
}
describe("non-authenticating Admin session scope metadata", () => {
  it("returns durable session/account version and current server roles, not stale guard claims", async () => {
    const { read, findFirst, authorization } = setup();
    expect(await read()).toEqual({ ...actor, roles: ["AD_MANAGER"] });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: actor.sessionId,
        accountId: actor.accountId,
        authVersion: 7,
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      select: {
        id: true,
        authVersion: true,
        account: { select: { authVersion: true, status: true } },
      },
    });
    expect(authorization.getRoles).toHaveBeenCalledWith(actor.accountId);
  });
  it.each([
    ["missing/revoked/expired session", null],
    [
      "current account version changed",
      { ...current, account: { status: "ACTIVE", authVersion: 8 } },
    ],
    ["durable session version changed", { ...current, authVersion: 8 }],
    ["inactive account", { ...current, account: { status: "SUSPENDED", authVersion: 7 } }],
  ])("rejects %s rather than reflecting stale token claims", async (_, value) => {
    const { read, authorization } = setup(value);
    await expect(read()).rejects.toBeInstanceOf(AuthHttpError);
    expect(authorization.getRoles).not.toHaveBeenCalled();
  });
  it("rejects revoked roles even when the earlier AdminGuard had roles", async () => {
    const { read } = setup(current, []);
    await expect(read()).rejects.toMatchObject({ status: 403 });
  });
});
