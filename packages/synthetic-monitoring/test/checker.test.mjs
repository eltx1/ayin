import assert from "node:assert/strict";
import test from "node:test";

import {
  NullAlertAdapter,
  SyntheticValidationError,
  classifyFailure,
  executeCheck,
  runConfirmedSyntheticChecks,
} from "../src/checker.mjs";
import { loadSyntheticConfig } from "../src/config.mjs";

const SHA = "a".repeat(40);

test("loads read-only production checks and skips unconfigured safe media targets", () => {
  const config = loadSyntheticConfig({});
  assert.equal(config.checks.find((check) => check.id === "homepage")?.method, "GET");
  assert.equal(
    config.checks.find((check) => check.id === "media-head")?.skipReason.length > 0,
    true,
  );
  assert.equal(
    config.checks.find((check) => check.id === "watch-page")?.skipReason.length > 0,
    true,
  );
  assert.equal(
    config.checks.some((check) => !["GET", "HEAD", undefined].includes(check.method)),
    false,
  );
});

test("rejects credential-bearing or signed optional target URLs", () => {
  assert.throws(
    () =>
      loadSyntheticConfig({
        AYIN_SYNTHETIC_MEDIA_OBJECT_URL: "https://media.ayin.stream/test.mp4?token=secret",
      }),
    /public objects/,
  );
  assert.throws(
    () => loadSyntheticConfig({ AYIN_SYNTHETIC_WEB_URL: "https://user:pass@ayin.stream" }),
    /credential-free/,
  );
});

test("retries a bounded transient failure and records latency plus release SHA", async () => {
  let calls = 0;
  const clockValues = [0, 25, 100, 140];
  const result = await executeCheck(healthCheck(), baseConfig(), {
    fetchImplementation: async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("lookup failed"), { code: "ENOTFOUND" });
      return jsonResponse({ service: "ayin-api", status: "alive", releaseSha: SHA });
    },
    sleep: async () => {},
    clock: () => clockValues.shift(),
  });
  assert.equal(result.status, "passed");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].classification, "dns");
  assert.equal(result.attempts[1].latencyMs, 40);
  assert.equal(result.attempts[1].releaseSha, SHA);
});

test("classifies schema, HTTP, timeout, TLS, and network failures without raw details", () => {
  assert.equal(classifyFailure(new SyntheticValidationError("bad")), "response_validation");
  assert.equal(classifyFailure(new SyntheticValidationError("bad", "http_5xx")), "http_5xx");
  assert.equal(
    classifyFailure(Object.assign(new Error("aborted"), { name: "AbortError" })),
    "timeout",
  );
  assert.equal(
    classifyFailure(Object.assign(new Error("tls"), { code: "CERT_HAS_EXPIRED" })),
    "tls",
  );
  assert.equal(classifyFailure(new Error("private raw network detail")), "network");
});

test("fails a check whose valid response breaches its latency budget", async () => {
  const times = [0, 101];
  const result = await executeCheck(
    { ...healthCheck(), maxLatencyMs: 100 },
    { ...baseConfig(), maxAttempts: 1 },
    {
      fetchImplementation: async () =>
        jsonResponse({ service: "ayin-api", status: "alive", releaseSha: SHA }),
      clock: () => times.shift(),
    },
  );
  assert.equal(result.status, "failed");
  assert.equal(result.classification, "latency");
});

test("alerts only after a failure is confirmed", async () => {
  const notifications = [];
  const adapter = {
    name: "test",
    async notify(payload) {
      notifications.push(payload);
      return { provider: "test", attempted: true, delivered: true };
    },
  };
  const report = await runConfirmedSyntheticChecks(
    { ...baseConfig(), checks: [healthCheck()] },
    {
      fetchImplementation: async () => jsonResponse({ error: true }, 503),
      sleep: async () => {},
      alertAdapter: adapter,
      now: () => new Date("2026-09-07T00:00:00.000Z"),
    },
  );
  assert.equal(report.status, "failed");
  assert.equal(report.checks[0].confirmed, true);
  assert.equal(report.checks[0].classification, "http_5xx");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].highestSeverity, "critical");
});

test("does not alert when confirmation recovers", async () => {
  let calls = 0;
  const adapter = {
    name: "test",
    async notify() {
      assert.fail("notification must not be attempted");
    },
  };
  const report = await runConfirmedSyntheticChecks(
    { ...baseConfig(), maxAttempts: 1, checks: [healthCheck()] },
    {
      fetchImplementation: async () => {
        calls += 1;
        return calls === 1
          ? jsonResponse({ error: true }, 503)
          : jsonResponse({ service: "ayin-api", status: "alive", releaseSha: SHA });
      },
      sleep: async () => {},
      alertAdapter: adapter,
    },
  );
  assert.equal(report.status, "passed");
  assert.equal(report.summary.recovered, 1);
});

test("maintenance window suppresses confirmed alert delivery and job failure", async () => {
  const report = await runConfirmedSyntheticChecks(
    {
      ...baseConfig(),
      maxAttempts: 1,
      maintenanceUntil: "2026-09-08T00:00:00.000Z",
      checks: [healthCheck()],
    },
    {
      fetchImplementation: async () => jsonResponse({}, 500),
      sleep: async () => {},
      now: () => new Date("2026-09-07T00:00:00.000Z"),
      alertAdapter: {
        name: "test",
        async notify() {
          assert.fail("maintenance must suppress notification");
        },
      },
    },
  );
  assert.equal(report.status, "maintenance_suppressed");
  assert.deepEqual(report.alert, { provider: "test", attempted: false, delivered: false });
});

test("null adapter truthfully reports that no delivery was attempted", async () => {
  assert.deepEqual(await new NullAlertAdapter().notify({}), {
    provider: "none",
    attempted: false,
    delivered: false,
  });
});

test("validates media range semantics", async () => {
  const response = new Response(new Uint8Array([1, 2, 3]), {
    status: 206,
    headers: {
      "content-type": "video/mp4",
      "content-range": "bytes 0-2/100",
    },
  });
  const times = [0, 10];
  const result = await executeCheck(
    {
      id: "media-range",
      label: "Media range",
      severity: "critical",
      url: "https://media.ayin.stream/synthetic/test.mp4",
      method: "GET",
      headers: { range: "bytes=0-1023" },
      maxLatencyMs: 100,
      validator: "mediaRange",
    },
    { ...baseConfig(), maxAttempts: 1 },
    { fetchImplementation: async () => response, clock: () => times.shift() },
  );
  assert.equal(result.status, "passed");
});

function baseConfig() {
  return {
    timeoutMs: 1_000,
    maxAttempts: 2,
    retryDelayMs: 0,
    confirmationDelayMs: 0,
    maintenanceUntil: null,
  };
}

function healthCheck() {
  return {
    id: "api-health",
    label: "API health",
    severity: "critical",
    url: "https://api.ayin.stream/health",
    method: "GET",
    maxLatencyMs: 100,
    validator: "apiHealth",
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-ayin-release": SHA },
  });
}
