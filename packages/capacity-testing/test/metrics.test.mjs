import assert from "node:assert/strict";
import test from "node:test";
import { percentile, summarizeResults } from "../src/metrics.mjs";

test("calculates nearest-rank latency percentiles", () => {
  const values = Array.from({ length: 100 }, (_, index) => index + 1);
  assert.equal(percentile(values, 50), 50);
  assert.equal(percentile(values, 95), 95);
  assert.equal(percentile(values, 99), 99);
  assert.equal(percentile([], 95), null);
});

test("records logical and network throughput plus error rate", () => {
  const summary = summarizeResults(
    [
      { ok: true, latencyMs: 10, networkRequests: 1 },
      { ok: false, latencyMs: 30, networkRequests: 2, classification: "http_503" },
    ],
    1_000,
  );
  assert.equal(summary.requestsPerSecond, 2);
  assert.equal(summary.networkRequestsPerSecond, 3);
  assert.equal(summary.errorRate, 0.5);
  assert.deepEqual(summary.failureClasses, { http_503: 1 });
  assert.equal(summary.latencyMs.p95, 30);
});
