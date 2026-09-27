import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canReadDatabaseOperations,
  canReadMediaOperations,
  getDatabaseOperations,
  getMediaOperations,
  getAdaptiveOperations,
} from "./admin-operator";
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
