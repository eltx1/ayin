import "reflect-metadata";
import { afterEach, expect, it, vi } from "vitest";
import { ObservabilityService } from "./observability.service.js";
import { LocalTelemetryAdapter } from "./telemetry.adapter.js";
function service() {
  return new ObservabilityService(
    {
      client: {
        mediaProcessingJob: {
          groupBy: vi.fn().mockResolvedValue([]),
          findFirst: vi.fn().mockResolvedValue(null),
          count: vi.fn().mockResolvedValue(0),
        },
        analyticsEvent: { count: vi.fn().mockResolvedValue(0) },
      },
    } as never,
    {} as never,
    {} as never,
    new LocalTelemetryAdapter(),
  );
}
afterEach(() => vi.useRealTimers());
it("labels bounded process samples separately from lifetime error counters", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-27T00:00:00Z"));
  const subject = service();
  for (let i = 0; i < 1005; i++)
    subject.recordRequest({ method: "GET", path: "/search", statusCode: 500, latencyMs: 10 });
  const snapshot = await subject.metricsSnapshot();
  expect(snapshot.api).toMatchObject({
    scope: "PROCESS",
    sampleLimit: 1000,
    windowSeconds: 60,
    requests: 1000,
    statusClasses: { "5xx": 1000 },
  });
  expect(snapshot.errors.counterScope).toBe("PROCESS_LIFETIME");
  expect(Object.values(snapshot.errors.counters)).toContain(1005);
  vi.advanceTimersByTime(61000);
  const expired = await subject.metricsSnapshot();
  expect(expired.api.requests).toBe(0);
  expect(expired.api.latencyMs).toEqual({ average: 0, p50: 0, p95: 0, max: 0 });
  expect(expired.errors.counters).toEqual(snapshot.errors.counters);
  expect(expired.telemetry).toEqual({ provider: "local", externalConnected: false });
});
