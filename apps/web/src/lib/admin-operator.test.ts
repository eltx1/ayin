import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canReadDatabaseOperations,
  canReadMediaOperations,
  getDatabaseOperations,
  getMediaOperations,
  getAdaptiveOperations,
  submitMediaJobAction,
} from "./admin-operator";
import { registerAdminVerification } from "./admin-reauthentication";
import type { AdminRole } from "./admin-control";

afterEach(() => vi.unstubAllGlobals());
describe("operator access and requests", () => {
  it.each<AdminRole>([
    "SUPERADMIN",
    "ADMIN",
    "OPERATIONS",
    "CONTENT_MODERATOR",
    "AD_MANAGER",
    "FINANCE_MANAGER",
  ])("matches existing server boundaries for %s", (role) => {
    expect(canReadMediaOperations([role])).toBe(
      ["SUPERADMIN", "ADMIN", "OPERATIONS"].includes(role),
    );
    expect(canReadDatabaseOperations([role])).toBe(role === "SUPERADMIN");
  });
  it("denies an empty role set", () => {
    expect(canReadMediaOperations([])).toBe(false);
    expect(canReadDatabaseOperations([])).toBe(false);
  });
  it("uses authenticated uncached cancellable reads for each snapshot", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json({ marker: true })));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    await Promise.all([
      getMediaOperations(controller.signal),
      getAdaptiveOperations(controller.signal),
      getDatabaseOperations(controller.signal),
    ]);
    expect(fetch.mock.calls.map((call) => new URL(call[0]).pathname)).toEqual([
      "/admin/media-processing",
      "/admin/media-processing/adaptive-rollout",
      "/admin/observability/postgres",
    ]);
    for (const [, options] of fetch.mock.calls)
      expect(options).toEqual({
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
  });
  it("keeps server failures distinct from an empty operational snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: "UNAVAILABLE", message: "Snapshot unavailable" } },
            { status: 503 },
          ),
        ),
    );
    await expect(getMediaOperations(new AbortController().signal)).rejects.toThrow(
      "Snapshot unavailable",
    );
  });
});

describe("media mutations", () => {
  it.each(["retry", "reprocess"] as const)(
    "sends one authenticated %s to the correct entity",
    async (action) => {
      const fetch = vi.fn().mockResolvedValue(Response.json({ status: "QUEUED", generation: 2 }));
      vi.stubGlobal("fetch", fetch);
      const signal = new AbortController().signal;
      expect(
        await submitMediaJobAction(action, { id: "job-id", videoId: "video-id" }, signal),
      ).toEqual({ status: "QUEUED", generation: 2 });
      expect(fetch).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining(
          action === "retry" ? "/jobs/job-id/retry" : "/videos/video-id/reprocess",
        ),
        { method: "POST", credentials: "include", cache: "no-store", signal },
      );
    },
  );
  it("requests step-up without automatically replaying a mutation", async () => {
    const verify = vi.fn();
    const unregister = registerAdminVerification(verify);
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { code: "STEP_UP_REQUIRED", message: "Verify again" } },
          { status: 403 },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(
        submitMediaJobAction(
          "retry",
          { id: "job", videoId: "video" },
          new AbortController().signal,
        ),
      ).rejects.toThrow("Verify again");
      expect(verify).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      unregister();
    }
  });
  it("does not retry an ambiguous network failure", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Network unavailable"));
    vi.stubGlobal("fetch", fetch);
    await expect(
      submitMediaJobAction(
        "reprocess",
        { id: "job", videoId: "video" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Network unavailable");
    expect(fetch).toHaveBeenCalledOnce();
  });
});
