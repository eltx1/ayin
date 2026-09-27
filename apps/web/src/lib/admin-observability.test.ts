import { afterEach, expect, it, vi } from "vitest";
import { canReadObservability, getObservability } from "./admin-observability";
const snapshot = {
  releaseSha: "unknown",
  telemetry: { provider: "local", externalConnected: false },
  api: {
    scope: "PROCESS",
    sampleLimit: 1000,
    windowSeconds: 60,
    requests: 0,
    requestsPerSecond: 0,
    statusClasses: { "1xx": 0, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 },
    latencyMs: { average: 0, p50: 0, p95: 0, max: 0 },
  },
  worker: {
    queueDepth: 0,
    oldestQueuedAgeSeconds: 0,
    activeJobs: 0,
    failures: 0,
    jobsWithRetries: 0,
  },
  errors: { counterScope: "PROCESS_LIFETIME", counters: {}, adIntegrationLast24Hours: 0 },
};
afterEach(() => vi.unstubAllGlobals());
it("keeps the existing SUPERADMIN boundary", () => {
  expect(canReadObservability(["ADMIN", "OPERATIONS"])).toBe(false);
  expect(canReadObservability(["SUPERADMIN"])).toBe(true);
});
it("reads an authenticated uncached abortable snapshot", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot)));
  vi.stubGlobal("fetch", fetch);
  const signal = new AbortController().signal;
  expect(await getObservability(signal)).toEqual(snapshot);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("/admin/observability"), {
    credentials: "include",
    cache: "no-store",
    signal,
  });
});
it("reports failed and malformed snapshots without inventing healthy zeroes or retrying", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Metrics unavailable" } }), { status: 503 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ...snapshot, worker: { queueDepth: -1 } })),
    );
  vi.stubGlobal("fetch", fetch);
  await expect(getObservability(new AbortController().signal)).rejects.toThrow(
    "Metrics unavailable",
  );
  await expect(getObservability(new AbortController().signal)).rejects.toThrow("invalid snapshot");
  expect(fetch).toHaveBeenCalledTimes(2);
});
