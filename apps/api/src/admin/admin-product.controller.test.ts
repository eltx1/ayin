import "reflect-metadata";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AdminProductController } from "./admin-product.controller.js";
import { AdminGuard } from "./admin.guard.js";

function fixture(roles = ["OPERATIONS"], recent = true) {
  const request = {
    ayinAuth: {
      accountId: "11111111-1111-4111-8111-111111111111",
      reauthAt: recent ? Math.floor(Date.now() / 1000) : undefined,
    },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getClass: () => AdminProductController,
    getHandler: () => AdminProductController.prototype.createRow,
  } as unknown as ExecutionContext;
  const guard = new AdminGuard(
    { getRoles: vi.fn().mockResolvedValue(roles) } as never,
    new Reflector(),
    { assertAdminMfa: vi.fn() } as never,
  );
  return { guard, context, request };
}

describe("Admin section creation authorization", () => {
  it("allows a recently verified Operations actor through the existing guard", async () => {
    const { guard, context } = fixture();
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it.each([[], ["CONTENT_MODERATOR"], ["AD_MANAGER"]])("rejects roles %j", async (...roles) => {
    const { guard, context } = fixture(roles.flat());
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
  });

  it("requires step-up even for an Operations actor", async () => {
    const { guard, context } = fixture(["OPERATIONS"], false);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 403,
      response: { error: { code: "STEP_UP_REQUIRED" } },
    });
  });

  it("rejects malformed creation data before calling the service", () => {
    const createRow = vi.fn();
    const controller = new AdminProductController({ createRow } as never);
    const { request } = fixture();
    expect(() => controller.createRow(request as never, { key: "../invalid" })).toThrow();
    expect(createRow).not.toHaveBeenCalled();
  });
});
