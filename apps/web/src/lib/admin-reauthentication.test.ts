import { afterEach, describe, expect, it, vi } from "vitest";

import { readAdminApiError, registerAdminVerification } from "./admin-reauthentication";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  vi.unstubAllGlobals();
});

function failure(status: number, code: string) {
  return Response.json({ error: { code, message: "Original server message" } }, { status });
}

describe("admin verification request", () => {
  it("opens verification only for a server step-up rejection and never replays requests", async () => {
    const open = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    cleanup = registerAdminVerification(open);
    expect(await readAdminApiError(failure(403, "STEP_UP_REQUIRED"))).toBe(
      "Original server message",
    );
    expect(open).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    [403, "ADMIN_FORBIDDEN"],
    [401, "UNAUTHORIZED"],
    [500, "STEP_UP_REQUIRED"],
  ])("does not treat %s %s as a step-up challenge", async (status, code) => {
    const open = vi.fn();
    cleanup = registerAdminVerification(open);
    expect(await readAdminApiError(failure(status as number, code as string))).toBe(
      "Original server message",
    );
    expect(open).not.toHaveBeenCalled();
  });
  it("preserves malformed error handling", async () => {
    const open = vi.fn();
    cleanup = registerAdminVerification(open);
    expect(
      await readAdminApiError(new Response("<html>offline</html>", { status: 403 })),
    ).toContain("Please try again");
    expect(open).not.toHaveBeenCalled();
  });
  it("unregisters on unmount without removing a newer handler", async () => {
    const old = vi.fn();
    const newer = vi.fn();
    const removeOld = registerAdminVerification(old);
    cleanup = registerAdminVerification(newer);
    removeOld();
    await readAdminApiError(failure(403, "STEP_UP_REQUIRED"));
    expect(newer).toHaveBeenCalledOnce();
    expect(old).not.toHaveBeenCalled();
    cleanup();
    await readAdminApiError(failure(403, "STEP_UP_REQUIRED"));
    expect(newer).toHaveBeenCalledOnce();
  });
});
