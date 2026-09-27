import { afterEach, expect, it, vi } from "vitest";
import { getWarehouseStatus } from "./admin-warehouse";
afterEach(() => vi.unstubAllGlobals());
it("uses one authenticated uncached cancellable read", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ configured: false, datasets: [] })));
  vi.stubGlobal("fetch", fetch);
  const signal = new AbortController().signal;
  expect((await getWarehouseStatus(signal)).configured).toBe(false);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining("/admin/warehouse-status"),
    { credentials: "include", cache: "no-store", signal },
  );
});
it("reports API failure as an error without retrying or substituting empty data", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        error: { code: "UNAVAILABLE", message: "Checkpoint temporarily unavailable" },
      }),
      { status: 503 },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(getWarehouseStatus(new AbortController().signal)).rejects.toThrow(
    "Checkpoint temporarily unavailable",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
